import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Adapter } from "next-auth/adapters";
import { memoryTokenStore } from "@/__tests__/memory-token-store";
import {
  bindToAddress,
  claimCodeRequest,
  prismaTokenStore,
  withSignInCodes,
  type VerificationTokenClient,
} from "./sign-in-code-store";

const SECRET = "test-secret";
/** What NextAuth stores and looks up: sha256(code + secret) (next-auth/core/lib/utils.js hashToken). */
const nextAuthHash = (code: string) => createHash("sha256").update(`${code}${SECRET}`).digest("hex");

const T0 = new Date("2026-11-20T10:00:00Z");
const MINUTE = 60_000;

function setup() {
  const memory = memoryTokenStore();
  let now = T0;
  const clock = () => now;
  const base = { createVerificationToken: vi.fn(), useVerificationToken: vi.fn(), getUser: vi.fn() } as unknown as Adapter;
  const adapter = withSignInCodes(base, memory.store, clock);
  const issue = (identifier: string, code: string) =>
    adapter.createVerificationToken!({
      identifier,
      token: nextAuthHash(code),
      expires: new Date(now.getTime() + 10 * MINUTE),
    });
  const use = (identifier: string, code: string) => adapter.useVerificationToken!({ identifier, token: nextAuthHash(code) });
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { ...memory, base, adapter, issue, use, advance };
}

describe("withSignInCodes: storing codes", () => {
  it("keeps the base adapter's other methods and never calls its token methods", async () => {
    const { base, adapter, issue, use } = setup();
    expect(adapter.getUser).toBe(base.getUser);
    await issue("alice@example.com", "123456");
    await use("alice@example.com", "123456");
    expect(base.createVerificationToken).not.toHaveBeenCalled();
    expect(base.useVerificationToken).not.toHaveBeenCalled();
  });

  it("stores the hash bound to the address, not NextAuth's bare hash", async () => {
    const { rows, issue } = setup();
    await issue("alice@example.com", "123456");
    expect(rows).toEqual([
      { identifier: "alice@example.com", token: bindToAddress("alice@example.com", nextAuthHash("123456")), expires: expect.any(Date) },
    ]);
    expect(rows[0].token).not.toBe(nextAuthHash("123456"));
    expect(rows[0].token).not.toContain("123456");
  });

  it("lets two addresses hold the same code (the token column is unique)", async () => {
    const { rows, issue, use } = setup();
    await issue("alice@example.com", "123456");
    await issue("bob@example.com", "123456");
    expect(rows.filter((r) => !r.identifier.startsWith("Sign-in"))).toHaveLength(2);

    expect(await use("bob@example.com", "123456")).toMatchObject({ identifier: "bob@example.com" });
    expect(await use("bob@example.com", "123456")).toBeNull();
    expect(await use("alice@example.com", "123456")).toMatchObject({ identifier: "alice@example.com" });
  });

  it("a code works once, and only for its own address", async () => {
    const { issue, use } = setup();
    await issue("alice@example.com", "123456");
    expect(await use("bob@example.com", "123456")).toBeNull();
    expect(await use("alice@example.com", "123456")).not.toBeNull();
    expect(await use("alice@example.com", "123456")).toBeNull();
  });

  it("a new code voids the address's earlier codes, and only that address's", async () => {
    const { issue, use } = setup();
    await issue("alice@example.com", "111111");
    await issue("bob@example.com", "333333");
    await issue("alice@example.com", "222222");
    expect(await use("alice@example.com", "111111")).toBeNull();
    expect(await use("alice@example.com", "222222")).not.toBeNull();
    expect(await use("bob@example.com", "333333")).not.toBeNull();
  });

  it("the same code issued twice to one address does not collide", async () => {
    const { issue, use } = setup();
    await issue("alice@example.com", "123456");
    await expect(issue("alice@example.com", "123456")).resolves.toBeTruthy();
    expect(await use("alice@example.com", "123456")).not.toBeNull();
  });

  it("a code expires after its time", async () => {
    const { issue, use, advance } = setup();
    await issue("alice@example.com", "123456");
    advance(10 * MINUTE + 1);
    expect(await use("alice@example.com", "123456")).toBeNull();
  });

  it("a code still works just before it expires", async () => {
    const { issue, use, advance } = setup();
    await issue("alice@example.com", "123456");
    advance(10 * MINUTE - 1);
    expect(await use("alice@example.com", "123456")).not.toBeNull();
  });

  it("purges every expired row when a code is issued", async () => {
    const { rows, issue, advance } = setup();
    rows.push({ identifier: "old@example.com", token: "old-link-hash", expires: new Date(T0.getTime() - 1) });
    await issue("carol@example.com", "999999");
    advance(11 * MINUTE);
    await issue("dave@example.com", "888888");
    expect(rows.map((r) => r.identifier)).toEqual(["dave@example.com"]);
  });

  it("still accepts a link sent before codes (its row holds NextAuth's bare hash) until it expires", async () => {
    const { rows, use } = setup();
    const linkToken = "a".repeat(64);
    rows.push({ identifier: "alice@example.com", token: nextAuthHash(linkToken), expires: new Date(T0.getTime() + 60 * MINUTE) });
    expect(await use("alice@example.com", linkToken)).toMatchObject({ identifier: "alice@example.com" });
    expect(await use("alice@example.com", linkToken)).toBeNull();
  });

  it("a new code also voids a link sent before codes", async () => {
    const { rows, issue, use } = setup();
    const linkToken = "b".repeat(64);
    rows.push({ identifier: "alice@example.com", token: nextAuthHash(linkToken), expires: new Date(T0.getTime() + 60 * MINUTE) });
    await issue("alice@example.com", "123456");
    expect(await use("alice@example.com", linkToken)).toBeNull();
  });

  it("refuses a lookup for anything but a stored (lower-case) address, and counts nothing for it", async () => {
    const { rows, adapter, issue } = setup();
    await issue("alice@example.com", "123456");
    for (const identifier of ["Alice@Example.com", " alice@example.com", "Sign-in code attempt: alice@example.com", "", undefined]) {
      expect(await adapter.useVerificationToken!({ identifier: identifier as string, token: nextAuthHash("123456") })).toBeNull();
    }
    expect(rows.filter((r) => r.identifier.startsWith("Sign-in code attempt"))).toHaveLength(0);
  });
});

