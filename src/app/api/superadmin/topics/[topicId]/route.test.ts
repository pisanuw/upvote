import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    topic: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

import { DELETE } from "./route";
import { prisma } from "@/lib/prisma";

const mockFindUnique = prisma.topic.findUnique as ReturnType<typeof vi.fn>;
const mockDelete = prisma.topic.delete as ReturnType<typeof vi.fn>;

const SECRET = "test-superadmin-secret";

function makeRequest(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers["x-superadmin-secret"] = secret;
  return new Request("http://localhost/api/superadmin/topics/t1", { method: "DELETE", headers });
}

function makeContext(topicId: string) {
  return { params: Promise.resolve({ topicId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPERADMIN_SECRET", SECRET);
});

describe("DELETE /api/superadmin/topics/[topicId]", () => {
  it("returns 401 without secret", async () => {
    const res = await DELETE(makeRequest(), makeContext("t1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when topic not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeRequest(SECRET), makeContext("missing"));
    expect(res.status).toBe(404);
  });

  it("deletes topic and returns deleted: true", async () => {
    mockFindUnique.mockResolvedValue({ id: "t1", title: "Test" });
    mockDelete.mockResolvedValue({});
    const res = await DELETE(makeRequest(SECRET), makeContext("t1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });
});
