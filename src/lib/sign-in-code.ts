/**
 * The emailed sign-in code, the parts both the browser and the server use.
 *
 * Sign-in by email sends a 6-digit code instead of a link: university mail
 * can run link scanners (Proofpoint URL Defense, Safe Links) that open the
 * links in a message before the person does, and NextAuth's email link is
 * used up by the first GET. A scanner cannot use a code.
 * The server side (issuing, storing, the guessing limit) is in
 * src/lib/sign-in-code-store.ts and src/lib/sign-in-code-email.ts.
 */

export const SIGN_IN_CODE_LENGTH = 6;

/** The sign-in page's way back to the code step, named the same in the email. */
export const ENTER_CODE_LABEL = "Type a code I asked for in this browser";

/** How long a code works after it is sent. */
export const SIGN_IN_CODE_MINUTES = 10;

/** Wrong codes allowed per issued code; after that the code is void. */
export const MAX_WRONG_CODES = 5;

/** The shortest time between two codes for one address. */
export const SIGN_IN_CODE_RESEND_SECONDS = 60;

/**
 * How many codes may be sent, per hour and per day. Change them here.
 *
 * - address: to one address, from browsers that have not signed in as it.
 * - clientAndAddress: to one address from one client (IPv4 address, or IPv6
 *   /64, by Netlify's x-nf-client-connection-ip header).
 * - client: from one client to any addresses; sized for a lecture hall
 *   behind one campus address.
 * - knownBrowser: to one address from one browser that has signed in as it
 *   (its known-browser cookie, src/lib/known-browser.ts). This allowance is
 *   separate: the address and client limits above never refuse it, so
 *   strangers cannot stop the owner's own browser getting a code.
 *
 * Every request also needs the address's one-a-minute slot
 * (SIGN_IN_CODE_RESEND_SECONDS), and each code takes MAX_WRONG_CODES tries.
 */
export const CODE_LIMITS = {
  address: { hour: 6, day: 12 },
  clientAndAddress: { hour: 3, day: 4 },
  client: { hour: 300, day: 1000 },
  knownBrowser: { hour: 3, day: 6 },
} as const;

/** How long a browser stays known for an address after signing in as it. */
export const KNOWN_BROWSER_DAYS = 365;

/**
 * The 6 digits in what was typed or pasted, or null. Spaces and hyphens are
 * dropped ("123 456", "123-456"), and full-width digits are read as digits;
 * anything else, or a different number of digits, is not a code.
 */
export function normalizeSignInCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const digits = value.normalize("NFKC").replace(/[\s-]/g, "");
  return new RegExp(`^[0-9]{${SIGN_IN_CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/**
 * NextAuth v4's own address normalizer (its Email provider's default, in
 * next-auth/core/routes/signin.js), as a named function so that the provider
 * and the code form's server side are sure to use the same one: the address
 * typed with the code must find the row that the code request stored.
 *
 * Stricter than NextAuth's in one way: whitespace and < > ( ) , ; : are
 * refused, so a display-name or list form ("A <victim@uw.test>",
 * "a@b.co,c.co") cannot reach a mailbox under a different key and slip past
 * the per-address limits. Throws for an address it refuses.
 */
export function normalizeEmailAddress(identifier: string): string {
  const trimmed = identifier.normalize("NFKC").trim();
  if ((trimmed.match(/@/g) ?? []).length !== 1) throw new Error("Invalid email address format.");
  if (/["\s<>(),;:]/.test(trimmed)) throw new Error("Invalid email address format.");
  const [local, domain] = trimmed.toLowerCase().split("@");
  if (!local || !domain) throw new Error("Invalid email address format.");
  if (!domain.includes(".")) throw new Error("Invalid email address format.");
  return `${local}@${domain}`;
}