describe("withSignInCodes: the guessing limit", () => {
  const wrongCodes = ["000001", "000002", "000003", "000004", "000005"];

  it("allows 4 wrong codes, then the right one", async () => {
    const { issue, use } = setup();
    await issue("alice@example.com", "123456");
    for (const code of wrongCodes.slice(0, 4)) expect(await use("alice@example.com", code)).toBeNull();
    expect(await use("alice@example.com", "123456")).not.toBeNull();
  });

  it("voids the code at the 5th wrong code: the right one fails on the 6th try", async () => {
    const { rows, issue, use } = setup();
    await issue("alice@example.com", "123456");
    for (const code of wrongCodes) expect(await use("alice@example.com", code)).toBeNull();
    expect(rows.some((r) => r.identifier === "alice@example.com")).toBe(false);
    expect(await use("alice@example.com", "123456")).toBeNull();
  });

  it("a new code starts a new count", async () => {
    const { issue, use } = setup();
    await issue("alice@example.com", "123456");
    for (const code of wrongCodes) await use("alice@example.com", code);
    await issue("alice@example.com", "654321");
    for (const code of wrongCodes.slice(0, 4)) expect(await use("alice@example.com", code)).toBeNull();
    expect(await use("alice@example.com", "654321")).not.toBeNull();
  });

  it("counts per address: wrong codes for Bob do not void Alice's code", async () => {
    const { issue, use } = setup();
    await issue("alice@example.com", "123456");
    await issue("bob@example.com", "123456");
    for (const code of wrongCodes) await use("bob@example.com", code);
    expect(await use("bob@example.com", "123456")).toBeNull();
    expect(await use("alice@example.com", "123456")).not.toBeNull();
  });

  it("a right code clears the count", async () => {
    const { rows, issue, use } = setup();
    await issue("alice@example.com", "123456");
    await use("alice@example.com", "000001");
    await use("alice@example.com", "123456");
    expect(rows.filter((r) => r.identifier.startsWith("Sign-in code attempt"))).toHaveLength(0);
  });

  it("never checks more than 5 tries at one code, however many arrive at once", async () => {
    const { takes, issue, use } = setup();
    await issue("alice@example.com", "123456");
    const tries = Array.from({ length: 50 }, (_, i) => String(i).padStart(6, "0"));
    const results = await Promise.all([...tries.map((code) => use("alice@example.com", code)), use("alice@example.com", "123456")]);
    const bound = new Set([...tries, "123456"].map((code) => bindToAddress("alice@example.com", nextAuthHash(code))));
    expect(takes.filter((t) => bound.has(t.token)).length).toBeLessThanOrEqual(5);
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it("holds when the database answers in any order (each statement atomic, random delays)", async () => {
    let checkedInAllRounds = 0;
    for (let round = 0; round < 15; round++) {
      const memory = memoryTokenStore();
      const jitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 4));
      const slow = Object.fromEntries(
        Object.entries(memory.store).map(([name, fn]) => [
          name,
          async (...args: unknown[]) => {
            await jitter();
            const result = await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
            await jitter();
            return result;
          },
        ]),
      ) as unknown as typeof memory.store;
      const adapter = withSignInCodes({} as Adapter, slow, () => T0);
      await adapter.createVerificationToken!({
        identifier: "alice@example.com",
        token: nextAuthHash("123456"),
        expires: new Date(T0.getTime() + 10 * MINUTE),
      });
      const guesses = Array.from({ length: 30 }, (_, i) => String(i).padStart(6, "0"));
      // Tries start at random moments over 30 ms, so they overlap in every way.
      await Promise.all(
        guesses.map(async (code) => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
          return adapter.useVerificationToken!({ identifier: "alice@example.com", token: nextAuthHash(code) });
        }),
      );
      const bound = new Set(guesses.map((code) => bindToAddress("alice@example.com", nextAuthHash(code))));
      const checked = memory.takes.filter((t) => bound.has(t.token));
      expect(checked.length).toBeLessThanOrEqual(5);
      checkedInAllRounds += checked.length;
    }
    // The delays let some tries through to the check, up to the limit.
    expect(checkedInAllRounds).toBeGreaterThan(0);
  });
});

