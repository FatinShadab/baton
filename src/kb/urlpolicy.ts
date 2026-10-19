import { isIP } from 'node:net';

export type UrlCheck = { ok: boolean; reason?: string };

const reject = (reason: string): UrlCheck => ({ ok: false, reason });
const ALLOW = { ok: true } as const;

/** Host-level rules shared by the initial URL and every redirect hop. */
export function isAllowedHost(urlString: string, allowedDomains: string[]): UrlCheck {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return reject('URL is not valid');
  }
  if (url.protocol !== 'https:') return reject('URL must use https');
  if (url.username || url.password) return reject('URL must not include credentials');
  if (url.port && url.port !== '443') return reject(`URL must use port 443, not ${url.port}`);

  const hostname = url.hostname.toLowerCase();
  if (!hostname) return reject('URL has no hostname');
  const bareHost = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (hostname === 'localhost' || isIP(bareHost) !== 0) {
    return reject('URL host must not be an IP address or localhost');
  }

  const domains = allowedDomains
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  const allowed = domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  return allowed ? ALLOW : reject(`URL host "${hostname}" is not an allowed domain`);
}

/** Strips the fragment and one trailing slash before comparing against listed sources. */
function canonical(urlString: string): string {
  const trimmed = urlString.trim();
  const hashIndex = trimmed.indexOf('#');
  let value = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  if (value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

/**
 * Full rule set: host rules plus "must be exactly one of the listed sources".
 * No crawling: Baton only fetches URLs that a human put in sources.json.
 */
export function isAllowedUrl(urlString: string, allowedDomains: string[], listedUrls: string[]): UrlCheck {
  const host = isAllowedHost(urlString, allowedDomains);
  if (!host.ok) return host;
  const wanted = canonical(urlString);
  const listed = listedUrls.some((listedUrl) => canonical(listedUrl) === wanted);
  return listed ? ALLOW : reject('URL is not one of the listed sources');
}
