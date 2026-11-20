import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CODE_CALLBACK_PATH,
  EmailSignInForm,
  EmailSignInFormView,
  afterFailedCode,
  focusSignInField,
  isPlausibleEmail,
  isVerifyRequestUrl,
  requestSignInCode,
  signInAnswerError,
  verifySignInCode,
  type CodeStep,
  type EmailFormStatus,
  type PostSignInCode,
  type SendEmailSignIn,
} from "@/components/email-sign-in-form";

const noop = () => {};

function view(status: EmailFormStatus, email = "alice@example.com", code = "") {
  return renderToStaticMarkup(
    createElement(EmailSignInFormView, {
      email,
      code,
      status,
      onEmailChange: noop,
      onCodeChange: noop,
      onSubmit: noop,
      onVerify: noop,
      onResend: noop,
      onReset: noop,
    }),
  );
}

const codeStep = (over: Partial<CodeStep> = {}): CodeStep => ({
  kind: "code",
  email: "alice@example.com",
  note: "sent",
  wrong: 0,
  ...over,
});

const VERIFY_REQUEST = "http://localhost:3000/api/auth/verify-request?provider=email&type=email";
const CSRF_REJECTED = "http://localhost:3000/api/auth/signin?csrf=true";

describe("requestSignInCode", () => {
  it("asks NextAuth's Email provider for a code without leaving the page", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => ({ error: null, status: 200, ok: true, url: VERIFY_REQUEST }));
    const result = await requestSignInCode("  alice@example.com ", "/t/abc", send);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("email", { email: "alice@example.com", callbackUrl: "/t/abc", redirect: false });
    expect(result).toEqual({ kind: "sent", email: "alice@example.com" });
  });

  it.each(["EmailSignin", "EmailCodeWait", "EmailCodeLimit"])("passes NextAuth's error code %s on", async (code) => {
    const send = vi.fn<SendEmailSignIn>(async () => ({ error: code, ok: true }));
    expect(await requestSignInCode("alice@example.com", "/", send)).toEqual({ kind: "error", code });
  });

  it("reports a failed response without a code as Default", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => ({ error: null, ok: false, url: VERIFY_REQUEST }));
    expect(await requestSignInCode("alice@example.com", "/", send)).toEqual({ kind: "error", code: "Default" });
  });

  it("does not say 'sent' when NextAuth rejected the CSRF token (200, no error, .../signin?csrf=true)", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => ({ error: null, status: 200, ok: true, url: CSRF_REJECTED }));
    expect(await requestSignInCode("alice@example.com", "/", send)).toEqual({ kind: "error", code: "Default" });
  });

  it("does not say 'sent' without NextAuth's verify-request address", async () => {
    for (const url of [null, undefined, "", "http://localhost:3000/", "http://[bad"]) {
      const send = vi.fn<SendEmailSignIn>(async () => ({ error: null, ok: true, url }));
      expect(await requestSignInCode("alice@example.com", "/", send)).toEqual({ kind: "error", code: "Default" });
    }
  });

  it("reports no answer (NextAuth navigated away) as Default", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => undefined);
    expect(await requestSignInCode("alice@example.com", "/", send)).toEqual({ kind: "error", code: "Default" });
  });

  it("reports a thrown error (network down, bad JSON) as Network, without throwing", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await requestSignInCode("alice@example.com", "/", send)).toEqual({ kind: "error", code: "Network" });
  });

  it("does not call the server for an empty or malformed address", async () => {
    const send = vi.fn<SendEmailSignIn>();
    expect(await requestSignInCode("   ", "/", send)).toEqual({ kind: "error", code: "EmailRequired" });
    expect(await requestSignInCode("alice", "/", send)).toEqual({ kind: "error", code: "EmailInvalid" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("verifySignInCode", () => {
  const signedIn: PostSignInCode = async () => ({ ok: true, url: "http://localhost:3000/t/abc" });

  it("posts the address, the 6 digits and the callbackUrl, and reports the sign-in", async () => {
    const post = vi.fn<PostSignInCode>(signedIn);
    expect(await verifySignInCode(" alice@example.com ", "042917", "/t/abc", post)).toEqual({ kind: "signed-in" });
    expect(post).toHaveBeenCalledOnce();
    expect(Object.fromEntries(post.mock.calls[0][0])).toEqual({ email: "alice@example.com", code: "042917", callbackUrl: "/t/abc" });
  });

  it.each(["123 456", "123-456", " 123456 ", "１２３４５６"])("accepts a pasted %j as 123456", async (typed) => {
    const post = vi.fn<PostSignInCode>(signedIn);
    await verifySignInCode("alice@example.com", typed, "/", post);
    expect(post.mock.calls[0][0].get("code")).toBe("123456");
  });

  it("does not call the server for an empty or malformed code", async () => {
    const post = vi.fn<PostSignInCode>();
    expect(await verifySignInCode("alice@example.com", "  ", "/", post)).toEqual({ kind: "error", code: "CodeRequired" });
    expect(await verifySignInCode("alice@example.com", "12345", "/", post)).toEqual({ kind: "error", code: "CodeInvalid" });
    expect(await verifySignInCode("alice@example.com", "12345a", "/", post)).toEqual({ kind: "error", code: "CodeInvalid" });
    expect(post).not.toHaveBeenCalled();
  });

  it("reads NextAuth's Verification answer as a wrong or expired code", async () => {
    const post = vi.fn<PostSignInCode>(async () => ({ ok: true, url: "http://localhost:3000/api/auth/error?error=Verification" }));
    expect(await verifySignInCode("alice@example.com", "123456", "/", post)).toEqual({ kind: "error", code: "CodeWrong" });
  });

  it("passes other error codes on, and treats an error page without a code as Default", async () => {
    const answers: [string | null, string][] = [
      ["http://localhost:3000/api/auth/error?error=AccessDenied", "AccessDenied"],
      ["/api/auth/error?error=Verification", "CodeWrong"],
      ["http://localhost:3000/api/auth/error", "Default"],
      ["http://localhost:3000/api/auth/signin?csrf=true", "Default"],
      [null, "Default"],
    ];
    for (const [url, code] of answers) {
      const post = vi.fn<PostSignInCode>(async () => ({ ok: true, url }));
      expect(await verifySignInCode("alice@example.com", "123456", "/", post)).toEqual({ kind: "error", code });
    }
  });

  it("reports a failed response as Default, and a thrown error as Network", async () => {
    const forbidden = vi.fn<PostSignInCode>(async () => ({ ok: false, url: null }));
    expect(await verifySignInCode("alice@example.com", "123456", "/", forbidden)).toEqual({ kind: "error", code: "Default" });
    const offline = vi.fn<PostSignInCode>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await verifySignInCode("alice@example.com", "123456", "/", offline)).toEqual({ kind: "error", code: "Network" });
  });

  describe("with the real fetch call", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("posts a form body to NextAuth's email callback, with the code only in the body", async () => {
      const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(JSON.stringify({ url: "http://localhost:3000/t/abc" }), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      expect(await verifySignInCode("alice@example.com", "123 456", "/t/abc")).toEqual({ kind: "signed-in" });
      const [input, init] = fetchMock.mock.calls[0];
      expect(input).toBe(CODE_CALLBACK_PATH);
      expect(String(input)).not.toContain("123456");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
      expect(String(init?.body)).toBe("email=alice%40example.com&code=123456&callbackUrl=%2Ft%2Fabc");
    });

    it("treats a non-JSON answer as Default", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
      expect(await verifySignInCode("alice@example.com", "123456", "/")).toEqual({ kind: "error", code: "Default" });
    });
  });
});

describe("signInAnswerError", () => {
  it("is null for the callbackUrl NextAuth answers with on success", () => {
    expect(signInAnswerError("http://localhost:3000/t/abc?root=c1")).toBeNull();
    expect(signInAnswerError("http://localhost:3000/")).toBeNull();
  });
});

describe("afterFailedCode", () => {
  it("counts wrong codes and says the code is void at the 5th", () => {
    let step = codeStep();
    for (let i = 1; i <= 4; i++) {
      step = afterFailedCode(step, "CodeWrong");
      expect(step).toMatchObject({ wrong: i, error: "CodeWrong", email: "alice@example.com" });
    }
    step = afterFailedCode(step, "CodeWrong");
    expect(step).toMatchObject({ wrong: 5, error: "CodeTooManyTries" });
    expect(afterFailedCode(step, "CodeWrong")).toMatchObject({ wrong: 6, error: "CodeTooManyTries" });
  });

  it("keeps the address and does not count other errors", () => {
    expect(afterFailedCode(codeStep({ wrong: 2, busy: "verifying" }), "Network")).toEqual(
      codeStep({ wrong: 2, error: "Network", busy: undefined }),
    );
  });
});

describe("isVerifyRequestUrl", () => {
  it.each([VERIFY_REQUEST, "/api/auth/verify-request", "https://upvoteme.hintwise.org/api/auth/verify-request?provider=email"])(
    "accepts %s",
    (url) => expect(isVerifyRequestUrl(url)).toBe(true),
  );
  it.each([CSRF_REJECTED, "http://localhost:3000/api/auth/error?error=EmailSignin", "/t/verify-request-x", null, ""])(
    "rejects %j",
    (url) => expect(isVerifyRequestUrl(url)).toBe(false),
  );
});

/**
 * The same cases through next-auth/react's own signIn: only the server's
 * answers are stubbed (fetch), so the result shapes are the real ones.
 */
describe("requestSignInCode with next-auth/react's signIn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serverAnswers(signinUrl: string) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${(init?.method ?? "GET").toUpperCase()} ${new URL(url).pathname}`);
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.endsWith("/api/auth/providers")) return json({ email: { id: "email", name: "Email", type: "email" } });
        if (url.endsWith("/api/auth/csrf")) return json({ csrfToken: "test-token" });
        if (url.endsWith("/api/auth/signin/email")) {
          const body = new URLSearchParams(String(init?.body));
          calls.push(`body email=${body.get("email")} callbackUrl=${body.get("callbackUrl")} json=${body.get("json")}`);
          return json({ url: signinUrl });
        }
        if (url.endsWith("/api/auth/session")) return json({});
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    return calls;
  }

  it("says 'sent' for the verify-request answer, and posts the address and callbackUrl", async () => {
    const calls = serverAnswers(VERIFY_REQUEST);
    expect(await requestSignInCode("alice@example.com", "/t/abc", undefined)).toEqual({ kind: "sent", email: "alice@example.com" });
    expect(calls).toContain("POST /api/auth/signin/email");
    expect(calls).toContain("body email=alice@example.com callbackUrl=/t/abc json=true");
  });

  it("shows Default, not 'Check your email', for a rejected CSRF token", async () => {
    serverAnswers(CSRF_REJECTED);
    expect(await requestSignInCode("alice@example.com", "/", undefined)).toEqual({ kind: "error", code: "Default" });
  });

  it.each(["EmailSignin", "EmailCodeWait"])("passes %s on", async (code) => {
    serverAnswers(`http://localhost:3000/api/auth/error?error=${code}`);
    expect(await requestSignInCode("alice@example.com", "/", undefined)).toEqual({ kind: "error", code });
  });
});

