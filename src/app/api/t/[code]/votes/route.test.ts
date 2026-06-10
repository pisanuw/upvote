import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    topic: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    comment: {
      findFirst: vi.fn(),
    },
    vote: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { cookies } from "next/headers";

const mockTopicFindUnique = prisma.topic.findUnique as ReturnType<typeof vi.fn>;
const mockCommentFindFirst = prisma.comment.findFirst as ReturnType<typeof vi.fn>;
const mockVoteUpsert = prisma.vote.upsert as ReturnType<typeof vi.fn>;
const mockVoteDeleteMany = prisma.vote.deleteMany as ReturnType<typeof vi.fn>;
const mockVoteAggregate = prisma.vote.aggregate as ReturnType<typeof vi.fn>;
const mockTopicUpdate = prisma.topic.update as ReturnType<typeof vi.fn>;
const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCookies = cookies as ReturnType<typeof vi.fn>;

function makeRequest(code: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/t/${code}/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ code }) },
  };
}

function makeTopic(overrides = {}) {
  return {
    id: "topic-id-1",
    requiresAuthForVoting: false,
    isLocked: false,
    lastActivityAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null);
  mockCookies.mockResolvedValue({ get: () => undefined, set: vi.fn() });
  mockTopicUpdate.mockResolvedValue({});
  mockVoteUpsert.mockResolvedValue({});
  mockVoteDeleteMany.mockResolvedValue({});
  mockVoteAggregate.mockResolvedValue({ _sum: { value: 1 } });
});

describe("POST /api/t/[code]/votes", () => {
  it("returns 400 for invalid payload (missing commentId)", async () => {
    mockTopicFindUnique.mockResolvedValue(makeTopic());
    const { request, context } = makeRequest("abc123", { value: 1 });
    const res = await POST(request, context);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid vote value", async () => {
    mockTopicFindUnique.mockResolvedValue(makeTopic());
    const { request, context } = makeRequest("abc123", { commentId: "c1", value: 2 });
    const res = await POST(request, context);
    expect(res.status).toBe(400);
  });

  it("returns 404 when topic is not found", async () => {
    mockTopicFindUnique.mockResolvedValue(null);
    const { request, context } = makeRequest("notfound", { commentId: "c1", value: 1 });
    expect((await POST(request, context)).status).toBe(404);
  });

  it("returns 404 when topic is expired", async () => {
    mockTopicFindUnique.mockResolvedValue(makeTopic({ lastActivityAt: new Date(0) }));
    const { request, context } = makeRequest("oldcode", { commentId: "c1", value: 1 });
    expect((await POST(request, context)).status).toBe(404);
  });

  it("returns 401 when auth-required topic and user is not signed in", async () => {
    mockTopicFindUnique.mockResolvedValue(makeTopic({ requiresAuthForVoting: true }));
    const { request, context } = makeRequest("authcode", { commentId: "c1", value: 1 });
    expect((await POST(request, context)).status).toBe(401);
  });

  it("returns 404 when comment is not found", async () => {
    mockTopicFindUnique.mockResolvedValue(makeTopic());
    mockCommentFindFirst.mockResolvedValue(null);
    const { request, context } = makeRequest("abc123", { commentId: "c-missing", value: 1 });
    expect((await POST(request, context)).status).toBe(404);
  });

  it("records upvote and returns score and myVote", async () => {
    mockTopicFindUnique.mockResolvedValue(makeTopic());
    mockCommentFindFirst.mockResolvedValue({ id: "c1", topicId: "topic-id-1" });
    mockVoteAggregate.mockResolvedValue({ _sum: { value: 3 } });

    const { request, context } = makeRequest("abc123", { commentId: "c1", value: 1 });
    const res = await POST(request, context);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.score).toBe(3);
    expect(data.myVote).toBe(1);
    expect(mockVoteUpsert).toHaveBeenCalledOnce();
  });

  it("records downvote and returns score and myVote", async () => {
    mockTopicFindUnique.mockResolvedValue(makeTopic());
    mockCommentFindFirst.mockResolvedValue({ id: "c1", topicId: "topic-id-1" });
    mockVoteAggregate.mockResolvedValue({ _sum: { value: -1 } });

    const { request, context } = makeRequest("abc123", { commentId: "c1", value: -1 });
    const res = await POST(request, context);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.score).toBe(-1);
    expect(data.myVote).toBe(-1);
  });

  it("value=0 deletes the vote and returns myVote: null", async () => {
    mockTopicFindUnique.mockResolvedValue(makeTopic());
    mockCommentFindFirst.mockResolvedValue({ id: "c1", topicId: "topic-id-1" });
    mockVoteAggregate.mockResolvedValue({ _sum: { value: 0 } });

    const { request, context } = makeRequest("abc123", { commentId: "c1", value: 0 });
    const res = await POST(request, context);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.myVote).toBeNull();
    expect(mockVoteDeleteMany).toHaveBeenCalledOnce();
    expect(mockVoteUpsert).not.toHaveBeenCalled();
  });

  it("uses authenticated user id as voter key when signed in", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-42" } });
    mockTopicFindUnique.mockResolvedValue(makeTopic());
    mockCommentFindFirst.mockResolvedValue({ id: "c1", topicId: "topic-id-1" });
    mockVoteAggregate.mockResolvedValue({ _sum: { value: 1 } });

    const { request, context } = makeRequest("abc123", { commentId: "c1", value: 1 });
    await POST(request, context);

    expect(mockVoteUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { commentId_voterKey: { commentId: "c1", voterKey: "user_user-42" } },
      }),
    );
  });
});
