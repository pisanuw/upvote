/**
 * Where to send someone after they sign in.
 *
 * The sign-in page takes `?callbackUrl=` from the address bar, so anyone can
 * write a link with any value in it. Only a path on this site is accepted:
 * one "/" first, never "//" (another host), no backslash (browsers read "\"
 * as "/"), no whitespace or control characters (browsers drop tabs and
 * newlines, which can turn "/\t/evil.example" into "//evil.example"), and it
 * must still be on this site once parsed as a URL, and its path must not
 * start with "//" after dot segments are resolved ("/..//evil.example" parses
 * to "//evil.example"). Anything else is "/". The parsed form is returned, not
 * the input, so what is checked is what is used. This prevents an open
 * redirect.
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
  if (parsed.pathname.startsWith("//")) return "/";
  // Back to the sign-in page itself would only loop.
  if (parsed.pathname.replace(/\/+$/, "") === "/signin") return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Where a sign-in started from the top bar should return: this page, with
 * its query (a thread view, /t/abc?root=c1, comes back to itself), or on the
 * sign-in page, that page's own callbackUrl.
 */
export function currentPageCallbackUrl(pathname: string | null, search: string): string {
  if (pathname === "/signin") return safeCallbackUrl(new URLSearchParams(search).get("callbackUrl"));
  const query = search.replace(/^\?/, "");
  return safeCallbackUrl(`${pathname ?? "/"}${query ? `?${query}` : ""}`);
}

/** The sign-in page's address that returns to `callbackUrl` afterwards. */
export function signInHref(callbackUrl: unknown): string {
  const target = encodeURIComponent(safeCallbackUrl(callbackUrl)).replace(/%2F/g, "/");
  return `/signin?callbackUrl=${target}`;
}
