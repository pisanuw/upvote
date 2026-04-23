import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    topic: { findMany: vi.fn() },
  },
}));

import { GET } from "./route";
import { prisma } from "@/lib/prisma";

const mockFindMany = prisma.topic.findMany as ReturnType<typeof vi.fn>;

const SECRET = "test-superadmin-secret";

function makeRequest(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers["x-superadmin-secret"] = secret;
  return new Request("http://localhost/api/superadmin", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPERADMIN_SECRET", SECRET);
});

describe("GET /api/superadmin", () => {
  it("returns 401 with no secret header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong secret", async () => {
    const res = await GET(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("returns 503 when SUPERADMIN_SECRET is not configured", async () => {
    vi.stubEnv("SUPERADMIN_SECRET", "");
    const res = await GET(makeRequest(SECRET));
    expect(res.status).toBe(503);
  });

  it("returns topic list with correct shape", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "t1",
        title: "Topic One",
        shortCode: "abc123xy",
        adminCode: "AdminCode1234567",
        isLocked: false,
        requiresAuthForVoting: false,
        lastActivityAt: new Date("2026-04-20"),
        createdAt: new Date("2026-04-01"),
        comments: [
          {
            id: "c1",
            authorName: "Alice",
            body: "Hello",
            createdAt: new Date("2026-04-10"),
            _count: { votes: 3, attachments: 1 },
          },
        ],
      },
    ]);

    const res = await GET(makeRequest(SECRET));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Topic One");
    expect(data[0].commentCount).toBe(1);
    expect(data[0].comments[0].voteCount).toBe(3);
    expect(data[0].comments[0].attachmentCount).toBe(1);
  });
});
