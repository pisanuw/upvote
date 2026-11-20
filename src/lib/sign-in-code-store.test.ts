import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Adapter } from "next-auth/adapters";
import { memoryTokenStore } from "@/__tests__/memory-token-store";
import {
  NAMESPACE,
  bindCode,
  claimCodeRequest,
  codeIdentifier,
  prismaTokenStore,
  withSignInCodes,
  type CodeContext,
  type TokenStore,
  type VerificationTokenClient,
} from "./sign-in-code-store";

const SECRET = "test-secret";
/** What NextAuth stores and looks up: sha256(code + secret) (next-auth/core/lib/utils.js hashToken). */
const nextAuthHash = (code: string) => createHash("sha256").update(`${code}${SECRET}`).digest("hex");

const T0 = new Date("2026-11-20T10:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Browser keys, as the route's cookie holds them.
const VICTIM = "victimBrowserKey_aaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "otherBrowserKey_bbbbbbbbbbbbbbbbbbbbbbbbbbb";

const ALICE = "alice@example.com";

function setup(memory = memoryTokenStore()) {
  let now = T0;
  const clock = () => now;
  const base = { createVerificationToken: vi.fn(), useVerificationToken: vi.fn(), getUser: vi.fn() } as unknown as Adapter;
  const adapter = (context?: CodeContext) => withSignInCodes(base, memory.store, context, clock);

  /** Issues `code` to `identifier`, asked for from the browser holding `browserKey`; true when stored. */
  async function issue(identifier: string, code: string, browserKey = VICTIM) {
    let stored = false;
    await adapter({ kind: "request", browserKey, client: "192.0.2.1", onStored: () => (stored = true) }).createVerificationToken!({
      identifier,
      token: nextAuthHash(code),
      expires: new Date(now.getTime() + 10 * MINUTE),
    });
    return stored;
  }
  /** Types `code` for `identifier` in the browser holding `browserKey` (null: no cookie). */
  const tryCode = (identifier: string, code: string, browserKey: string | null = VICTIM) =>
    adapter({ kind: "code", browserKey }).useVerificationToken!({ identifier, token: nextAuthHash(code) });
  /** A GET with a link sent before codes. */
  const openLink = (identifier: string, linkToken: string) =>
    adapter({ kind: "link" }).useVerificationToken!({ identifier, token: nextAuthHash(linkToken) });
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  const attemptRows = () => memory.rows.filter((r) => r.identifier.startsWith(`${NAMESPACE} attempt`));
  return { ...memory, base, adapter, issue, tryCode, openLink, advance, attemptRows };
}

describe("withSignInCodes: storing codes", () => {
  it("keeps the base adapter's other methods and never calls its token methods", async () => {
    const { base, adapter, issue, tryCode } = setup();
    expect(adapter().getUser).toBe(base.getUser);
    await issue(ALICE, "123456");
    await tryCode(ALICE, "123456");
    expect(base.createVerificationToken).not.toHaveBeenCalled();
    expect(base.useVerificationToken).not.toHaveBeenCalled();
  });

  it("files the code under the address and a hash of the browser's key, bound to both", async () => {
    const { rows, issue } = setup();
    expect(await issue(ALICE, "123456")).toBe(true);
    expect(rows).toEqual([
      { identifier: codeIdentifier(ALICE, VICTIM), token: bindCode(ALICE, VICTIM, nextAuthHash("123456")), expires: expect.any(Date) },
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(VICTIM);
    expect(text).not.toContain("123456");
    expect(text).not.toContain(nextAuthHash("123456"));
  });

  it("refuses to store a code without the asking browser, and says nothing was stored", async () => {
    const { rows, adapter } = setup();
    for (const context of [undefined, { kind: "code", browserKey: VICTIM } as const, { kind: "link" } as const]) {
      await expect(
        adapter(context).createVerificationToken!({ identifier: ALICE, token: nextAuthHash("123456"), expires: T0 }),
      ).rejects.toThrow("A sign-in code needs the browser that asked for it.");
    }
    expect(rows).toEqual([]);
  });

  it("lets two addresses hold the same code (the token column is unique)", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "123456");
    await issue("bob@example.com", "123456");
    expect(await tryCode("bob@example.com", "123456")).toMatchObject({ identifier: "bob@example.com" });
    expect(await tryCode("bob@example.com", "123456")).toBeNull();
    expect(await tryCode(ALICE, "123456")).toMatchObject({ identifier: ALICE });
  });

  it("lets two browsers hold the same code for one address, each working only in its own browser", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "123456", VICTIM);
    await issue(ALICE, "123456", OTHER);
    expect(await tryCode(ALICE, "123456", OTHER)).toMatchObject({ identifier: ALICE });
    expect(await tryCode(ALICE, "123456", VICTIM)).toMatchObject({ identifier: ALICE });
  });

  it("a code works once, only for its address and only in the browser that asked for it", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "123456");
    expect(await tryCode("bob@example.com", "123456")).toBeNull();
    expect(await tryCode(ALICE, "123456", OTHER)).toBeNull();
    expect(await tryCode(ALICE, "123456", null)).toBeNull();
    expect(await tryCode(ALICE, "123456")).not.toBeNull();
    expect(await tryCode(ALICE, "123456")).toBeNull();
  });

  it("a new code from the same browser voids that browser's earlier code", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "111111");
    await issue(ALICE, "222222");
    expect(await tryCode(ALICE, "111111")).toBeNull();
    expect(await tryCode(ALICE, "222222")).not.toBeNull();
  });

  it("a code asked for in another browser (an outsider) leaves the victim's code working", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "111111", VICTIM);
    await issue(ALICE, "222222", OTHER);
    expect(await tryCode(ALICE, "111111", VICTIM)).not.toBeNull();
  });

  it("the same code issued twice to one browser does not collide", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "123456");
    expect(await issue(ALICE, "123456")).toBe(true);
    expect(await tryCode(ALICE, "123456")).not.toBeNull();
  });

  it("a code expires after its time, and works just before", async () => {
    const early = setup();
    await early.issue(ALICE, "123456");
    early.advance(10 * MINUTE - 1);
    expect(await early.tryCode(ALICE, "123456")).not.toBeNull();

    const late = setup();
    await late.issue(ALICE, "123456");
    late.advance(10 * MINUTE + 1);
    expect(await late.tryCode(ALICE, "123456")).toBeNull();
  });

  it("purges only expired rows of its own namespace, and the address's own old rows", async () => {
    const { rows, issue, advance } = setup();
    const past = new Date(T0.getTime() - 1);
    rows.push(
      { identifier: "someone@other-app.test", token: "other-app-expired", expires: past },
      { identifier: "other-app-identifier", token: "other-app-live", expires: new Date(T0.getTime() + HOUR) },
      { identifier: `${NAMESPACE} attempt: x@y.co abc`, token: "ours-expired", expires: past },
      { identifier: ALICE, token: "alice-old-link", expires: new Date(T0.getTime() + HOUR) },
    );
    await issue(ALICE, "999999");
    expect(rows.map((r) => r.token)).toEqual([
      "other-app-expired",
      "other-app-live",
      bindCode(ALICE, VICTIM, nextAuthHash("999999")),
    ]);
    advance(11 * MINUTE);
    await issue("dave@example.com", "888888");
    expect(rows.map((r) => r.identifier)).toEqual(["someone@other-app.test", "other-app-identifier", codeIdentifier("dave@example.com", VICTIM)]);
  });

  it("still accepts a link sent before codes (NextAuth's bare hash under the address) until it expires", async () => {
    const { rows, openLink, advance } = setup();
    const link = "a".repeat(64);
    rows.push({ identifier: ALICE, token: nextAuthHash(link), expires: new Date(T0.getTime() + HOUR) });
    expect(await openLink(ALICE, link)).toMatchObject({ identifier: ALICE });
    expect(await openLink(ALICE, link)).toBeNull();

    rows.push({ identifier: ALICE, token: nextAuthHash("b".repeat(64)), expires: new Date(T0.getTime() + HOUR) });
    advance(HOUR + 1);
    expect(await openLink(ALICE, "b".repeat(64))).toBeNull();
  });

  it("a new code also voids the address's links sent before codes", async () => {
    const { rows, issue, openLink } = setup();
    const link = "b".repeat(64);
    rows.push({ identifier: ALICE, token: nextAuthHash(link), expires: new Date(T0.getTime() + HOUR) });
    await issue(ALICE, "123456");
    expect(await openLink(ALICE, link)).toBeNull();
  });

  it("refuses a lookup for anything but a stored (lower-case) address, and writes nothing", async () => {
    const { rows, adapter, issue } = setup();
    await issue(ALICE, "123456");
    const before = rows.length;
    for (const identifier of ["Alice@Example.com", " alice@example.com", codeIdentifier(ALICE, VICTIM), "", undefined]) {
      for (const context of [{ kind: "code", browserKey: VICTIM } as const, { kind: "link" } as const]) {
        const lookup = { identifier: identifier as string, token: nextAuthHash("123456") };
        expect(await adapter(context).useVerificationToken!(lookup)).toBeNull();
      }
    }
    expect(rows).toHaveLength(before);
  });

  it("checks no code without a code context", async () => {
    const { rows, adapter, issue, tryCode } = setup();
    await issue(ALICE, "123456");
    expect(await adapter().useVerificationToken!({ identifier: ALICE, token: nextAuthHash("123456") })).toBeNull();
    expect(rows).toHaveLength(1);
    expect(await tryCode(ALICE, "123456")).not.toBeNull();
  });
});

