/**
 * Server side of the emailed sign-in code: where codes are kept, the guessing
 * limit, and how often a code can be asked for. Everything lives in the
 * existing VerificationToken table (no migration), and every count is a row,
 * so the limits hold across Netlify's function instances and cold starts
 * (unlike src/lib/rate-limit.ts).
 *
 * NextAuth's Email provider stays in charge of the flow: it makes the code
 * (provider.generateVerificationToken), mails it, stores
 * sha256(code + secret) with createVerificationToken, and on sign-in looks it
 * up with useVerificationToken. withSignInCodes wraps those two adapter
 * methods, with what the route knows about the request (CodeContext):
 *
 * - A code belongs to the browser that asked for it. The request sets a
 *   random httpOnly cookie (src/lib/sign-in-code-route.ts), and the code's row
 *   is filed under the address and a hash of that cookie, with a token that
 *   binds the address, the cookie and NextAuth's hash. NextAuth's hash alone
 *   has no address in it and the column is @unique, so with 6-digit codes two
 *   addresses (or two browsers) given the same code would otherwise collide.
 * - A try without that browser's cookie finds no code and is refused before
 *   anything is counted or written, so nobody else can use up, or void, the
 *   code (no lockout by outsiders). A GET with a link sent before codes only
 *   ever reaches those old rows.
 * - Issuing a code deletes this browser's earlier code for the address, its
 *   wrong-try count, and the address's links sent before codes; and purges
 *   expired rows in this module's own namespace. It never touches other
 *   rows: the database is shared with another app.
 * - Each try is counted as a row added before it is checked (after a count
 *   that skips the write once the limit is reached). Adding before the final
 *   count means concurrent tries see each other, so no more than
 *   MAX_WRONG_CODES tries ever reach a code. The last allowed wrong code
 *   deletes it.
 *
 * Rows other than links sent before codes use identifiers starting with
 * "Sign-in code" (NAMESPACE). NextAuth lower-cases every address
 * (normalizeEmailAddress), so they can never be an address, and a lookup for
 * anything that is not a lower-cased address is refused.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Adapter, VerificationToken } from "next-auth/adapters";
import {
  CODE_LIMITS,
  MAX_WRONG_CODES,
  SIGN_IN_CODE_MINUTES,
  SIGN_IN_CODE_RESEND_SECONDS,
  normalizeEmailAddress,
} from "@/lib/sign-in-code";

/** The VerificationToken rows this module reads and writes. */
export interface TokenStore {
  /** Adds a row. False, and nothing added, when a row with this token exists. */
  add(row: VerificationToken): Promise<boolean>;
  /** Deletes the row with this identifier and token and returns it, or null. */
  take(identifier: string, token: string): Promise<VerificationToken | null>;
  /** Deletes every row with this identifier. */
  clear(identifier: string): Promise<void>;
  /** Deletes the expired rows whose identifier starts with `prefix`. */
  purgeExpired(now: Date, prefix: string): Promise<void>;
  /** Counts this identifier's rows that are still live at `at` (expires > at). */
  countLive(identifier: string, at: Date): Promise<number>;
}

/**
 * What the route knows about the request NextAuth is handling:
 * - "request": a code request; the browser's key (its cookie, new or kept),
 *   the client (IP address or IPv6 /64, "unknown" without one), and a
 *   callback for when a code bound to that key was stored (then the route
 *   sets the cookie).
 * - "code": a typed code; the browser's key from its cookie, or null.
 * - "link": a GET with a link sent before codes.
 */
export type CodeContext =
  | { kind: "request"; browserKey: string; client: string; onStored: () => void }
  | { kind: "code"; browserKey: string | null }
  | { kind: "link" };

export const NAMESPACE = "Sign-in code";
const CODE = `${NAMESPACE}: `;
const ATTEMPT = `${NAMESPACE} attempt: `;
const WAIT = `${NAMESPACE} wait: `;
const SENT = `${NAMESPACE} sent: `;
const CLIENT = `${NAMESPACE} client: `;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const later = (now: Date, ms: number) => new Date(now.getTime() + ms);

