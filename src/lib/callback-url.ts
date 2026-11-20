/**
 * Where to send someone after they sign in.
 *
 * The sign-in page takes `?callbackUrl=` from the address bar, so anyone can
 * write a link with any value in it. Only a path on this site is accepted:
 * one "/" first, never "//" (another host), no backslash (browsers read "\"
 * as "/"), no whitespace or control characters (browsers drop tabs and
 * newlines, which can turn "/\t/evil.example" into "//evil.example"), and it
 * must still be on this site once parsed as a URL. Anything else is "/".
 * This prevents an open redirect.
 */
const MAX_LENGTH = 2048;
const PROBE_ORIGIN = "https://upvoteme.invalid";

export function safeCallbackUrl(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (value.length === 0 || value.length > MAX_LENGTH) return "/";
  if (value[0] !== "/" || value[1] === "/") return "/";
  if (value.includes("\\")) return "/";
  if (/[\s\u0000-\u001F\u007F]/.test(value)) return "/";

  let parsed: URL;
  try {
    parsed = new URL(value, PROBE_ORIGIN);
  } catch {
    return "/";
  }
  if (parsed.origin !== PROBE_ORIGIN) return "/";
  // Back to the sign-in page itself would only loop.
  if (parsed.pathname.replace(/\/+$/, "") === "/signin") return "/";
  return value;
}

/** The sign-in page's address that returns to `callbackUrl` afterwards. */
export function signInHref(callbackUrl: unknown): string {
  const target = encodeURIComponent(safeCallbackUrl(callbackUrl)).replace(/%2F/g, "/");
  return `/signin?callbackUrl=${target}`;
}