describe("withSignInCodes: no lockout by outsiders", () => {
  const guesses = Array.from({ length: 200 }, (_, i) => String(i).padStart(6, "0"));

  it("a script posting wrong codes without the cookie neither counts nor voids the victim's code", async () => {
    const { rows, issue, tryCode, attemptRows } = setup();
    await issue(ALICE, "987654");
    for (const code of guesses) expect(await tryCode(ALICE, code, null)).toBeNull();
    expect(attemptRows()).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(await tryCode(ALICE, "987654")).not.toBeNull();
  });

  it("an outsider with a cookie of its own (from asking for any code) cannot count against the victim's code", async () => {
    const { issue, tryCode, attemptRows } = setup();
    await issue(ALICE, "987654", VICTIM);
    await issue("mallory@example.com", "111111", OTHER);
    for (const code of guesses) expect(await tryCode(ALICE, code, OTHER)).toBeNull();
    expect(attemptRows()).toEqual([]);
    expect(await tryCode(ALICE, "987654", VICTIM)).not.toBeNull();
  });

  it("an outsider who asked for a code for the victim's address only spends that code's own tries", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "987654", VICTIM);
    await issue(ALICE, "555555", OTHER); // mailed to Alice, tied to the outsider's browser
    for (const code of guesses.slice(0, 20)) await tryCode(ALICE, code, OTHER);
    expect(await tryCode(ALICE, "555555", OTHER)).toBeNull(); // the outsider's code is void
    expect(await tryCode(ALICE, "987654", VICTIM)).not.toBeNull(); // Alice's still works
  });

  it("GETs with old-style link tokens never reach, count against, or void a code", async () => {
    const { rows, issue, tryCode, openLink, attemptRows } = setup();
    await issue(ALICE, "987654");
    for (let i = 0; i < 100; i++) expect(await openLink(ALICE, i.toString(16).padStart(64, "0"))).toBeNull();
    // A GET that somehow carried the code's own hash still finds nothing.
    expect(await openLink(ALICE, "987654")).toBeNull();
    expect(attemptRows()).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(await tryCode(ALICE, "987654")).not.toBeNull();
  });
});