/** True for an address exactly as NextAuth stores it. */
function isStoredAddress(identifier: unknown): identifier is string {
  if (typeof identifier !== "string" || identifier.length === 0) return false;
  try {
    return normalizeEmailAddress(identifier) === identifier;
  } catch {
    return false;
  }
}

/** A browser's key as it is filed: a hash, so the cookie itself is never stored. */
function browserId(browserKey: string): string {
  return createHash("sha256").update(`UpvoteMe sign-in browser\n${browserKey}`).digest("hex").slice(0, 32);
}

/** Where a browser's code for an address, and its wrong tries, are filed. */
export const codeIdentifier = (identifier: string, browserKey: string) => `${CODE}${identifier} ${browserId(browserKey)}`;
const attemptIdentifier = (identifier: string, browserKey: string) => `${ATTEMPT}${identifier} ${browserId(browserKey)}`;

/**
 * The token column for a code: NextAuth's hash (sha256(code + secret)) bound
 * to the address and the browser's key, so equal codes for two addresses or
 * two browsers are two different rows. The hash is always 64 hex characters
 * at the end, and neither an address nor a key contains a newline, so no two
 * inputs give the same text.
 */
export function bindCode(identifier: string, browserKey: string, hashedCode: string): string {
  return createHash("sha256")
    .update(`UpvoteMe sign-in code\n${identifier}\n${browserKey}\n${hashedCode}`)
    .digest("hex");
}

/**
 * NextAuth's adapter with sign-in codes kept the way the header describes,
 * for one request. The base adapter's own verification-token methods are no
 * longer used.
 */
export function withSignInCodes(
  adapter: Adapter,
  store: TokenStore,
  context: CodeContext | undefined,
  clock: () => Date = () => new Date(),
): Adapter {
  return {
    ...adapter,

    async createVerificationToken({ identifier, token, expires }) {
      if (context?.kind !== "request") throw new Error("A sign-in code needs the browser that asked for it.");
      const now = clock();
      await store.purgeExpired(now, NAMESPACE);
      await store.clear(identifier);
      await store.clear(codeIdentifier(identifier, context.browserKey));
      await store.clear(attemptIdentifier(identifier, context.browserKey));
      await store.add({
        identifier: codeIdentifier(identifier, context.browserKey),
        token: bindCode(identifier, context.browserKey, token),
        expires,
      });
      context.onStored();
      return { identifier, token, expires };
    },

    async useVerificationToken({ identifier, token }) {
      if (!isStoredAddress(identifier) || typeof token !== "string") return null;
      const now = clock();

      // A link sent before codes: its row holds NextAuth's hash as is, under
      // the bare address. Nothing is counted; no code can be reached.
      if (context?.kind === "link") {
        const row = await store.take(identifier, token);
        return row && row.expires > now ? row : null;
      }

      // A code: only from the browser that asked for it, and only while it has one.
      if (context?.kind !== "code" || !context.browserKey) return null;
      const codes = codeIdentifier(identifier, context.browserKey);
      if ((await store.countLive(codes, now)) === 0) return null;

      const attempts = attemptIdentifier(identifier, context.browserKey);
      if ((await store.countLive(attempts, now)) >= MAX_WRONG_CODES) {
        await store.clear(codes);
        return null;
      }
      // Count this try before checking it (see the header).
      await store.add({
        identifier: attempts,
        token: `${attempts} ${randomUUID()}`,
        expires: later(now, SIGN_IN_CODE_MINUTES * MINUTE),
      });
      const tries = await store.countLive(attempts, now);
      if (tries > MAX_WRONG_CODES) {
        await store.clear(codes);
        return null;
      }

      const row = await store.take(codes, bindCode(identifier, context.browserKey, token));
      if (row && row.expires > now) {
        await store.clear(attempts);
        return { identifier, token, expires: row.expires };
      }
      if (tries >= MAX_WRONG_CODES) await store.clear(codes);
      return null;
    },
  };
}

export type CodeRequestVerdict = "ok" | "wait" | "limit" | "client-limit";

type Limit = { hour: number; day: number };

/** Rows live for a day; those still live an hour before they expire were added in the last hour. */
async function sentCounts(store: TokenStore, identifier: string, now: Date) {
  const [hour, day] = await Promise.all([
    store.countLive(identifier, later(now, DAY - HOUR)),
    store.countLive(identifier, now),
  ]);
  return { hour, day };
}

