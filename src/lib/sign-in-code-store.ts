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
 * methods:
 *
 * - The stored token is bound to the address: sha256 of the address and
 *   NextAuth's hash. NextAuth's hash has no address in it and the column is
 *   @unique, so with 6-digit codes two addresses given the same code would
 *   collide and the second request would fail.
 * - Issuing a code deletes the address's earlier rows (old codes, old links,
 *   the wrong-code count) and purges every expired row; NextAuth never does.
 * - Each try at a code first adds a row, then counts the address's rows.
 *   Adding before counting means concurrent tries see each other, so no more
 *   than MAX_WRONG_CODES tries are ever checked against one code. After the
 *   last allowed wrong code, the address's codes are deleted.
 *
 * Rows other than codes use identifiers that start with a capital letter.
 * NextAuth lower-cases every address (normalizeEmailAddress), so they can
 * never be an address, and a lookup for anything that is not a lower-cased
 * address is refused.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Adapter, VerificationToken } from "next-auth/adapters";
import {
  MAX_CODES_PER_HOUR,
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
  /** Deletes expired rows: all of them, or only this identifier's. */
  purgeExpired(now: Date, identifier?: string): Promise<void>;
  /** Counts this identifier's rows that have not expired. */
  countLive(identifier: string, now: Date): Promise<number>;
}

const ATTEMPT = "Sign-in code attempt: ";
const WAIT = "Sign-in code wait: ";
const SENT = "Sign-in code sent: ";

const MINUTE = 60_000;

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

/**
 * The token column for a code: NextAuth's hash (sha256(code + secret)) bound
 * to the address, so equal codes for two addresses are two different rows.
 * The hash is always 64 hex characters at the end, so no two (address, hash)
 * pairs give the same input.
 */
export function bindToAddress(identifier: string, hashedCode: string): string {
  return createHash("sha256").update(`UpvoteMe sign-in code\n${identifier}\n${hashedCode}`).digest("hex");
}

/**
 * NextAuth's adapter with sign-in codes kept the way the header describes.
 * The base adapter's own verification-token methods are no longer used.
 */
export function withSignInCodes(adapter: Adapter, store: TokenStore, clock: () => Date = () => new Date()): Adapter {
  return {
    ...adapter,

    async createVerificationToken({ identifier, token, expires }) {
      const now = clock();
      await store.purgeExpired(now);
      await store.clear(identifier);
      await store.clear(ATTEMPT + identifier);
      await store.add({ identifier, token: bindToAddress(identifier, token), expires });
      return { identifier, token, expires };
    },

    async useVerificationToken({ identifier, token }) {
      if (!isStoredAddress(identifier) || typeof token !== "string") return null;
      const now = clock();
      const attempts = ATTEMPT + identifier;

      // Count this try before checking it (see the header).
      await store.add({
        identifier: attempts,
        token: `${attempts} ${randomUUID()}`,
        expires: later(now, SIGN_IN_CODE_MINUTES * MINUTE),
      });
      const tries = await store.countLive(attempts, now);
      if (tries > MAX_WRONG_CODES) {
        await store.clear(identifier);
        return null;
      }

      // A code, or a link sent before codes (its row holds NextAuth's hash as is).
      const row = (await store.take(identifier, bindToAddress(identifier, token))) ?? (await store.take(identifier, token));
      if (row && row.expires > now) {
        await store.clear(attempts);
        return row;
      }
      if (tries >= MAX_WRONG_CODES) await store.clear(identifier);
      return null;
    },
  };
}

export type CodeRequestVerdict = "ok" | "wait" | "limit";

/**
 * May a code be sent to this address now? At most one per
 * SIGN_IN_CODE_RESEND_SECONDS (a row with a fixed token: of two requests at
 * the same moment, the second finds it taken) and MAX_CODES_PER_HOUR an
 * hour. A refused request leaves the address's current code working.
 */
export async function claimCodeRequest(store: TokenStore, identifier: string, now: Date): Promise<CodeRequestVerdict> {
  const wait = WAIT + identifier;
  await store.purgeExpired(now, wait);
  if (!(await store.add({ identifier: wait, token: wait, expires: later(now, SIGN_IN_CODE_RESEND_SECONDS * 1000) }))) {
    return "wait";
  }
  const sent = SENT + identifier;
  if ((await store.countLive(sent, now)) >= MAX_CODES_PER_HOUR) return "limit";
  await store.add({ identifier: sent, token: `${sent} ${randomUUID()}`, expires: later(now, 60 * MINUTE) });
  return "ok";
}

/** The subset of PrismaClient this store uses. */
export interface VerificationTokenClient {
  verificationToken: {
    createMany(args: { data: VerificationToken[]; skipDuplicates: true }): Promise<{ count: number }>;
    findUnique(args: {
      where: { identifier_token: { identifier: string; token: string } };
    }): Promise<VerificationToken | null>;
    deleteMany(args: { where: { identifier?: string; token?: string; expires?: { lt: Date } } }): Promise<{ count: number }>;
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
    async purgeExpired(now, identifier) {
      await rows.deleteMany({ where: { ...(identifier === undefined ? {} : { identifier }), expires: { lt: now } } });
    },
    async countLive(identifier, now) {
      return rows.count({ where: { identifier, expires: { gt: now } } });
    },
  };
}
