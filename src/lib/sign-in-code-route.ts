/**
 * How the sign-in code's requests reach NextAuth (src/app/api/auth/[...nextauth]/route.ts).
 *
 * - Asking for a code (POST /api/auth/signin/email): the browser gets a
 *   random key in an httpOnly cookie, set only when a code bound to it was
 *   stored. A browser that already has a key keeps it, so its new code
 *   replaces its old one. The client's network address is read from the
 *   header Netlify sets (CLIENT_IP_HEADER) for the request limits.
 * - Typing a code (POST /api/auth/callback/email): the form posts the address
 *   and code in the body, so a code never sits in a URL (server logs, browser
 *   history). codeCallbackRequest moves them into the query of an in-process
 *   request that only NextAuth sees, and reads the browser's key from its
 *   cookie. Cross-site posts are refused.
 * - A GET to the callback is accepted only for a link sent before codes
 *   (64 hex characters), so nobody can turn a code into a sign-in link.
 *
 * The code itself is checked in src/lib/sign-in-code-store.ts.
 */
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { NextRequest } from "next/server";
import { safeCallbackUrl } from "@/lib/callback-url";
import { SIGN_IN_CODE_MINUTES, normalizeEmailAddress, normalizeSignInCode } from "@/lib/sign-in-code";

/** NextAuth's catch-all segments for the Email provider's callback. */
export function isEmailCallback(segments: string[] | undefined): boolean {
  return segments?.length === 2 && segments[0] === "callback" && segments[1] === "email";
}

/** NextAuth's catch-all segments for asking the Email provider for a code. */
export function isEmailSignIn(segments: string[] | undefined): boolean {
  return segments?.length === 2 && segments[0] === "signin" && segments[1] === "email";
}

/** A token from a link sent before codes: randomBytes(32) as hex. */
export function isLegacyLinkToken(token: string | null): boolean {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

/** Where a refused GET goes: the sign-in page, in plain words (src/lib/sign-in-errors.ts). */
export function refusedLinkResponse(): Response {
  return new Response(null, { status: 302, headers: { Location: "/signin?error=Verification" } });
}

/**
 * The cookie that ties a code to the browser that asked for it. Like
 * NextAuth's own cookies, it is Secure, with the __Host- prefix (this host
 * only, so no other subdomain can set it), when the site is served over
 * https (NEXTAUTH_URL).
 */
export function codeCookie(nextAuthUrl: string | undefined) {
  const secure = (nextAuthUrl ?? "").startsWith("https://");
  const name = secure ? "__Host-upvoteme.signin-code" : "upvoteme.signin-code";
  return {
    name,
    secure,
    serialize: (value: string) =>
      `${name}=${value}; Path=/; Max-Age=${SIGN_IN_CODE_MINUTES * 60}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  };
}

const BROWSER_KEY = /^[A-Za-z0-9_-]{43}$/;

export function newBrowserKey(): string {
  return randomBytes(32).toString("base64url");
}

/** The browser's key from its cookie, or null when it has none (or a malformed one). */
export function browserKeyOf(req: NextRequest, nextAuthUrl: string | undefined): string | null {
  const value = req.cookies.get(codeCookie(nextAuthUrl).name)?.value;
  return value && BROWSER_KEY.test(value) ? value : null;
}

/**
 * The header Netlify sets on every request to a function with the address
 * of the client connected to it. Netlify's staff name it as the one client
 * address header they stand behind; X-Forwarded-For can carry values the
 * client sent and is not used.
 */
export const CLIENT_IP_HEADER = "x-nf-client-connection-ip";

/** The leading 4 groups of an IPv6 address: one network (a /64), as one client. */
function ipv6Network(ip: string): string {
  const bare = ip.toLowerCase();
  const [head, tail] = bare.split("::");
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * The client a code request counts against: its IPv4 address, or its IPv6
 * /64 (one household or device can hold a whole /64). Without a usable
 * header (local runs), every request shares "unknown", which limits more,
 * not less.
 */
export function clientOf(headers: Headers): string {
  const ip = (headers.get(CLIENT_IP_HEADER) ?? "").trim();
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6) return ipv6Network(ip);
  return "unknown";
}

/** The answer NextAuth gives a failed code (with json=true), for input that never reaches it. */
function wrongCode(): Response {
  return Response.json({ url: "/api/auth/error?error=Verification" });
}

const forbidden = () => Response.json({ error: "Forbidden" }, { status: 403 });

/**
 * Only this site's own pages may post a code: Sec-Fetch-Site must be
 * same-origin, or, from a browser that does not send it, Origin must be this
 * site. A post with neither is refused.
 */
function fromThisSite(req: NextRequest, nextAuthUrl: string | undefined): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const own = new Set([new URL(req.url).origin]);
  try {
    if (nextAuthUrl) own.add(new URL(nextAuthUrl).origin);
  } catch {
    // An unparsable NEXTAUTH_URL adds nothing.
  }
  return own.has(origin);
}

const MAX_BODY = 4096;

type CodeCallback =
  | { request: NextRequest; browserKey: string | null; response?: undefined }
  | { response: Response; request?: undefined; browserKey?: undefined };

/**
 * The code form's POST ({ email, code, callbackUrl } as a form body) as the
 * request NextAuth's email callback expects, with the browser's key from its
 * cookie; or the answer for one that is not a code from this site.
 */
export async function codeCallbackRequest(req: NextRequest, nextAuthUrl: string | undefined): Promise<CodeCallback> {
  if (!fromThisSite(req, nextAuthUrl)) return { response: forbidden() };

  const raw = await req.text();
  if (raw.length > MAX_BODY) return { response: wrongCode() };
  const form = new URLSearchParams(raw);

  const code = normalizeSignInCode(form.get("code"));
  let email: string;
  try {
    email = normalizeEmailAddress(form.get("email") ?? "");
  } catch {
    return { response: wrongCode() };
  }
  if (!code) return { response: wrongCode() };

  const target = new URL(req.url);
  target.search = new URLSearchParams({
    email,
    token: code,
    callbackUrl: safeCallbackUrl(form.get("callbackUrl")),
  }).toString();
  const request = new NextRequest(target, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ json: "true" }).toString(),
  });
  return { request, browserKey: browserKeyOf(req, nextAuthUrl) };
}
