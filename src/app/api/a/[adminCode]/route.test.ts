import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    topic: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { GET, PATCH, DELETE } from "./route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const mockFindUnique = prisma.topic.findUnique as ReturnType<typeof vi.fn>;
const mockDelete = prisma.topic.delete as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.topic.update as ReturnType<typeof vi.fn>;
const mockAuth = auth as ReturnType<typeof vi.fn>;

function makeContext(adminCode: string) {
  return { params: Promise.resolve({ adminCode }) };
}

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/a/testcode", {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeTopic(overrides = {}) {
  return {
    id: "topic-id-1",
    title: "Admin Topic",
    description: null,
    shortCode: "abc123xy",
    isLocked: false,
    requiresAuthForVoting: false,
    adminOwnerUserId: null,
    lastActivityAt: new Date(),
    comments: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null);
});

// ─── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/a/[adminCode]", () => {
  it("returns 404 when topic is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), makeContext("badcode"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when topic is expired", async () => {
    mockFindUnique.mockResolvedValue(makeTopic({ lastActivityAt: new Date(0) }));
    const res = await GET(makeRequest("GET"), makeContext("oldcode"));
    expect(res.status).toBe(404);
  });

  it("returns topic data for open (no-auth) topic without signing in", async () => {
    mockFindUnique.mockResolvedValue(makeTopic());
    const res = await GET(makeRequest("GET"), makeContext("validcode"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Admin Topic");
    expect(data.comments).toEqual([]);
  });

  it("returns 403 for auth-required topic when user is not the owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } });
    mockFindUnique.mockResolvedValue(
      makeTopic({ requiresAuthForVoting: true, adminOwnerUserId: "owner-user" }),
    );
    const res = await GET(makeRequest("GET"), makeContext("authcode"));
    expect(res.status).toBe(403);
  });

  it("allows auth-required topic access for the owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-user" } });
    mockFindUnique.mockResolvedValue(
      makeTopic({ requiresAuthForVoting: true, adminOwnerUserId: "owner-user" }),
    );
    const res = await GET(makeRequest("GET"), makeContext("authcode"));
    expect(res.status).toBe(200);
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe("PATCH /api/a/[adminCode]", () => {
  it("returns 404 when topic is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH", { isLocked: true }), makeContext("badcode"));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid payload", async () => {
    mockFindUnique.mockResolvedValue(makeTopic());
    const res = await PATCH(makeRequest("PATCH", { isLocked: "yes" }), makeContext("validcode"));
    expect(res.status).toBe(400);
  });

  it("locks the topic and returns isLocked: true", async () => {
    mockFindUnique.mockResolvedValue(makeTopic());
    mockUpdate.mockResolvedValue({ isLocked: true });

    const res = await PATCH(makeRequest("PATCH", { isLocked: true }), makeContext("validcode"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isLocked).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isLocked: true }) }),
    );
  });

  it("unlocks the topic and returns isLocked: false", async () => {
    mockFindUnique.mockResolvedValue(makeTopic({ isLocked: true }));
    mockUpdate.mockResolvedValue({ isLocked: false });

    const res = await PATCH(makeRequest("PATCH", { isLocked: false }), makeContext("validcode"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isLocked).toBe(false);
  });

  it("returns 403 when non-owner tries to lock an auth-required topic", async () => {
    mockAuth.mockResolvedValue({ user: { id: "intruder" } });
    mockFindUnique.mockResolvedValue(
      makeTopic({ requiresAuthForVoting: true, adminOwnerUserId: "real-owner" }),
    );
    const res = await PATCH(makeRequest("PATCH", { isLocked: true }), makeContext("authcode"));
    expect(res.status).toBe(403);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/a/[adminCode]", () => {
  it("returns 404 when topic is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), makeContext("badcode"));
    expect(res.status).toBe(404);
  });

  it("deletes the topic and returns deleted: true", async () => {
    mockFindUnique.mockResolvedValue(makeTopic());
    mockDelete.mockResolvedValue({});

    const res = await DELETE(makeRequest("DELETE"), makeContext("validcode"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "topic-id-1" } });
  });

  it("returns 403 when non-owner tries to delete an auth-required topic", async () => {
    mockAuth.mockResolvedValue({ user: { id: "intruder" } });
    mockFindUnique.mockResolvedValue(
      makeTopic({ requiresAuthForVoting: true, adminOwnerUserId: "real-owner" }),
    );
    const res = await DELETE(makeRequest("DELETE"), makeContext("authcode"));
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