describe("isPlausibleEmail", () => {
  it.each(["a@b.co", "alice.smith+tag@example.co.uk"])("accepts %s", (v) => expect(isPlausibleEmail(v)).toBe(true));
  it.each([
    "",
    "alice",
    "alice@",
    "@example.com",
    "a@b@c.com",
    "alice@localhost",
    'a"b@c.com',
    "a b@c.com",
    "a@.com",
    "a@com.",
    "a <victim@uw.test>",
    "victim@uw.test,x.co",
    "victim@uw.test;x.co",
    "(x)victim@uw.test",
    "a:victim@uw.test",
  ])(
    "rejects %j",
    (v) => expect(isPlausibleEmail(v)).toBe(false),
  );
});

describe("EmailSignInFormView, email step", () => {
  it("has a labelled email field and the send button, and no way in without asking for a code here", () => {
    const html = view({ kind: "idle" }, "");
    expect(html).toContain('<label for="signin-email"');
    expect(html).toContain(">Email address</label>");
    const input = html.match(/<input [^>]*>/)![0];
    for (const attr of ['id="signin-email"', 'name="email"', 'type="email"', 'required=""', /autocomplete="email"/i]) {
      expect(input).toMatch(attr);
    }
    expect(html).toMatch(/<button type="submit" class="[^"]*inline-flex h-10 shrink-0[^"]*w-full[^"]*">.*Email me a sign-in code<\/button>/);
    expect(html).not.toContain("already have a code");
    expect(html).not.toContain('<button type="button"');
    expect(html).not.toContain('<button type="submit" disabled=""');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("link");
    // The live region is there before anything happens, so later changes are announced.
    expect(html).toContain('<div role="status" aria-live="polite"></div>');
  });

  it("disables the button and says so while sending", () => {
    const html = view({ kind: "sending" });
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>.*Sending code…<\/button>/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<div role="status" aria-live="polite"><span class="sr-only">Sending your sign-in code…</span></div>');
  });

  it("shows an error inline, tied to the field, with role=alert", () => {
    const html = view({ kind: "error", code: "EmailSignin" });
    expect(html).toContain('<p id="signin-email-error" role="alert"');
    expect(html).toContain("We could not send a sign-in code to that address.");
    expect(html).toContain('aria-invalid="true" aria-describedby="signin-email-error"');
    expect(html).toContain("Email me a sign-in code</button>");
  });

  it("explains the form's own errors and the server's limits", () => {
    expect(view({ kind: "error", code: "EmailRequired" }, "")).toContain("Enter your email address.");
    expect(view({ kind: "error", code: "Network" })).toContain("We could not reach UpvoteMe just now.");
    expect(view({ kind: "error", code: "EmailCodeWait" })).toContain("less than a minute ago. Wait a minute, then ask for a new one.");
    expect(view({ kind: "error", code: "EmailCodeLimit" })).toContain("as many sign-in codes as we can for now");
    expect(view({ kind: "error", code: "EmailCodeClientLimit" })).toContain("from your network");
  });
});

