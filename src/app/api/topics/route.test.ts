import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules before importing the route
vi.mock("@/lib/prisma", () => ({
  prisma: {
    topic: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const mockPrisma = prisma as { topic: { create: ReturnType<typeof vi.fn> } };
const mockAuth = auth as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/topics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null);
});

describe("POST /api/topics", () => {
  it("creates a topic and returns participant and admin URLs", async () => {
    mockPrisma.topic.create.mockResolvedValue({
      shortCode: "abc123xy",
      adminCode: "AdminCode1234567",
      title: "My Topic",
      requiresAuthForVoting: false,
    });

    const res = await POST(makeRequest({ title: "My Topic", description: "" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.participantUrl).toBe("/t/abc123xy");
    expect(data.adminUrl).toBe("/a/AdminCode1234567");
    expect(data.topic.title).toBe("My Topic");
  });

  it("returns 400 for a title that is too short", async () => {
    const res = await POST(makeRequest({ title: "Hi" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a missing title", async () => {
    const res = await POST(makeRequest({ description: "no title here" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a title that is too long", async () => {
    const res = await POST(makeRequest({ title: "x".repeat(121) }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when requiresAuthForVoting=true but user is not signed in", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(
      makeRequest({ title: "Auth Topic", requiresAuthForVoting: true }),
    );
    expect(res.status).toBe(401);
  });

  it("creates auth-required topic when user is signed in", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.topic.create.mockResolvedValue({
      shortCode: "xyz99abc",
      adminCode: "AdminXYZ123456AB",
      title: "Auth Topic",
      requiresAuthForVoting: true,
    });

    const res = await POST(
      makeRequest({ title: "Auth Topic", requiresAuthForVoting: true }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.topic.requiresAuthForVoting).toBe(true);
  });

  it("passes description to prisma create", async () => {
    mockPrisma.topic.create.mockResolvedValue({
      shortCode: "aabbccdd",
      adminCode: "AdminABCDEFGH1234",
      title: "Topic With Desc",
      requiresAuthForVoting: false,
    });

    await POST(makeRequest({ title: "Topic With Desc", description: "Some details" }));

    expect(mockPrisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: "Some details" }),
      }),
    );
  });

  it("stores null description when description is empty string", async () => {
    mockPrisma.topic.create.mockResolvedValue({
      shortCode: "aabbccdd",
      adminCode: "AdminABCDEFGH1234",
      title: "No Desc",
      requiresAuthForVoting: false,
    });

    await POST(makeRequest({ title: "No Desc", description: "" }));

    expect(mockPrisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: null }),
      }),
    );
  });
});
