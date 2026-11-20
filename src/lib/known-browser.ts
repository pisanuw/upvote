/**
 * The known-browser cookie: proof that this browser has signed in as an
 * address. A browser that holds a valid one for the address it asks a code
 * for gets its own small allowance (CODE_LIMITS.knownBrowser), which the
 * per-address and per-client limits never refuse. So a stranger who uses up
 * an address's allowance can only stop *new* browsers getting codes for it.
 *
 * The value is "v1.<expiry>.<mac>": the expiry in Unix seconds, and an HMAC
 * (SHA-256, with a key derived from NEXTAUTH_SECRET or AUTH_SECRET, the
 * secret NextAuth itself uses) of the address and the expiry. The address is
 * not in the cookie; the cookie is checked against the address a request
 * names. Nobody without the secret can make one, so a stranger can only get
 * one for an address they really signed in as. It is set when a sign-in
 * (a code, a link sent before codes, or Google) creates a session
 * (src/app/api/auth/[...nextauth]/route.ts).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { KNOWN_BROWSER_DAYS } from "@/lib/sign-in-code";

type Env = Record<string, string | undefined>;

/** The secret NextAuth's route handler uses, or null (then no browser is ever known). */
export function knownBrowserSecret(env: Env = process.env): string | null {
  return env.NEXTAUTH_SECRET || env.AUTH_SECRET || null;
}

const MAX_AGE_SECONDS = KNOWN_BROWSER_DAYS * 24 * 60 * 60;

export function knownBrowserCookie(secure: boolean) {
  const name = secure ? "__Host-upvoteme.known-browser" : "upvoteme.known-browser";
  return {
    name,
    serialize: (value: string) =>
      `${name}=${value}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  };
}

function mac(secret: string, address: string, expiry: number): Buffer {
  const key = createHmac("sha256", secret).update("UpvoteMe known browser").digest();
  return createHmac("sha256", key).update(`v1\n${address}\n${expiry}`).digest();
}

/** A new cookie value saying this browser signed in as `address` (a stored, lower-cased address). */
export function issueKnownBrowser(address: string, secret: string, now: Date): string {
  const expiry = Math.floor(now.getTime() / 1000) + MAX_AGE_SECONDS;
  return `v1.${expiry}.${mac(secret, address, expiry).toString("base64url")}`;
}

const VALUE = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/**
 * The browser's id for its allowance (a hash of the cookie, never the cookie
 * itself), when `value` is a valid, unexpired cookie for `address`; else null.
 */
export function knownBrowserId(
  value: string | null | undefined,
  address: string,
  secret: string | null,
  now: Date,
): string | null {
  if (!value || !secret) return null;
  const parts = VALUE.exec(value);
  if (!parts) return null;
  const expiry = Number(parts[1]);
  if (expiry * 1000 <= now.getTime()) return null;
  const given = Buffer.from(parts[2], "base64url");
  const expected = mac(secret, address, expiry);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  // From the canonical MAC, so other spellings of the same base64 bits are the same browser.
  return createHash("sha256").update(`UpvoteMe known browser id\n${expiry}\n${expected.toString("base64url")}`).digest("hex").slice(0, 32);
}
