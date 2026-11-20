import type { NextRequest } from "next/server";
import { authHandler, authHandlerFor } from "@/auth";
import {
  browserKeyOf,
  clientOf,
  codeCallbackRequest,
  codeCookie,
  isEmailCallback,
  isEmailSignIn,
  isLegacyLinkToken,
  knownBrowserOf,
  knownBrowserSetCookie,
  newBrowserKey,
  refusedLinkResponse,
} from "@/lib/sign-in-code-route";

type Context = { params: Promise<{ nextauth: string[] }> };

/** Hears who signed in during one request. */
function signInListener() {
  const heard = { email: null as string | null };
  return { heard, onSignedIn: (email: string) => (heard.email = email) };
}

/** Marks the browser as known for the address it just signed in as, when a session was started. */
function markKnownBrowser(res: Response, email: string | null, req: NextRequest): Response {
  const cookie = knownBrowserSetCookie(res, email, req, process.env, new Date());
  if (cookie) res.headers.append("Set-Cookie", cookie);
  return res;
}

// Sign-in codes (src/lib/sign-in-code-route.ts): a code request ties the code
// to the asking browser's cookie; the email callback takes a code from the
// code form's POST body, and a GET only for a link sent before codes. Every
// sign-in callback marks the browser as known for its address.
export async function GET(req: NextRequest, ctx: Context) {
  const { nextauth } = await ctx.params;
  if (nextauth?.[0] !== "callback") return authHandler(req, ctx);
  if (isEmailCallback(nextauth) && !isLegacyLinkToken(req.nextUrl.searchParams.get("token"))) return refusedLinkResponse();
  const { heard, onSignedIn } = signInListener();
  const context = isEmailCallback(nextauth) ? ({ kind: "link" } as const) : undefined;
  const res: Response = await authHandlerFor(context, onSignedIn)(req, ctx);
  return markKnownBrowser(res, heard.email, req);
}

export async function POST(req: NextRequest, ctx: Context) {
  const { nextauth } = await ctx.params;
  const nextAuthUrl = process.env.NEXTAUTH_URL;

  if (isEmailSignIn(nextauth)) {
    const browserKey = browserKeyOf(req, nextAuthUrl) ?? newBrowserKey();
    let stored = false;
    const res: Response = await authHandlerFor({
      kind: "request",
      browserKey,
      client: clientOf(req.headers),
      knownBrowser: knownBrowserOf(req, nextAuthUrl),
      onStored: () => {
        stored = true;
      },
    })(req, ctx);
    if (stored) res.headers.append("Set-Cookie", codeCookie(nextAuthUrl, req.url).serialize(browserKey));
    return res;
  }

  if (isEmailCallback(nextauth)) {
    const { request, response, browserKey } = await codeCallbackRequest(req, nextAuthUrl);
    if (response) return response;
    const { heard, onSignedIn } = signInListener();
    const res: Response = await authHandlerFor({ kind: "code", browserKey }, onSignedIn)(request, ctx);
    return markKnownBrowser(res, heard.email, req);
  }

  return authHandler(req, ctx);
}
