"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { signIn } from "next-auth/react";
import { SIGN_IN_BUTTON_CLASS } from "@/components/google-sign-in-button";
import { signInErrorMessage } from "@/lib/sign-in-errors";

/** Where the email form is: typing, sending, link sent, or an error code (src/lib/sign-in-errors.ts). */
export type EmailFormStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; code: string };

/** next-auth/react's signIn as the form calls it. */
export type SendEmailSignIn = (
  provider: "email",
  options: { email: string; callbackUrl: string; redirect: false },
) => Promise<{ error?: string | null; ok?: boolean; url?: string | null } | undefined>;

const sendWithNextAuth: SendEmailSignIn = (provider, options) => signIn(provider, options);

/**
 * The same shape NextAuth's Email provider accepts (one "@", a dot in the
 * domain, no quotes or spaces), so the form says what is wrong before asking
 * the server.
 */
export function isPlausibleEmail(value: string): boolean {
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && domain.includes(".") && !/[\s"]/.test(value) && !domain.startsWith(".") && !domain.endsWith(".");
}

/**
 * True when NextAuth answered with its "check your email" page, the only
 * answer that means a link went out. A rejected CSRF token (a failed
 * /api/auth/csrf fetch, blocked cookies) also answers 200 without an error
 * code, but with .../api/auth/signin?csrf=true.
 */
export function isVerifyRequestUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const base = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  try {
    return new URL(url, base).pathname.endsWith("/verify-request");
  } catch {
    return false;
  }
}

/**
 * Asks NextAuth for a magic link without leaving the page
 * (`redirect: false`) and says what happened. Never throws.
 */
export async function sendSignInLink(
  email: string,
  callbackUrl: string,
  send: SendEmailSignIn = sendWithNextAuth,
): Promise<EmailFormStatus> {
  const address = email.trim();
  if (!address) return { kind: "error", code: "EmailRequired" };
  if (!isPlausibleEmail(address)) return { kind: "error", code: "EmailInvalid" };
  try {
    const result = await send("email", { email: address, callbackUrl, redirect: false });
    if (!result) return { kind: "error", code: "Default" };
    if (result.error) return { kind: "error", code: result.error };
    if (result.ok && isVerifyRequestUrl(result.url)) return { kind: "sent", email: address };
    return { kind: "error", code: "Default" };
  } catch {
    return { kind: "error", code: "Network" };
  }
}

export function EnvelopeIcon({ className = "h-4 w-4 text-slate-500" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
    </svg>
  );
}

export const EMAIL_INPUT_ID = "signin-email";
const ERROR_ID = "signin-email-error";

type ViewProps = {
  email: string;
  status: EmailFormStatus;
  onEmailChange: (email: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  resetRef?: RefObject<HTMLButtonElement | null>;
};

/** The form's markup for one status; EmailSignInForm holds the state. */
export function EmailSignInFormView({ email, status, onEmailChange, onSubmit, onReset, inputRef, resetRef }: ViewProps) {
  const sending = status.kind === "sending";
  const error = status.kind === "error" ? signInErrorMessage(status.code) : null;

  return (
    <div className={status.kind === "sent" ? "rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950" : undefined}>
      {/* Always in the page, so screen readers announce what appears in it. */}
      <div role="status" aria-live="polite">
        {sending && <span className="sr-only">Sending your sign-in link…</span>}
        {status.kind === "sent" && (
          <>
            <h2 className="text-lg font-bold">Check your email</h2>
            <p className="mt-1 text-sm">
              We sent a sign-in link to <strong className="break-all">{status.email}</strong>. Open it to finish
              signing in. The link works once and expires in 24 hours.
            </p>
            <p className="mt-2 text-sm">Nothing after a few minutes? Check your spam folder.</p>
          </>
        )}
      </div>

      {status.kind === "sent" ? (
        <button
          ref={resetRef}
          type="button"
          onClick={onReset}
          className="mt-3 rounded text-sm font-semibold text-emerald-900 underline underline-offset-2 hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]"
        >
          Use a different email address
        </button>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-busy={sending}>
          <label htmlFor={EMAIL_INPUT_ID} className="block text-sm font-semibold text-slate-800">
            Email address
          </label>
          <input
            ref={inputRef}
            id={EMAIL_INPUT_ID}
            name="email"
            type="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@example.com"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ERROR_ID : undefined}
            className="mt-1.5 block h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-teal-600 focus:outline-2 focus:outline-offset-1 focus:outline-teal-600 aria-invalid:border-rose-500"
          />
          {error && (
            <p id={ERROR_ID} role="alert" className="mt-2 text-sm text-rose-700">
              {error}
            </p>
          )}
          <button type="submit" disabled={sending} className={`${SIGN_IN_BUTTON_CLASS} mt-4 w-full gap-2`}>
            <EnvelopeIcon />
            {sending ? "Sending link…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * The magic-link form: an email field and a submit button, no popup. The
 * link and its email are still NextAuth's Email provider's, unchanged.
 */
export function EmailSignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<EmailFormStatus>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const focusInputNext = useRef(false);

  // Keep keyboard focus useful when the form changes under it.
  useEffect(() => {
    if (status.kind === "sent") {
      resetRef.current?.focus();
    } else if (status.kind === "error" || focusInputNext.current) {
      focusInputNext.current = false;
      inputRef.current?.focus();
    }
  }, [status]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "sending") return;
    setStatus({ kind: "sending" });
    setStatus(await sendSignInLink(email, callbackUrl));
  }

  return (
    <EmailSignInFormView
      email={email}
      status={status}
      onEmailChange={(value) => {
        setEmail(value);
        if (status.kind === "error") setStatus({ kind: "idle" });
      }}
      onSubmit={submit}
      onReset={() => {
        focusInputNext.current = true;
        setStatus({ kind: "idle" });
      }}
      inputRef={inputRef}
      resetRef={resetRef}
    />
  );
}
