"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { signIn } from "next-auth/react";
import { SIGN_IN_BUTTON_CLASS } from "@/components/google-sign-in-button";
import { signInErrorMessage } from "@/lib/sign-in-errors";
import { MAX_WRONG_CODES, SIGN_IN_CODE_LENGTH, SIGN_IN_CODE_MINUTES, normalizeSignInCode } from "@/lib/sign-in-code";

/**
 * The code step: the address the code went to, how the person got here
 * ("sent", "resent", or "entered": they already had a code), what is
 * happening, an error code (src/lib/sign-in-errors.ts), and the wrong codes
 * typed since the last code was sent.
 */
export type CodeStep = {
  kind: "code";
  email: string;
  note: "sent" | "resent" | "entered";
  busy?: "verifying" | "resending" | "signed-in";
  error?: string;
  wrong: number;
};

/** Where the email form is: the email step (typing, sending, an error) or the code step. */
export type EmailFormStatus = { kind: "idle" } | { kind: "sending" } | { kind: "error"; code: string } | CodeStep;

/** The outcome of asking for a code. */
export type CodeRequestResult = { kind: "sent"; email: string } | { kind: "error"; code: string };

/** The outcome of typing a code. */
export type CodeCheckResult = { kind: "signed-in" } | { kind: "error"; code: string };

/** next-auth/react's signIn as the form calls it. */
export type SendEmailSignIn = (
  provider: "email",
  options: { email: string; callbackUrl: string; redirect: false },
) => Promise<{ error?: string | null; ok?: boolean; url?: string | null } | undefined>;

/** Posts the code form's body to NextAuth's email callback; the JSON answer's url. */
export type PostSignInCode = (body: URLSearchParams) => Promise<{ ok: boolean; url: string | null }>;

const sendWithNextAuth: SendEmailSignIn = (provider, options) => signIn(provider, options);

export const CODE_CALLBACK_PATH = "/api/auth/callback/email";

const postToNextAuth: PostSignInCode = async (body) => {
  const res = await fetch(CODE_CALLBACK_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data: unknown = await res.json().catch(() => null);
  const url = typeof data === "object" && data !== null ? (data as { url?: unknown }).url : null;
  return { ok: res.ok, url: typeof url === "string" ? url : null };
};

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

function baseUrl(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

/**
 * True when NextAuth answered with its "check your email" page, the only
 * answer that means a code went out. A rejected CSRF token (a failed
 * /api/auth/csrf fetch, blocked cookies) also answers 200 without an error
 * code, but with .../api/auth/signin?csrf=true.
 */
export function isVerifyRequestUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url, baseUrl()).pathname.endsWith("/verify-request");
  } catch {
    return false;
  }
}

/**
 * The error code in NextAuth's answer to a code, or null when it signed the
 * person in (it answers with the callbackUrl). Anything under /api/auth/ is
 * an error page, with or without ?error=.
 */
export function signInAnswerError(url: string | null): string | null {
  if (!url) return "Default";
  try {
    const parsed = new URL(url, baseUrl());
    const error = parsed.searchParams.get("error");
    if (error) return error;
    return parsed.pathname.startsWith("/api/auth/") ? "Default" : null;
  } catch {
    return "Default";
  }
}

/** The email step's error for an address the server would refuse, or null. */
function checkAddress(email: string): { kind: "error"; code: string } | null {
  const address = email.trim();
  if (!address) return { kind: "error", code: "EmailRequired" };
  if (!isPlausibleEmail(address)) return { kind: "error", code: "EmailInvalid" };
  return null;
}

/**
 * Asks NextAuth's Email provider to email a code, without leaving the page
 * (`redirect: false`), and says what happened. Never throws.
 */
