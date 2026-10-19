import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { SecretStorage } from 'vscode';
import { preferredKey } from './secrets';

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
    apiKey = await preferredKey(secretStore, 'elevenlabs');
  }
  if (!apiKey?.trim()) {
    throw new Error('ElevenLabs API key is missing. Add your key in Baton Settings.');
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

export interface VoiceRecorderSession {
  url: string;
  close: () => void;
}

export async function startVoiceRecorderServer(
  onAudioReceived: (audio: Buffer, mime: string) => Promise<void>,
  onStopped: (message: string) => void,
): Promise<VoiceRecorderSession> {
  const token = randomUUID();
  let server: http.Server | undefined;
  let closed = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  const closeServer = () => {
    if (closed) return;
    closed = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (server) {
      try {
        server.close();
      } catch {
        // ignore
      }
    }
  };

  const stopWithError = (message: string) => {
    if (closed) return;
    closeServer();
    onStopped(message);
  };

  timeoutTimer = setTimeout(() => stopWithError('Voice recording timed out. Click the mic to try again.'), 180_000);

  server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const reqToken = reqUrl.searchParams.get('token');

    if (reqToken !== token) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end(getRecorderHtml(token));
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/cancel') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"cancelled"}');
      const reason = reqUrl.searchParams.get('reason');
      stopWithError(reason === 'permission-denied' ? 'Microphone permission denied in the VS Code browser.'
        : reason === 'unavailable' ? 'Microphone recording is unavailable in the VS Code browser.'
          : 'Voice recording cancelled.');
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/audio') {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let rejected = false;
      const MAX_BYTES = 25 * 1024 * 1024;
      const mime = req.headers['content-type'] || 'audio/webm';

      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          if (!rejected) {
            rejected = true;
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('Audio exceeds the 25 MB limit.');
            stopWithError('Audio exceeds the 25 MB limit.');
          }
        } else {
          chunks.push(chunk);
        }
      });

      req.on('end', async () => {
        if (rejected || closed) return;
        if (!totalBytes) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('No audio received.');
          stopWithError('No audio received. Click the mic to try again.');
          return;
        }
        const audioBuffer = Buffer.concat(chunks);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', received: totalBytes }));
        closeServer();
        try {
          await onAudioReceived(audioBuffer, mime);
        } catch {
          // handled by receiver
        }
      });

      req.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error receiving audio');
        }
        stopWithError('Could not receive audio. Click the mic to try again.');
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
        closeServer();
        reject(new Error('Could not bind voice recorder server'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/?token=${token}`,
        close: () => {
          closeServer();
        },
      });
    });
    server!.on('error', (err) => {
      closeServer();
      reject(err);
    });
  });
}

function getRecorderHtml(token: string): string {
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
    #cancel-btn { background: #eaeef2; color: #1f2328; margin-left: 8px; }
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
  <button id="cancel-btn" type="button">Cancel</button>
  <div id="status">Ready</div>

  <script>
    const token = ${JSON.stringify(token)};
    const btn = document.getElementById('record-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const status = document.getElementById('status');
    let mediaRecorder = null;
    let stream = null;
    let chunks = [];

    async function stopSession(reason, message) {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
      }
      if (stream) stream.getTracks().forEach((track) => track.stop());
      btn.disabled = true;
      cancelBtn.disabled = true;
      btn.classList.remove('recording');
      status.className = reason === 'cancelled' ? '' : 'error';
      status.textContent = message;
      try {
        await fetch('/cancel?token=' + encodeURIComponent(token) + '&reason=' + reason, {
          method: 'POST', signal: AbortSignal.timeout(5000)
        });
      } catch { /* The recorder may already have expired. */ }
    }

    cancelBtn.addEventListener('click', () => {
      void stopSession('cancelled', 'Recording cancelled. You can close this tab.');
    });

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
        if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('Microphone recording is unavailable.');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
              body: blob,
              signal: AbortSignal.timeout(30000)
            });
            if (resp.ok) {
              status.className = 'success';
              status.textContent = 'Audio received! You can close this tab now.';
              btn.textContent = 'Uploaded ✅';
              cancelBtn.disabled = true;
            } else {
              await stopSession('unavailable', 'Audio upload failed: ' + resp.statusText);
            }
          } catch (err) {
            await stopSession('unavailable', 'Audio upload failed: ' + err.message);
          }
        };
        mediaRecorder.start();
        btn.textContent = 'Stop Recording';
        btn.classList.add('recording');
        status.textContent = 'Recording… speak your task now.';
      } catch (err) {
        const denied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
        await stopSession(denied ? 'permission-denied' : 'unavailable',
          (denied ? 'Microphone permission denied: ' : 'Recorder unavailable: ') + err.message);
      }
    });
  </script>
</body>
</html>`;
}
