/**
 * The sign-in code's way into NextAuth's email callback
 * (/api/auth/callback/email, src/app/api/auth/[...nextauth]/route.ts).
 *
 * NextAuth reads the token and address from the callback's query string. The
 * code form posts them in the body instead, so a code never sits in a URL
 * (server logs, browser history); codeCallbackRequest moves them into the
 * query of an in-process request that only NextAuth sees. A GET is accepted
 * only for a link sent before codes (64 hex characters), so nobody can turn a
 * code into a sign-in link.
 */
import { NextRequest } from "next/server";
import { safeCallbackUrl } from "@/lib/callback-url";
import { normalizeEmailAddress, normalizeSignInCode } from "@/lib/sign-in-code";

/** NextAuth's catch-all segments for the Email provider's callback. */
export function isEmailCallback(segments: string[] | undefined): boolean {
  return segments?.length === 2 && segments[0] === "callback" && segments[1] === "email";
}

/** A token from a link sent before codes: randomBytes(32) as hex. */
export function isLegacyLinkToken(token: string | null): boolean {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

/** Where a refused GET goes: the sign-in page, in plain words (src/lib/sign-in-errors.ts). */
export function refusedLinkResponse(): Response {
  return new Response(null, { status: 302, headers: { Location: "/signin?error=Verification" } });
}

/** The answer NextAuth gives a failed code (with json=true), for input that never reaches it. */
function wrongCode(): Response {
  return Response.json({ url: "/api/auth/error?error=Verification" });
}

const MAX_BODY = 4096;

/**
 * The code form's POST ({ email, code, callbackUrl } as a form body) as the
 * request NextAuth's email callback expects, or the answer for one that is
 * not a code. Cross-site posts (Sec-Fetch-Site) are refused, so another site
 * cannot sign a visitor in to an account of its choosing.
 */
export async function codeCallbackRequest(
  req: NextRequest,
): Promise<{ request: NextRequest; response?: undefined } | { response: Response; request?: undefined }> {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };

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
  return { request };
}