export async function requestSignInCode(
  email: string,
  callbackUrl: string,
  send: SendEmailSignIn = sendWithNextAuth,
): Promise<CodeRequestResult> {
  const invalid = checkAddress(email);
  if (invalid) return invalid;
  const address = email.trim();
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

/**
 * Checks a typed code with NextAuth's email callback (the code in the POST
 * body, src/lib/sign-in-code-route.ts). On success the session cookie is
 * set and the caller moves on to callbackUrl. Never throws.
 */
export async function verifySignInCode(
  email: string,
  typed: string,
  callbackUrl: string,
  post: PostSignInCode = postToNextAuth,
): Promise<CodeCheckResult> {
  if (!typed.trim()) return { kind: "error", code: "CodeRequired" };
  const code = normalizeSignInCode(typed);
  if (!code) return { kind: "error", code: "CodeInvalid" };
  try {
    const answer = await post(new URLSearchParams({ email: email.trim(), code, callbackUrl }));
    if (!answer.ok) return { kind: "error", code: "Default" };
    const error = signInAnswerError(answer.url);
    if (error === "Verification") return { kind: "error", code: "CodeWrong" };
    return error ? { kind: "error", code: error } : { kind: "signed-in" };
  } catch {
    return { kind: "error", code: "Network" };
  }
}

/** The code step after a wrong or failed code: the error to show and the wrong-code count. */
export function afterFailedCode(step: CodeStep, code: string): CodeStep {
  if (code !== "CodeWrong") return { ...step, busy: undefined, error: code };
  const wrong = step.wrong + 1;
  return { ...step, busy: undefined, wrong, error: wrong >= MAX_WRONG_CODES ? "CodeTooManyTries" : "CodeWrong" };
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
export const CODE_INPUT_ID = "signin-code";
const EMAIL_ERROR_ID = "signin-email-error";
const CODE_HINT_ID = "signin-code-hint";
const CODE_ERROR_ID = "signin-code-error";

const INPUT_CLASS =
  "mt-1.5 block h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-teal-600 focus:outline-2 focus:outline-offset-1 focus:outline-teal-600 aria-invalid:border-rose-500";
const TEXT_BUTTON_CLASS =
  "rounded text-sm font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0] disabled:opacity-60";

type ViewProps = {
  email: string;
  code: string;
  status: EmailFormStatus;
  onEmailChange: (email: string) => void;
  onCodeChange: (code: string) => void;
  /** The email step's submit: email me a code. */
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** "I already have a code": the code step for the typed address. */
  onHaveCode: () => void;
  /** The code step's submit: check the code. */
  onVerify: (e: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  onReset: () => void;
  emailRef?: RefObject<HTMLInputElement | null>;
  codeRef?: RefObject<HTMLInputElement | null>;
};

function StatusText({ status }: { status: EmailFormStatus }) {
  if (status.kind === "sending") return <span className="sr-only">Sending your sign-in code…</span>;
  if (status.kind !== "code") return null;
  // Wraps inside the address only when it is longer than a line.
  const address = <strong className="wrap-anywhere">{status.email}</strong>;
  return (
    <>
      <h2 className="text-lg font-bold">{status.note === "entered" ? "Enter your code" : "Check your email"}</h2>
      <p className="mt-1 text-sm">
        {status.note === "sent" && (
          <>
            We sent a {SIGN_IN_CODE_LENGTH}-digit code to {address}. It expires in {SIGN_IN_CODE_MINUTES} minutes.
          </>
        )}
        {status.note === "resent" && (
          <>
            We sent a new code to {address}. Earlier codes no longer work.
          </>
        )}
        {status.note === "entered" && (
          <>
            Type the {SIGN_IN_CODE_LENGTH}-digit code from the email we sent to {address}.
          </>
        )}
      </p>
      {status.note !== "entered" && <p className="mt-1 text-sm">Nothing after a few minutes? Check your spam folder.</p>}
      {status.busy === "verifying" && <span className="sr-only">Checking your code…</span>}
      {status.busy === "resending" && <span className="sr-only">Sending a new code…</span>}
      {status.busy === "signed-in" && <p className="mt-2 text-sm font-semibold">Signed in. Taking you back…</p>}
    </>
  );
}

function EmailStep({ email, status, onEmailChange, onSubmit, onHaveCode, emailRef }: ViewProps) {
  const sending = status.kind === "sending";
  const error = status.kind === "error" ? signInErrorMessage(status.code) : null;
  return (
    <form onSubmit={onSubmit} noValidate aria-busy={sending}>
      <label htmlFor={EMAIL_INPUT_ID} className="block text-sm font-semibold text-slate-800">
        Email address
      </label>
      <input
        ref={emailRef}
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
        aria-describedby={error ? EMAIL_ERROR_ID : undefined}
        className={INPUT_CLASS}
      />
      {error && (
        <p id={EMAIL_ERROR_ID} role="alert" className="mt-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={sending} className={`${SIGN_IN_BUTTON_CLASS} mt-4 w-full gap-2`}>
        <EnvelopeIcon />
        {sending ? "Sending code…" : "Email me a sign-in code"}
      </button>
      <button type="button" disabled={sending} onClick={onHaveCode} className={`${TEXT_BUTTON_CLASS} mt-3 text-slate-700 hover:text-slate-900`}>
        I already have a code
      </button>
    </form>
  );
}

function CodeStepForm({ code, status, onCodeChange, onVerify, onResend, onReset, codeRef }: ViewProps & { status: CodeStep }) {
  const busy = status.busy !== undefined;
  const error = status.error ? signInErrorMessage(status.error) : null;
  return (
    <>
      <form onSubmit={onVerify} noValidate aria-busy={busy} className="mt-4">
        <label htmlFor={CODE_INPUT_ID} className="block text-sm font-semibold text-slate-800">
          Sign-in code
        </label>
        <p id={CODE_HINT_ID} className="mt-0.5 text-sm text-slate-600">
          {SIGN_IN_CODE_LENGTH} digits, from the email.
        </p>
        <input
          ref={codeRef}
          id={CODE_INPUT_ID}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${CODE_HINT_ID} ${CODE_ERROR_ID}` : CODE_HINT_ID}
          className={`${INPUT_CLASS} font-mono text-lg tracking-[0.3em]`}
        />
        {error && (
          <p id={CODE_ERROR_ID} role="alert" className="mt-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${SIGN_IN_BUTTON_CLASS} mt-4 w-full`}>
          {status.busy === "verifying" ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        <button type="button" disabled={busy} onClick={onResend} className={`${TEXT_BUTTON_CLASS} text-slate-700 hover:text-slate-900`}>
          {status.busy === "resending" ? "Sending a new code…" : "Send a new code"}
        </button>
        <button type="button" disabled={busy} onClick={onReset} className={`${TEXT_BUTTON_CLASS} text-slate-700 hover:text-slate-900`}>
          Use a different email address
        </button>
      </div>
    </>
  );
}

/** The form's markup for one status; EmailSignInForm holds the state. */
export function EmailSignInFormView(props: ViewProps) {
  const { status } = props;
  return (
    <div>
      {/* Always in the page, so screen readers announce what appears in it. */}
      <div
        role="status"
        aria-live="polite"
        className={status.kind === "code" ? "rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950" : undefined}
      >
        <StatusText status={status} />
      </div>
      {status.kind === "code" ? <CodeStepForm {...props} status={status} /> : <EmailStep {...props} />}
    </div>
  );
}

/**
 * Sign-in by email: the address, then the 6-digit code from the email, on
 * one page. The code can be typed on any device: the server checks it
 * against the address, nothing is kept in this browser.
 */
export function EmailSignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<EmailFormStatus>({ kind: "idle" });
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const focusEmailNext = useRef(false);

  // Keep keyboard focus useful when the form changes under it.
  useEffect(() => {
    if (status.kind === "code") {
      if (status.busy) return;
      codeRef.current?.focus();
      if (status.error) codeRef.current?.select();
    } else if (status.kind === "error" || focusEmailNext.current) {
      focusEmailNext.current = false;
      emailRef.current?.focus();
    }
  }, [status]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "sending") return;
    setStatus({ kind: "sending" });
    const result = await requestSignInCode(email, callbackUrl);
    if (result.kind === "error") return setStatus(result);
    setCode("");
    setStatus({ kind: "code", email: result.email, note: "sent", wrong: 0 });
  }

  function haveCode() {
    const invalid = checkAddress(email);
    if (invalid) return setStatus(invalid);
    setCode("");
    setStatus({ kind: "code", email: email.trim(), note: "entered", wrong: 0 });
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind !== "code" || status.busy) return;
    const step = status;
    setStatus({ ...step, busy: "verifying", error: undefined });
    const result = await verifySignInCode(step.email, code, callbackUrl);
    if (result.kind === "error") return setStatus(afterFailedCode(step, result.code));
    setStatus({ ...step, busy: "signed-in", error: undefined });
    window.location.assign(callbackUrl);
  }

  async function resend() {
    if (status.kind !== "code" || status.busy) return;
    const step = status;
    setStatus({ ...step, busy: "resending", error: undefined });
    const result = await requestSignInCode(step.email, callbackUrl);
    if (result.kind === "error") return setStatus({ ...step, busy: undefined, error: result.code });
    setCode("");
    setStatus({ kind: "code", email: result.email, note: "resent", wrong: 0 });
  }

  return (
    <EmailSignInFormView
      email={email}
      code={code}
      status={status}
      onEmailChange={(value) => {
        setEmail(value);
        if (status.kind === "error") setStatus({ kind: "idle" });
      }}
      onCodeChange={(value) => {
        setCode(value);
        if (status.kind === "code" && status.error && !status.busy) setStatus({ ...status, error: undefined });
      }}
      onSubmit={submit}
      onHaveCode={haveCode}
      onVerify={verify}
      onResend={resend}
      onReset={() => {
        focusEmailNext.current = true;
        setStatus({ kind: "idle" });
      }}
      emailRef={emailRef}
      codeRef={codeRef}
    />
  );
}