describe("EmailSignInFormView, code step", () => {
  it("names the address, in the live region, and has a labelled one-time-code field", () => {
    const html = view(codeStep());
    expect(html).toMatch(/<div role="status" aria-live="polite" class="[^"]*bg-emerald-50[^"]*"><h2[^>]*>Check your email<\/h2>/);
    expect(html).toContain("We sent a 6-digit code to <strong");
    expect(html).toContain(">alice@example.com</strong>. It expires in 10 minutes.");
    expect(html).toContain("Type it here, in this browser.");
    expect(html).toContain('<label for="signin-code"');
    expect(html).toContain(">Sign-in code</label>");
    const input = html.match(/<input [^>]*>/)![0];
    for (const attr of [
      'id="signin-code"',
      'name="code"',
      'type="text"',
      'inputMode="numeric"',
      'autoComplete="one-time-code"',
      'aria-describedby="signin-code-hint"',
    ]) {
      expect(input).toContain(attr);
    }
    expect(input).not.toContain("maxLength");
    expect(html).toContain('<p id="signin-code-hint"');
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain('role="alert"');
  });

  it("has Sign in, Send a new code, and Use a different email address", () => {
    const html = view(codeStep());
    expect(html).toMatch(/<button type="submit" class="[^"]*w-full[^"]*">Sign in<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>Send a new code<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>Use a different email address<\/button>/);
  });

  it("keeps the address and the code step after a wrong code, with the error tied to the field", () => {
    const html = view(afterFailedCode(codeStep(), "CodeWrong"), "alice@example.com", "111111");
    expect(html).toContain(">alice@example.com</strong>");
    expect(html).toContain('<p id="signin-code-error" role="alert"');
    expect(html).toContain("That code is wrong or has expired.");
    const input = html.match(/<input [^>]*>/)![0];
    expect(input).toContain('value="111111"');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="signin-code-hint signin-code-error"');
    expect(html).not.toContain("Unable to sign in");
  });

  it("asks for a new code after 5 wrong codes", () => {
    let step = codeStep();
    for (let i = 0; i < 5; i++) step = afterFailedCode(step, "CodeWrong");
    expect(view(step)).toContain("Too many wrong tries for this code, so it no longer works. Send a new code.");
  });

  it("says a new code went out, and that earlier codes no longer work", () => {
    expect(view(codeStep({ note: "resent" }))).toContain("We sent a new code to <strong");
    expect(view(codeStep({ note: "resent" }))).toContain("Earlier codes no longer work.");
  });

  it("disables the buttons and says so while checking, resending, and after signing in", () => {
    const verifying = view(codeStep({ busy: "verifying" }));
    expect(verifying).toMatch(/<button type="submit" disabled=""[^>]*>Signing in…<\/button>/);
    expect(verifying).toContain('<span class="sr-only">Checking your code…</span>');
    expect(verifying).toContain('aria-busy="true"');
    const resending = view(codeStep({ busy: "resending" }));
    expect(resending).toMatch(/<button type="button" disabled=""[^>]*>Sending a new code…<\/button>/);
    expect(resending).toContain('<span class="sr-only">Sending a new code…</span>');
    expect(view(codeStep({ busy: "signed-in" }))).toContain("Signed in. Taking you back…");
  });

  it("explains a refused new code in the code step, pointing at the code already sent", () => {
    const html = view(codeStep({ error: "CodeResendWait" }));
    expect(html).toContain('<p id="signin-code-error" role="alert"');
    expect(html).toContain("We sent a code less than a minute ago. Use that one, or wait a minute and send a new code.");
  });
});

