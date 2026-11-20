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
  newBrowserKey,
  refusedLinkResponse,
} from "@/lib/sign-in-code-route";

type Context = { params: Promise<{ nextauth: string[] }> };

// Sign-in codes (src/lib/sign-in-code-route.ts): a code request ties the code
// to the asking browser's cookie; the email callback takes a code from the
// code form's POST body, and a GET only for a link sent before codes.
export async function GET(req: NextRequest, ctx: Context) {
  const { nextauth } = await ctx.params;
  if (!isEmailCallback(nextauth)) return authHandler(req, ctx);
  if (!isLegacyLinkToken(req.nextUrl.searchParams.get("token"))) return refusedLinkResponse();
  return authHandlerFor({ kind: "link" })(req, ctx);
}

export async function POST(req: NextRequest, ctx: Context) {
  const { nextauth } = await ctx.params;
  const nextAuthUrl = process.env.NEXTAUTH_URL;

  if (isEmailSignIn(nextauth)) {
    const cookie = codeCookie(nextAuthUrl);
    const browserKey = browserKeyOf(req, nextAuthUrl) ?? newBrowserKey();
    let stored = false;
    const res: Response = await authHandlerFor({
      kind: "request",
      browserKey,
      client: clientOf(req.headers),
      onStored: () => {
        stored = true;
      },
    })(req, ctx);
    if (stored) res.headers.append("Set-Cookie", cookie.serialize(browserKey));
    return res;
  }

  if (isEmailCallback(nextauth)) {
    const { request, response, browserKey } = await codeCallbackRequest(req, nextAuthUrl);
    return response ?? authHandlerFor({ kind: "code", browserKey })(request, ctx);
  }

  return authHandler(req, ctx);
}
