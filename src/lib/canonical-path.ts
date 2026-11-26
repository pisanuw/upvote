/**
 * The canonical form of a path on this site, the one rule shared by the
 * analytics loader (public/hw-loader.js, a plain script with its own copy of
 * isCanonicalPath; a test checks that both agree) and by every place the app
 * builds an in-app link from input (safeCallbackUrl).
 *
 * Canonical: "/", or segments that are not empty, contain no "%" and do not
 * end in "." (so no "//" and no trailing "/"). hw-events.js matches its mask
 * prefixes against location.pathname as written, on the first load and on
 * every in-app move, so the path it reads must be in this form.
 */
export function isCanonicalPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (typeof pathname !== "string" || pathname.charAt(0) !== "/") return false;
  return pathname
    .slice(1)
    .split("/")
    .every((s) => s !== "" && !s.includes("%") && !s.endsWith("."));
}

/**
 * `pathname` with runs of "/" collapsed and a trailing "/" dropped, if that is
 * canonical; otherwise null (a "%" or a segment ending in "." is not repaired).
 */
export function canonicalPath(pathname: string): string | null {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed;
  return isCanonicalPath(trimmed) ? trimmed : null;
}
