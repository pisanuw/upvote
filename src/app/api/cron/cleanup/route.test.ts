import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    topic: { deleteMany: vi.fn() },
  },
}));

import { GET } from "./route";
import { prisma } from "@/lib/prisma";

const mockDeleteMany = prisma.topic.deleteMany as ReturnType<typeof vi.fn>;

const SECRET = "test-cron-secret-value";

function makeRequest(token?: string) {
  const url = token
    ? `http://localhost/api/cron/cleanup?token=${encodeURIComponent(token)}`
    : "http://localhost/api/cron/cleanup";
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  mockDeleteMany.mockResolvedValue({ count: 0 });
});

describe("GET /api/cron/cleanup", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong token (same length)", async () => {
    const res = await GET(makeRequest("test-cron-secret-valuX"));
    expect(res.status).toBe(401);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong token (different length)", async () => {
    const res = await GET(makeRequest("nope"));
    expect(res.status).toBe(401);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not configured, even with a token", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(makeRequest(SECRET));
    expect(res.status).toBe(401);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("runs cleanup with the correct token", async () => {
    mockDeleteMany.mockResolvedValue({ count: 3 });
    const res = await GET(makeRequest(SECRET));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deletedTopics).toBe(3);
    expect(mockDeleteMany).toHaveBeenCalledOnce();
  });
});