describe("withSignInCodes: the guessing limit", () => {
  const wrongCodes = ["000001", "000002", "000003", "000004", "000005"];

  it("allows 4 wrong codes, then the right one", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "123456");
    for (const code of wrongCodes.slice(0, 4)) expect(await tryCode(ALICE, code)).toBeNull();
    expect(await tryCode(ALICE, "123456")).not.toBeNull();
  });

  it("voids the code at the 5th wrong code: the right one fails on the 6th try", async () => {
    const { rows, issue, tryCode } = setup();
    await issue(ALICE, "123456");
    for (const code of wrongCodes) expect(await tryCode(ALICE, code)).toBeNull();
    expect(rows.some((r) => r.identifier === codeIdentifier(ALICE, VICTIM))).toBe(false);
    expect(await tryCode(ALICE, "123456")).toBeNull();
  });

  it("writes nothing for a try once the code is void", async () => {
    const { rows, issue, tryCode } = setup();
    await issue(ALICE, "123456");
    for (const code of wrongCodes) await tryCode(ALICE, code);
    const after = rows.length;
    for (let i = 0; i < 50; i++) await tryCode(ALICE, "123456");
    expect(rows).toHaveLength(after);
  });

  it("a new code starts a new count", async () => {
    const { issue, tryCode } = setup();
    await issue(ALICE, "123456");
    for (const code of wrongCodes) await tryCode(ALICE, code);
    await issue(ALICE, "654321");
    for (const code of wrongCodes.slice(0, 4)) expect(await tryCode(ALICE, code)).toBeNull();
    expect(await tryCode(ALICE, "654321")).not.toBeNull();
  });

  it("a right code clears the count", async () => {
    const { issue, tryCode, attemptRows } = setup();
    await issue(ALICE, "123456");
    await tryCode(ALICE, "000001");
    await tryCode(ALICE, "123456");
    expect(attemptRows()).toEqual([]);
  });

  it("never checks more than 5 tries at one code, however many arrive at once", async () => {
    const { takes, issue, tryCode } = setup();
    await issue(ALICE, "123456");
    const tries = Array.from({ length: 50 }, (_, i) => String(i).padStart(6, "0"));
    const results = await Promise.all([...tries.map((code) => tryCode(ALICE, code)), tryCode(ALICE, "123456")]);
    const bound = new Set([...tries, "123456"].map((code) => bindCode(ALICE, VICTIM, nextAuthHash(code))));
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
      ) as unknown as TokenStore;
      const { issue, tryCode } = setup({ ...memory, store: slow });
      await issue(ALICE, "123456");
      const guesses = Array.from({ length: 30 }, (_, i) => String(i).padStart(6, "0"));
      // Tries start at random moments over 30 ms, so they overlap in every way.
      await Promise.all(
        guesses.map(async (code) => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
          return tryCode(ALICE, code);
        }),
      );
      const bound = new Set(guesses.map((code) => bindCode(ALICE, VICTIM, nextAuthHash(code))));
      const checked = memory.takes.filter((t) => bound.has(t.token));
      expect(checked.length).toBeLessThanOrEqual(5);
      checkedInAllRounds += checked.length;
    }
    // The delays let some tries through to the check, up to the limit.
    expect(checkedInAllRounds).toBeGreaterThan(0);
  });
});

