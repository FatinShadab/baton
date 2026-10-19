import { isAllowedHost, isAllowedUrl } from '../src/kb/urlpolicy';

/** OFFLINE: no network calls are made here. */
const ALLOWED = ['github.com', 'docs.github.com'];
const LISTED = ['https://github.com/google-antigravity/antigravity-cli'];

type Case = { name: string; actual: { ok: boolean; reason?: string }; expected: boolean };

const cases: Case[] = [
  {
    name: 'listed URL on allowed host',
    actual: isAllowedUrl('https://github.com/google-antigravity/antigravity-cli', ALLOWED, LISTED),
    expected: true,
  },
  {
    name: 'http URL rejected',
    actual: isAllowedUrl('http://github.com/google-antigravity/antigravity-cli', ALLOWED, LISTED),
    expected: false,
  },
  {
    name: 'evil-github.com rejected',
    actual: isAllowedUrl('https://evil-github.com/x', ALLOWED, LISTED),
    expected: false,
  },
  {
    name: 'github.com.evil.com rejected',
    actual: isAllowedUrl('https://github.com.evil.com/x', ALLOWED, LISTED),
    expected: false,
  },
  {
    name: 'userinfo rejected',
    actual: isAllowedUrl('https://user:pw@github.com/google-antigravity/antigravity-cli', ALLOWED, LISTED),
    expected: false,
  },
  {
    name: 'port 8443 rejected',
    actual: isAllowedUrl('https://github.com:8443/google-antigravity/antigravity-cli', ALLOWED, LISTED),
    expected: false,
  },
  {
    name: 'IPv4 literal rejected',
    actual: isAllowedHost('https://127.0.0.1/', ALLOWED),
    expected: false,
  },
  {
    name: 'IPv6 literal rejected',
    actual: isAllowedHost('https://[::1]/', ALLOWED),
    expected: false,
  },
  {
    name: 'localhost rejected',
    actual: isAllowedHost('https://localhost/', ALLOWED),
    expected: false,
  },
  {
    name: 'allowed host but unlisted URL rejected by isAllowedUrl',
    actual: isAllowedUrl('https://github.com/openai/codex', ALLOWED, LISTED),
    expected: false,
  },
  {
    name: 'allowed host but unlisted URL accepted by isAllowedHost',
    actual: isAllowedHost('https://github.com/openai/codex', ALLOWED),
    expected: true,
  },
  {
    name: 'subdomain of an allowed domain accepted by host rule',
    actual: isAllowedHost('https://sub.docs.github.com/', ALLOWED),
    expected: true,
  },
  {
    name: 'fragment and trailing slash still match a listed URL',
    actual: isAllowedUrl('https://github.com/google-antigravity/antigravity-cli/#readme', ALLOWED, LISTED),
    expected: true,
  },
];

let failed = 0;
for (const entry of cases) {
  const pass = entry.actual.ok === entry.expected;
  if (!pass) failed++;
  const reason = entry.actual.reason ? ` (${entry.actual.reason})` : '';
  console.log(`${pass ? 'PASS' : 'FAIL'} ${entry.name} — ok=${entry.actual.ok}${reason}`);
}
console.log(`\n${cases.length - failed}/${cases.length} checks passed`);
if (failed > 0) process.exitCode = 1;