describe("EmailSignInForm", () => {
  it("starts empty and idle, on the email step", () => {
    const html = renderToStaticMarkup(createElement(EmailSignInForm, { callbackUrl: "/t/abc" }));
    expect(html).toContain('value=""');
    expect(html).toContain("Email me a sign-in code");
    expect(html).not.toContain('id="signin-code"');
    expect(html).not.toContain('role="alert"');
  });
});

describe("focusSignInField", () => {
  function fakeDocument(ids: string[]) {
    const focused: string[] = [];
    return {
      focused,
      doc: {
        getElementById: (id: string) => (ids.includes(id) ? ({ focus: () => focused.push(id) } as unknown as HTMLElement) : null),
      },
    };
  }

  it("focuses the email field on the email step", () => {
    const { doc, focused } = fakeDocument(["signin-email"]);
    focusSignInField(doc);
    expect(focused).toEqual(["signin-email"]);
  });

  it("focuses the code field on the code step, where there is no email field", () => {
    const { doc, focused } = fakeDocument(["signin-code"]);
    focusSignInField(doc);
    expect(focused).toEqual(["signin-code"]);
  });

  it("does nothing off the sign-in form", () => {
    const { doc, focused } = fakeDocument([]);
    focusSignInField(doc);
    expect(focused).toEqual([]);
  });
});