const reached = (n: { hour: number; day: number }, limit: Limit) => n.hour >= limit.hour || n.day >= limit.day;
const exceeded = (n: { hour: number; day: number }, limit: Limit) => n.hour > limit.hour || n.day > limit.day;

/**
 * May a code be sent to this address, for this client, now?
 * - At most one per SIGN_IN_CODE_RESEND_SECONDS per address: a row with a
 *   fixed token, so of two requests at the same moment the second finds it
 *   taken.
 * - CODE_LIMITS per hour and per day: per address, per client and address,
 *   and per client. Counts are read first and nothing is written once a
 *   limit is reached. The per-address counts are then exact (one request a
 *   minute gets past the fixed-token row); the client's count is added
 *   before it is read again, so a burst of requests from one client sees
 *   itself.
 * A refused request leaves the address's codes working.
 */
export async function claimCodeRequest(
  store: TokenStore,
  identifier: string,
  client: string,
  now: Date,
): Promise<CodeRequestVerdict> {
  const fromClient = CLIENT + client;
  const toAddress = SENT + identifier;
  const toAddressFromClient = `${SENT}${identifier} from ${client}`;

  if (reached(await sentCounts(store, fromClient, now), CODE_LIMITS.client)) return "client-limit";
  if (reached(await sentCounts(store, toAddressFromClient, now), CODE_LIMITS.clientAndAddress)) return "limit";
  if (reached(await sentCounts(store, toAddress, now), CODE_LIMITS.address)) return "limit";

  const wait = WAIT + identifier;
  await store.purgeExpired(now, wait);
  if (!(await store.add({ identifier: wait, token: wait, expires: later(now, SIGN_IN_CODE_RESEND_SECONDS * 1000) }))) {
    return "wait";
  }

  await store.add({ identifier: fromClient, token: `${fromClient} ${randomUUID()}`, expires: later(now, DAY) });
  if (exceeded(await sentCounts(store, fromClient, now), CODE_LIMITS.client)) {
    await store.clear(wait);
    return "client-limit";
  }
  await store.add({ identifier: toAddress, token: `${toAddress} ${randomUUID()}`, expires: later(now, DAY) });
  await store.add({ identifier: toAddressFromClient, token: `${toAddressFromClient} ${randomUUID()}`, expires: later(now, DAY) });
  return "ok";
}

/** The subset of PrismaClient this store uses. */
export interface VerificationTokenClient {
  verificationToken: {
    createMany(args: { data: VerificationToken[]; skipDuplicates: true }): Promise<{ count: number }>;
    findUnique(args: {
      where: { identifier_token: { identifier: string; token: string } };
    }): Promise<VerificationToken | null>;
    deleteMany(args: {
      where: { identifier?: string | { startsWith: string }; token?: string; expires?: { lt: Date } };
    }): Promise<{ count: number }>;
    count(args: { where: { identifier: string; expires: { gt: Date } } }): Promise<number>;
  };
}

/**
 * The store on Prisma. An expected miss (a token already taken, a wrong
 * code) is a count of 0, not an exception, so Prisma's error log stays for
 * real errors: ON CONFLICT DO NOTHING (createMany with skipDuplicates) for
 * add, and a delete whose count says which of two concurrent takes won.
 */
export function prismaTokenStore(prisma: VerificationTokenClient): TokenStore {
  const rows = prisma.verificationToken;
  return {
    async add(row) {
      const { count } = await rows.createMany({ data: [row], skipDuplicates: true });
      return count === 1;
    },
    async take(identifier, token) {
      const row = await rows.findUnique({ where: { identifier_token: { identifier, token } } });
      if (!row) return null;
      const { count } = await rows.deleteMany({ where: { identifier, token } });
      return count === 1 ? { identifier: row.identifier, token: row.token, expires: row.expires } : null;
    },
    async clear(identifier) {
      await rows.deleteMany({ where: { identifier } });
    },
    async purgeExpired(now, prefix) {
      await rows.deleteMany({ where: { identifier: { startsWith: prefix }, expires: { lt: now } } });
    },
    async countLive(identifier, at) {
      return rows.count({ where: { identifier, expires: { gt: at } } });
    },
  };
}
