import type { NextRequest } from "next/server";
import { authHandler } from "@/auth";
import { codeCallbackRequest, isEmailCallback, isLegacyLinkToken, refusedLinkResponse } from "@/lib/sign-in-code-route";

type Context = { params: Promise<{ nextauth: string[] }> };

// The email callback takes a sign-in code from the code form's POST body,
// and a GET only for a link sent before codes (src/lib/sign-in-code-route.ts).
export async function GET(req: NextRequest, ctx: Context) {
  const { nextauth } = await ctx.params;
  if (isEmailCallback(nextauth) && !isLegacyLinkToken(req.nextUrl.searchParams.get("token"))) {
    return refusedLinkResponse();
  }
  return authHandler(req, ctx);
}

export async function POST(req: NextRequest, ctx: Context) {
  const { nextauth } = await ctx.params;
  if (!isEmailCallback(nextauth)) return authHandler(req, ctx);
  const { request, response } = await codeCallbackRequest(req);
  return response ?? authHandler(request, ctx);
}
