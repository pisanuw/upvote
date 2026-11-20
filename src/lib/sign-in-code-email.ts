/**
 * The sign-in code and its email, for NextAuth's Email provider
 * (generateVerificationToken and sendVerificationRequest in
 * src/lib/auth-options.ts). The email carries the code and a plain link to
 * the sign-in page, never a link that signs anyone in, so a mail scanner
 * that opens links cannot use the code up.
 *
 * The code itself must never be logged or shown anywhere but in the email.
 */
import { randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import type { SendVerificationRequestParams } from "next-auth/providers/email";
import { safeCallbackUrl, signInHref } from "@/lib/callback-url";
import { SIGN_IN_CODE_LENGTH, SIGN_IN_CODE_MINUTES } from "@/lib/sign-in-code";

type RandomInt = (min: number, max: number) => number;

/** 6 random digits from crypto.randomInt, leading zeros kept ("004217"). */
export function generateSignInCode(random: RandomInt = randomInt): string {
  return String(random(0, 10 ** SIGN_IN_CODE_LENGTH)).padStart(SIGN_IN_CODE_LENGTH, "0");
}

export const SIGN_IN_CODE_SUBJECT = "Your UpvoteMe sign-in code";

/**
 * The sign-in page's address for the email: the site's origin, and the
 * callbackUrl NextAuth carried (absolute, same site) as a sanitised path,
 * so a person who opens it on another device comes back to the same page.
 * Only the origin and the callbackUrl are read from NextAuth's callback URL;
 * the code in it is not used.
 */
export function signInPageUrl(nextAuthUrl: string): string {
  const callback = new URL(nextAuthUrl);
  let path = "/";
  const target = callback.searchParams.get("callbackUrl");
  if (target) {
    try {
      const parsed = new URL(target, callback.origin);
      if (parsed.origin === callback.origin) path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      path = "/";
    }
  }
  return `${callback.origin}${signInHref(safeCallbackUrl(path))}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface SignInCodeEmail {
  subject: string;
  text: string;
  html: string;
}

/** The email's subject and bodies. */
export function signInCodeEmail({ code, signInUrl }: { code: string; signInUrl: string }): SignInCodeEmail {
  const expiry = `It expires in ${SIGN_IN_CODE_MINUTES} minutes and works once.`;
  const text = [
    `Your UpvoteMe sign-in code is ${code}`,
    "",
    `Type it on the UpvoteMe sign-in page to finish signing in. ${expiry} Do not share it with anyone.`,
    "",
    `Sign-in page: ${signInUrl}`,
    "",
    "If you did not ask to sign in to UpvoteMe, you can ignore this email.",
    "",
  ].join("\n");

  const font = "font-family: Helvetica, Arial, sans-serif;";
  const html = `<body style="background: #f8fafc; margin: 0; padding: 24px 12px;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"
    style="background: #ffffff; max-width: 480px; margin: auto; border-radius: 12px; color: #0f172a;">
    <tr>
      <td style="padding: 24px 24px 4px; font-size: 18px; ${font}">Your UpvoteMe sign-in code</td>
    </tr>
    <tr>
      <td style="padding: 8px 24px; font-size: 34px; font-weight: bold; letter-spacing: 6px; font-family: Menlo, Consolas, monospace;">${escapeHtml(code)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 24px; font-size: 15px; line-height: 22px; ${font}">Type it on the UpvoteMe sign-in page to finish signing in. ${expiry} Do not share it with anyone.</td>
    </tr>
    <tr>
      <td style="padding: 8px 24px; font-size: 15px; line-height: 22px; ${font}"><a href="${escapeHtml(signInUrl)}" style="color: #0b57d0;">Open the sign-in page</a></td>
    </tr>
    <tr>
      <td style="padding: 8px 24px 24px; font-size: 13px; line-height: 20px; color: #475569; ${font}">If you did not ask to sign in to UpvoteMe, you can ignore this email.</td>
    </tr>
  </table>
</body>
`;

  return { subject: SIGN_IN_CODE_SUBJECT, text, html };
}

/**
 * NextAuth's sendVerificationRequest for codes: the same SMTP server and
 * sender as before (the provider's server and from, AUTH_SMTP_*), a code
 * email instead of a link. An error names the address, never the code.
 */
export async function sendSignInCodeEmail({ identifier, token, url, provider }: SendVerificationRequestParams): Promise<void> {
  const mail = signInCodeEmail({ code: token, signInUrl: signInPageUrl(url) });
  const transport = nodemailer.createTransport(provider.server);
  const result = await transport.sendMail({ to: identifier, from: provider.from, ...mail });
  const failed = [...result.rejected, ...(result.pending ?? [])].filter(Boolean);
  if (failed.length) throw new Error(`Email (${failed.join(", ")}) could not be sent`);
}
