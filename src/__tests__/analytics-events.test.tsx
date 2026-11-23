import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const signIn = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signIn(...args), signOut: vi.fn() }));

import { signInWithGoogle } from "@/components/signin-panel";
import { googleProviderId } from "@/lib/google-sign-in";

const src = resolve(__dirname, "..");
const read = (f: string) => readFileSync(join(src, f), "utf8");

afterEach(() => {
  signIn.mockReset();
  vi.unstubAllGlobals();
});

describe("sign_in_started", () => {
  it("is sent by signInWithGoogle, which then starts Google sign-in", () => {
    const tracked = vi.fn();
    vi.stubGlobal("window", { hintwise: { track: tracked } });
    signInWithGoogle("/t/abc");
    expect(tracked).toHaveBeenCalledWith("sign_in_started", { method: "google" });
    expect(signIn).toHaveBeenCalledWith(googleProviderId(), { callbackUrl: "/t/abc" });
  });

  it("does not stop Google sign-in when the analytics script is missing", () => {
    vi.stubGlobal("window", {});
    signInWithGoogle("/");
    expect(signIn).toHaveBeenCalledWith(googleProviderId(), { callbackUrl: "/" });
  });

  it("every Google button goes through signInWithGoogle", () => {
    for (const [f, buttons] of [
      ["components/signin-panel.tsx", 2],
      ["components/nav-bar-client.tsx", 1],
    ] as const) {
      const text = read(f);
      expect(text.match(/<GoogleSignInButton\b/g)).toHaveLength(buttons);
      expect(text.match(/<GoogleSignInButton\b[^>]*onClick=\{\(\) => signInWithGoogle\(callbackUrl\)\}/g)).toHaveLength(buttons);
      // The one direct call is inside signInWithGoogle itself.
      expect(text.match(/signIn\(googleProviderId\(\)/g) ?? []).toHaveLength(f.endsWith("signin-panel.tsx") ? 1 : 0);
    }
  });

  it("the email form sends it, method email, when it asks for a code", () => {
    const text = read("components/email-sign-in-form.tsx");
    const submit = text.slice(text.indexOf("async function submit("), text.indexOf("function haveCode("));
    expect(submit).toContain('track("sign_in_started", { method: "email" });');
    expect(text.match(/track\(/g)).toHaveLength(1);
  });
});
