/**
 * Parses a raw `Cookie` request header into a name -> value map.
 *
 * Express provides `res.cookie()`/`res.clearCookie()` for SETTING cookies
 * out of the box (no extra dependency needed), but does not parse
 * incoming cookies without the separate `cookie-parser` middleware. Since
 * this project only needs to read a single cookie in one place
 * (middleware/authenticate.ts), a small hand-rolled parser avoids adding
 * a new dependency for that.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }

  for (const pair of header.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = pair.slice(0, separatorIndex).trim();
    const rawValue = pair.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}
