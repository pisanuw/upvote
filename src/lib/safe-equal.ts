import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets (tokens, API keys, shared
 * secrets). Using `===`/`!==` on a secret leaks its length and content
 * through timing; this compares in time independent of where the first
 * mismatch occurs.
 *
 * Returns false (never throws) for nullish input or length mismatch.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Length is compared up front: timingSafeEqual requires equal-length buffers.
  // The secret's length is not itself sensitive here (it is fixed by config).
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
