import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

import { DELETE } from "./route";
import { prisma } from "@/lib/prisma";

const mockFindUnique = prisma.comment.findUnique as ReturnType<typeof vi.fn>;
const mockDelete = prisma.comment.delete as ReturnType<typeof vi.fn>;

const SECRET = "test-superadmin-secret";

function makeRequest(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers["x-superadmin-secret"] = secret;
  return new Request("http://localhost/api/superadmin/comments/c1", { method: "DELETE", headers });
}

function makeContext(commentId: string) {
  return { params: Promise.resolve({ commentId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPERADMIN_SECRET", SECRET);
});

describe("DELETE /api/superadmin/comments/[commentId]", () => {
  it("returns 401 without secret", async () => {
    const res = await DELETE(makeRequest(), makeContext("c1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when comment not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeRequest(SECRET), makeContext("missing"));
    expect(res.status).toBe(404);
  });

  it("deletes comment and returns deleted: true", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", body: "Hello" });
    mockDelete.mockResolvedValue({});
    const res = await DELETE(makeRequest(SECRET), makeContext("c1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });
});
