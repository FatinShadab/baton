import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { SecretStorage } from 'vscode';
import { getKey } from './secrets';

let activeSecrets: SecretStorage | undefined;

export function initVoice(secrets: SecretStorage): void {
  activeSecrets = secrets;
}

export async function transcribe(
  audio: Buffer,
  mime = 'audio/webm',
  secrets?: SecretStorage,
): Promise<string> {
  const secretStore = secrets ?? activeSecrets;
  let apiKey: string | undefined;
  if (secretStore) {
    apiKey = await getKey(secretStore, 'ELEVENLABS_API_KEY');
  }
  if (!apiKey?.trim()) {
    throw new Error('ElevenLabs API key is missing. Set it with "Baton: Set API Keys".');
  }

  const formData = new FormData();
  formData.append('model_id', 'scribe_v2');
  const blob = new Blob([new Uint8Array(audio)], { type: mime || 'audio/webm' });
  formData.append('file', blob, 'audio.webm');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey.trim(),
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body: unknown = await response.json();
        if (typeof body === 'object' && body !== null && 'detail' in body) {
          detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
        }
      } catch {
        detail = await response.text();
      }
      throw new Error(`ElevenLabs STT error (${response.status}): ${detail || response.statusText}`);
    }

    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('text' in data) || typeof data.text !== 'string') {
      throw new Error('Invalid response received from ElevenLabs STT');
    }
    return data.text.trim();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Voice transcription timed out after 30 seconds.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface FallbackServerSession {
  url: string;
  close: () => void;
}

export async function startVoiceFallbackServer(
  onAudioReceived: (audio: Buffer, mime: string) => Promise<void>,
): Promise<FallbackServerSession> {
  const token = randomUUID();
  let server: http.Server | undefined;
  let closed = false;

  const closeServer = () => {
    if (closed) return;
    closed = true;
    if (server) {
      try {
        server.close();
      } catch {
        // ignore
      }
    }
  };

  const timeoutTimer = setTimeout(() => closeServer(), 180_000);

  server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const reqToken = reqUrl.searchParams.get('token');

    if (reqToken !== token) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getFallbackHtml(token));
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/audio') {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const MAX_BYTES = 25 * 1024 * 1024;
      const mime = req.headers['content-type'] || 'audio/webm';

      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          req.destroy(new Error('Audio exceeds limit'));
        } else {
          chunks.push(chunk);
        }
      });

      req.on('end', async () => {
        const audioBuffer = Buffer.concat(chunks);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', received: totalBytes }));
        clearTimeout(timeoutTimer);
        closeServer();
        try {
          await onAudioReceived(audioBuffer, mime);
        } catch {
          // handled by receiver
        }
      });

      req.on('error', () => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error receiving audio');
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not bind voice fallback server'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/?token=${token}`,
        close: () => {
          clearTimeout(timeoutTimer);
          closeServer();
        },
      });
    });
    server!.on('error', (err) => {
      clearTimeout(timeoutTimer);
      reject(err);
    });
  });
}

function getFallbackHtml(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Baton Voice Input</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 440px;
      margin: 40px auto;
      padding: 24px;
      text-align: center;
      color: #1f2328;
      background: #f6f8fa;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { color: #656d76; font-size: 14px; margin: 0 0 20px; }
    button {
      padding: 14px 28px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: background 0.2s;
    }
    #record-btn { background: #0969da; color: #fff; }
    #record-btn.recording {
      background: #cf222e;
      animation: pulse 1.2s infinite;
    }
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
    #status { margin-top: 16px; font-size: 14px; font-weight: 500; min-height: 20px; }
    .success { color: #1a7f37; font-weight: 600; }
    .error { color: #cf222e; }
  </style>
</head>
<body>
  <h1>🎙️ Baton Voice Input</h1>
  <p>Speak your coding task. Click Stop when finished.</p>
  <button id="record-btn" type="button">Start Recording</button>
  <div id="status">Ready</div>

  <script>
    const token = ${JSON.stringify(token)};
    const btn = document.getElementById('record-btn');
    const status = document.getElementById('status');
    let mediaRecorder = null;
    let chunks = [];

    btn.addEventListener('click', async () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.textContent = 'Uploading…';
        btn.disabled = true;
        btn.classList.remove('recording');
        status.textContent = 'Sending audio to Baton…';
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach((track) => track.stop());
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          try {
            const resp = await fetch('/audio?token=' + encodeURIComponent(token), {
              method: 'POST',
              headers: { 'Content-Type': blob.type },
              body: blob
            });
            if (resp.ok) {
              status.className = 'success';
              status.textContent = 'Audio received! You can close this tab now.';
              btn.textContent = 'Uploaded ✅';
            } else {
              status.className = 'error';
              status.textContent = 'Upload failed: ' + resp.statusText;
              btn.disabled = false;
              btn.textContent = 'Retry';
            }
          } catch (err) {
            status.className = 'error';
            status.textContent = 'Network error: ' + err.message;
            btn.disabled = false;
            btn.textContent = 'Retry';
          }
        };
        mediaRecorder.start();
        btn.textContent = 'Stop Recording';
        btn.classList.add('recording');
        status.textContent = 'Recording… speak your task now.';
      } catch (err) {
        status.className = 'error';
        status.textContent = 'Microphone permission denied: ' + err.message;
      }
    });
  </script>
</body>
</html>`;
}
