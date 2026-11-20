/**
 * An in-memory VerificationToken table for tests, with the database's rules:
 * `token` is unique across the table (prisma/schema.prisma), so adding a row
 * whose token exists fails, as Prisma's create does with P2002.
 */
import type { VerificationToken } from "next-auth/adapters";
import { OLD_LINK_DAY_MS, OLD_LINK_TOKEN, type TokenStore } from "@/lib/sign-in-code-store";

export function memoryTokenStore(rows: VerificationToken[] = []) {
  const takes: { identifier: string; token: string }[] = [];
  const store: TokenStore = {
    async add(row) {
      if (rows.some((r) => r.token === row.token)) return false;
      rows.push({ ...row });
      return true;
    },
    async take(identifier, token) {
      takes.push({ identifier, token });
      const i = rows.findIndex((r) => r.identifier === identifier && r.token === token);
      return i < 0 ? null : rows.splice(i, 1)[0];
    },
    async clear(identifier) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].identifier === identifier) rows.splice(i, 1);
    },
    async purgeExpired(now, prefix) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].expires < now && rows[i].identifier.startsWith(prefix)) rows.splice(i, 1);
      }
    },
    async voidOldLinks(identifier, now) {
      const limit = now.getTime() + OLD_LINK_DAY_MS;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.identifier === identifier && r.expires.getTime() <= limit && OLD_LINK_TOKEN.test(r.token)) rows.splice(i, 1);
      }
    },
    async countLive(identifier, at) {
      return rows.filter((r) => r.identifier === identifier && r.expires > at).length;
    },
  };
  return { store, rows, takes };
}
