import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmailSignInForm,
  EmailSignInFormView,
  isPlausibleEmail,
  sendSignInLink,
  type EmailFormStatus,
  type SendEmailSignIn,
} from "@/components/email-sign-in-form";

const noop = () => {};

function view(status: EmailFormStatus, email = "alice@example.com") {
  return renderToStaticMarkup(
    createElement(EmailSignInFormView, { email, status, onEmailChange: noop, onSubmit: noop, onReset: noop }),
  );
}

describe("sendSignInLink", () => {
  it("asks NextAuth's Email provider for a link without leaving the page", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => ({ error: null, ok: true }));
    const status = await sendSignInLink("  alice@example.com ", "/t/abc", send);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("email", { email: "alice@example.com", callbackUrl: "/t/abc", redirect: false });
    expect(status).toEqual({ kind: "sent", email: "alice@example.com" });
  });

  it("passes NextAuth's error code on", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => ({ error: "EmailSignin", ok: true }));
    expect(await sendSignInLink("alice@example.com", "/", send)).toEqual({ kind: "error", code: "EmailSignin" });
  });

  it("reports a failed response without a code as Default", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => ({ error: null, ok: false }));
    expect(await sendSignInLink("alice@example.com", "/", send)).toEqual({ kind: "error", code: "Default" });
  });

  it("reports no answer (NextAuth navigated away) as Default", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => undefined);
    expect(await sendSignInLink("alice@example.com", "/", send)).toEqual({ kind: "error", code: "Default" });
  });

  it("reports a thrown error (network down, bad JSON) as Network, without throwing", async () => {
    const send = vi.fn<SendEmailSignIn>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await sendSignInLink("alice@example.com", "/", send)).toEqual({ kind: "error", code: "Network" });
  });

  it("does not call the server for an empty or malformed address", async () => {
    const send = vi.fn<SendEmailSignIn>();
    expect(await sendSignInLink("   ", "/", send)).toEqual({ kind: "error", code: "EmailRequired" });
    expect(await sendSignInLink("alice", "/", send)).toEqual({ kind: "error", code: "EmailInvalid" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("isPlausibleEmail", () => {
  it.each(["a@b.co", "alice.smith+tag@example.co.uk"])("accepts %s", (v) => expect(isPlausibleEmail(v)).toBe(true));
  it.each(["", "alice", "alice@", "@example.com", "a@b@c.com", "alice@localhost", 'a"b@c.com', "a b@c.com", "a@.com", "a@com."])(
    "rejects %j",
    (v) => expect(isPlausibleEmail(v)).toBe(false),
  );
});

describe("EmailSignInFormView", () => {
  it("has a labelled email field and a submit button", () => {
    const html = view({ kind: "idle" }, "");
    expect(html).toContain('<label for="signin-email"');
    expect(html).toContain(">Email address</label>");
    const input = html.match(/<input [^>]*>/)![0];
    for (const attr of ['id="signin-email"', 'name="email"', 'type="email"', 'required=""', /autocomplete="email"/i]) {
      expect(input).toMatch(attr);
    }
    expect(html).toMatch(/<button type="submit" class="[^"]*inline-flex h-10 shrink-0[^"]*w-full[^"]*">.*Email me a sign-in link<\/button>/);
    expect(html).not.toContain('<button type="submit" disabled=""');
    expect(html).not.toContain('role="alert"');
    // The live region is there before anything happens, so later changes are announced.
    expect(html).toContain('<div role="status" aria-live="polite"></div>');
  });

  it("disables the button and says so while sending", () => {
    const html = view({ kind: "sending" });
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>.*Sending link…<\/button>/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<div role="status" aria-live="polite"><span class="sr-only">Sending your sign-in link…</span></div>');
  });

  it("replaces the form with a check-your-email message naming the address", () => {
    const html = view({ kind: "sent", email: "alice@example.com" });
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).toMatch(/<div role="status" aria-live="polite"><h2[^>]*>Check your email<\/h2>/);
    expect(html).toContain("We sent a sign-in link to <strong");
    expect(html).toContain(">alice@example.com</strong>");
    expect(html).toContain(">Use a different email address</button>");
  });

  it("shows an error inline, tied to the field, with role=alert", () => {
    const html = view({ kind: "error", code: "EmailSignin" });
    expect(html).toContain('<p id="signin-email-error" role="alert"');
    expect(html).toContain("We could not send a sign-in link to that address.");
    expect(html).toContain('aria-invalid="true" aria-describedby="signin-email-error"');
    expect(html).toContain("Email me a sign-in link</button>");
  });

  it("explains the form's own errors", () => {
    expect(view({ kind: "error", code: "EmailRequired" }, "")).toContain("Enter your email address.");
    expect(view({ kind: "error", code: "Network" })).toContain("We could not send the link just now.");
  });
});

describe("EmailSignInForm", () => {
  it("starts empty and idle", () => {
    const html = renderToStaticMarkup(createElement(EmailSignInForm, { callbackUrl: "/t/abc" }));
    expect(html).toContain('value=""');
    expect(html).toContain("Email me a sign-in link");
    expect(html).not.toContain('role="alert"');
  });
});