describe("claimCodeRequest", () => {
  it("allows one code a minute per address", async () => {
    const { store } = memoryTokenStore();
    expect(await claimCodeRequest(store, "alice@example.com", T0)).toBe("ok");
    expect(await claimCodeRequest(store, "alice@example.com", new Date(T0.getTime() + 59_000))).toBe("wait");
    expect(await claimCodeRequest(store, "bob@example.com", new Date(T0.getTime() + 59_000))).toBe("ok");
    expect(await claimCodeRequest(store, "alice@example.com", new Date(T0.getTime() + 60_001))).toBe("ok");
  });

  it("lets only one of two requests at the same moment through", async () => {
    const { store } = memoryTokenStore();
    const verdicts = await Promise.all([1, 2, 3].map(() => claimCodeRequest(store, "alice@example.com", T0)));
    expect(verdicts.sort()).toEqual(["ok", "wait", "wait"]);
  });

  it("allows at most 5 codes an hour per address", async () => {
    const { store } = memoryTokenStore();
    const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);
    for (const m of [0, 2, 4, 6, 8]) expect(await claimCodeRequest(store, "alice@example.com", at(m))).toBe("ok");
    expect(await claimCodeRequest(store, "alice@example.com", at(10))).toBe("limit");
    expect(await claimCodeRequest(store, "alice@example.com", at(59))).toBe("limit");
    expect(await claimCodeRequest(store, "alice@example.com", at(60.5))).toBe("ok");
  });
});

describe("prismaTokenStore", () => {
  const row = { identifier: "a@b.co", token: "t", expires: T0 };

  function client(over: Partial<VerificationTokenClient["verificationToken"]> = {}) {
    const verificationToken = {
      createMany: vi.fn(async (args: unknown) => ({ count: 1, args })),
      findUnique: vi.fn(async (args: unknown) => ({ ...row, id: "x", args })),
      deleteMany: vi.fn(async (args: unknown) => ({ count: 1, args })),
      count: vi.fn(async (args: unknown) => (args ? 3 : 0)),
    };
    return { verificationToken: { ...verificationToken, ...over }, mocks: verificationToken };
  }

  it("adds with ON CONFLICT DO NOTHING: an existing token is false, not an exception", async () => {
    const c = client({ createMany: vi.fn(async () => ({ count: 0 })) });
    expect(await prismaTokenStore(c).add(row)).toBe(false);
    const ok = client();
    expect(await prismaTokenStore(ok).add(row)).toBe(true);
    expect(ok.mocks.createMany).toHaveBeenCalledWith({ data: [row], skipDuplicates: true });
  });

  it("takes a row only when its own delete removed it", async () => {
    const c = client();
    expect(await prismaTokenStore(c).take("a@b.co", "t")).toEqual(row);
    expect(c.mocks.findUnique).toHaveBeenCalledWith({ where: { identifier_token: { identifier: "a@b.co", token: "t" } } });
    expect(c.mocks.deleteMany).toHaveBeenCalledWith({ where: { identifier: "a@b.co", token: "t" } });

    const missing = client({ findUnique: vi.fn(async () => null) });
    expect(await prismaTokenStore(missing).take("a@b.co", "t")).toBeNull();
    expect(missing.mocks.deleteMany).not.toHaveBeenCalled();

    const lostRace = client({ deleteMany: vi.fn(async () => ({ count: 0 })) });
    expect(await prismaTokenStore(lostRace).take("a@b.co", "t")).toBeNull();
  });

  it("passes a database error on", async () => {
    const down = Object.assign(new Error("Can't reach database server"), { code: "P1001" });
    const fail = vi.fn(async () => {
      throw down;
    });
    const store = prismaTokenStore(client({ createMany: fail, findUnique: fail }));
    await expect(store.add(row)).rejects.toBe(down);
    await expect(store.take("a@b.co", "t")).rejects.toBe(down);
  });

  it("clears, purges and counts the right rows", async () => {
    const c = client();
    const store = prismaTokenStore(c);
    await store.clear("a@b.co");
    await store.purgeExpired(T0);
    await store.purgeExpired(T0, "a@b.co");
    expect(await store.countLive("a@b.co", T0)).toBe(3);
    expect(c.mocks.deleteMany.mock.calls.map(([args]) => args)).toEqual([
      { where: { identifier: "a@b.co" } },
      { where: { expires: { lt: T0 } } },
      { where: { identifier: "a@b.co", expires: { lt: T0 } } },
    ]);
    expect(c.mocks.count).toHaveBeenCalledWith({ where: { identifier: "a@b.co", expires: { gt: T0 } } });
  });
});