describe("claimCodeRequest", () => {
  const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

  it("allows one code a minute per address", async () => {
    const { store } = memoryTokenStore();
    expect(await claimCodeRequest(store, ALICE, "192.0.2.1", T0)).toBe("ok");
    expect(await claimCodeRequest(store, ALICE, "192.0.2.2", new Date(T0.getTime() + 59_000))).toBe("wait");
    expect(await claimCodeRequest(store, "bob@example.com", "192.0.2.1", new Date(T0.getTime() + 59_000))).toBe("ok");
    expect(await claimCodeRequest(store, ALICE, "192.0.2.1", new Date(T0.getTime() + 60_001))).toBe("ok");
  });

  it("lets only one of several requests at the same moment through", async () => {
    const { store } = memoryTokenStore();
    const verdicts = await Promise.all([1, 2, 3].map((i) => claimCodeRequest(store, ALICE, `192.0.2.${i}`, T0)));
    expect(verdicts.sort()).toEqual(["ok", "wait", "wait"]);
  });

  it("allows one client at most 3 codes an hour and 4 a day for one address, so it cannot use up the address's allowance", async () => {
    const { store } = memoryTokenStore();
    for (const m of [0, 2, 4]) expect(await claimCodeRequest(store, ALICE, "198.51.100.7", at(m))).toBe("ok");
    expect(await claimCodeRequest(store, ALICE, "198.51.100.7", at(6))).toBe("limit");
    // Another client still gets a code for the same address.
    expect(await claimCodeRequest(store, ALICE, "203.0.113.9", at(8))).toBe("ok");
    // The 4th from the first client an hour later, then its day is used up.
    expect(await claimCodeRequest(store, ALICE, "198.51.100.7", at(61))).toBe("ok");
    expect(await claimCodeRequest(store, ALICE, "198.51.100.7", at(150))).toBe("limit");
    expect(await claimCodeRequest(store, ALICE, "198.51.100.7", at(24 * 60 + 1))).toBe("ok");
  });

  it("allows an address at most 6 codes an hour and 12 a day, from any clients", async () => {
    const { store } = memoryTokenStore();
    let client = 0;
    const next = (m: number) => claimCodeRequest(store, ALICE, `192.0.2.${++client}`, at(m));
    for (const m of [0, 2, 4, 6, 8, 10]) expect(await next(m)).toBe("ok");
    expect(await next(12)).toBe("limit");
    for (const m of [61, 63, 65, 67, 69, 71]) expect(await next(m)).toBe("ok");
    expect(await next(130)).toBe("limit"); // 12 in the last day
    expect(await next(24 * 60 + 1)).toBe("ok");
  });

  it("allows one client at most 50 codes an hour across addresses", async () => {
    const { store } = memoryTokenStore();
    for (let i = 0; i < 50; i++) expect(await claimCodeRequest(store, `user${i}@example.com`, "198.51.100.7", at(i / 60))).toBe("ok");
    expect(await claimCodeRequest(store, "late@example.com", "198.51.100.7", at(30))).toBe("client-limit");
    expect(await claimCodeRequest(store, "late@example.com", "203.0.113.9", at(30))).toBe("ok");
    expect(await claimCodeRequest(store, "late2@example.com", "198.51.100.7", at(61))).toBe("ok");
  });

  it("never lets a burst from one client past its limit", async () => {
    const { store } = memoryTokenStore();
    const verdicts = await Promise.all(
      Array.from({ length: 80 }, (_, i) => claimCodeRequest(store, `user${i}@example.com`, "198.51.100.7", T0)),
    );
    expect(verdicts.filter((v) => v === "ok").length).toBeLessThanOrEqual(50);
    expect(verdicts.every((v) => v === "ok" || v === "client-limit")).toBe(true);
    expect(await claimCodeRequest(store, "late@example.com", "198.51.100.7", at(30))).toBe("client-limit");
    expect(await claimCodeRequest(store, "late@example.com", "203.0.113.9", at(30))).toBe("ok");
    // A request refused for the client leaves the address free to ask from elsewhere.
    expect(await claimCodeRequest(store, "user79@example.com", "203.0.113.9", at(30))).toBe("ok");
  });

  it("allows one client at most 200 codes a day", async () => {
    const { store } = memoryTokenStore();
    let n = 0;
    for (let hour = 0; hour < 4; hour++) {
      for (let i = 0; i < 50; i++) {
        expect(await claimCodeRequest(store, `u${n++}@example.com`, "198.51.100.7", at(hour * 61))).toBe("ok");
      }
    }
    expect(await claimCodeRequest(store, "one-more@example.com", "198.51.100.7", at(5 * 61))).toBe("client-limit");
  });

  it("writes nothing for a refused request", async () => {
    const { store, rows } = memoryTokenStore();
    for (const m of [0, 2, 4]) await claimCodeRequest(store, ALICE, "198.51.100.7", at(m));
    const before = rows.length;
    for (let i = 0; i < 20; i++) expect(await claimCodeRequest(store, ALICE, "198.51.100.7", at(5))).toBe("limit");
    expect(await claimCodeRequest(store, ALICE, "203.0.113.9", at(4.5))).toBe("wait");
    expect(rows).toHaveLength(before);
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

  it("clears an identifier, purges only a prefix's expired rows, and counts live rows", async () => {
    const c = client();
    const store = prismaTokenStore(c);
    await store.clear("a@b.co");
    await store.purgeExpired(T0, NAMESPACE);
    expect(await store.countLive("a@b.co", T0)).toBe(3);
    expect(c.mocks.deleteMany.mock.calls.map(([args]) => args)).toEqual([
      { where: { identifier: "a@b.co" } },
      { where: { identifier: { startsWith: "Sign-in code" }, expires: { lt: T0 } } },
    ]);
    expect(c.mocks.count).toHaveBeenCalledWith({ where: { identifier: "a@b.co", expires: { gt: T0 } } });
  });
});
