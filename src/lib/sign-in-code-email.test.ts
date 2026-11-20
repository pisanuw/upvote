import { describe, it, expect, vi, afterEach } from "vitest";
import nodemailer from "nodemailer";
import { fakeSmtp } from "@/__tests__/fake-smtp";
import {
  SIGN_IN_CODE_SUBJECT,
  generateSignInCode,
  sendSignInCodeEmail,
  signInCodeEmail,
  signInPageUrl,
} from "./sign-in-code-email";

const APP = "https://upvoteme.hintwise.org";
const CODE = "042917";
/** What NextAuth hands sendVerificationRequest as `url`: its callback link, code and all. */
const nextAuthUrl = (callbackUrl = `${APP}/t/abc?root=c1`) =>
  `${APP}/api/auth/callback/email?${new URLSearchParams({ callbackUrl, token: CODE, email: "alice@example.com" })}`;

/** Every URL in a text or HTML body. */
function urlsIn(body: string): string[] {
  return [...body.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0].replaceAll("&amp;", "&"));
}

describe("generateSignInCode", () => {
  it("asks crypto.randomInt for 0 to 999999 and keeps leading zeros", () => {
    const random = vi.fn((min: number, max: number) => {
      expect([min, max]).toEqual([0, 1_000_000]);
      return 4217;
    });
    expect(generateSignInCode(random)).toBe("004217");
    expect(generateSignInCode(() => 0)).toBe("000000");
    expect(generateSignInCode(() => 999_999)).toBe("999999");
    expect(random).toHaveBeenCalledOnce();
  });

  it("gives 6 digits from the real crypto.randomInt", () => {
    const codes = Array.from({ length: 2_000 }, () => generateSignInCode());
    for (const code of codes) expect(code).toMatch(/^[0-9]{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(1_900);
  });
});

describe("signInPageUrl", () => {
  it("is the sign-in page with the callbackUrl as a path, and nothing of the code", () => {
    const url = signInPageUrl(nextAuthUrl());
    expect(url).toBe(`${APP}/signin?callbackUrl=/t/abc%3Froot%3Dc1`);
    expect(url).not.toContain(CODE);
    expect(url).not.toContain("token");
    expect(url).not.toContain("email=");
  });

  it.each(["https://evil.example/", `${APP}//evil.example`, "javascript:alert(1)", "/signin"])(
    "sends a callbackUrl of %s to the home page",
    (callbackUrl) => expect(signInPageUrl(nextAuthUrl(callbackUrl))).toBe(`${APP}/signin?callbackUrl=/`),
  );

  it("falls back to the home page without a callbackUrl", () => {
    expect(signInPageUrl(`${APP}/api/auth/callback/email?token=${CODE}`)).toBe(`${APP}/signin?callbackUrl=/`);
  });
});

describe("signInCodeEmail", () => {
  const mail = signInCodeEmail({ code: CODE, signInUrl: signInPageUrl(nextAuthUrl()) });

  it("has the subject, and the code in both bodies", () => {
    expect(mail.subject).toBe(SIGN_IN_CODE_SUBJECT);
    expect(mail.subject).toBe("Your UpvoteMe sign-in code");
    expect(mail.subject).not.toContain(CODE);
    expect(mail.text).toContain(`Your UpvoteMe sign-in code is ${CODE}`);
    expect(mail.html).toContain(`>${CODE}</td>`);
    expect(mail.text).toContain("It expires in 10 minutes");
    expect(mail.html).toContain("It expires in 10 minutes");
  });

  it("links only to the sign-in page, never to a URL that signs anyone in", () => {
    for (const body of [mail.text, mail.html]) {
      const urls = urlsIn(body);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(new URL(url).pathname).toBe("/signin");
        expect(url).not.toContain(CODE);
      }
      expect(body).not.toContain("/api/auth");
      expect(body).not.toContain("token=");
    }
  });

  it("says to go back to the browser that asked, and that the code works only there", () => {
    const words = (body: string) => body.replace(/<[^>]+>/g, "").replace(/&#34;/g, '"').replace(/\s+/g, " ");
    for (const body of [mail.text, mail.html].map(words)) {
      expect(body).toContain("Go back to the tab or browser where you asked for the code and type it there.");
      expect(body).toContain("It works only in that browser.");
      expect(body).toContain('Closed that tab? Open the sign-in page in that same browser and choose "Type a code I asked for in this browser".');
      expect(body).not.toMatch(/any (device|browser)|click|tap the link/i);
    }
  });

  it("escapes the sign-in page address in the HTML", () => {
    const html = signInCodeEmail({ code: CODE, signInUrl: `${APP}/signin?callbackUrl=/t/a"><b>&x` }).html;
    expect(html).toContain('href="https://upvoteme.hintwise.org/signin?callbackUrl=/t/a&#34;&#62;&#60;b&#62;&#38;x"');
    expect(html).not.toContain("<b>");
  });
});

describe("sendSignInCodeEmail", () => {
  const provider = {
    id: "email" as const,
    type: "email" as const,
    name: "Email" as const,
    server: { host: "smtp.test", port: 587, auth: { user: "u", pass: "p" } },
    from: "UpvoteMe <login@upvoteme.test>",
    maxAge: 600,
    sendVerificationRequest: sendSignInCodeEmail,
    options: {},
  };
  const params = {
    identifier: "alice@example.com",
    token: CODE,
    expires: new Date(),
    url: nextAuthUrl(),
    provider,
    theme: {},
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the code email through the provider's SMTP server and sender", async () => {
    const { sent } = fakeSmtp(nodemailer);
    await sendSignInCodeEmail(params);
    expect(sent).toHaveLength(1);
    expect(sent[0].smtp).toEqual(provider.server);
    expect(sent[0].envelope).toEqual({ from: "login@upvoteme.test", to: ["alice@example.com"] });
    expect(sent[0].raw).toMatch(/^Subject: Your UpvoteMe sign-in code\r$/m);
    expect(sent[0].text).toContain(CODE);
    expect(sent[0].raw).not.toContain("/api/auth/callback");
  });

  it("fails when the server refuses the address, naming the address and not the code", async () => {
    const { spy } = fakeSmtp(nodemailer);
    spy.mockImplementation(
      () => ({ sendMail: async () => ({ rejected: ["alice@example.com"], pending: [] }) }) as never,
    );
    const error = await sendSignInCodeEmail(params).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Email (alice@example.com) could not be sent");
    expect((error as Error).message).not.toContain(CODE);
  });
});
