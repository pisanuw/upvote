import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    topic: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { cookies } from "next/headers";

const mockFindUnique = prisma.topic.findUnique as ReturnType<typeof vi.fn>;
const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCookies = cookies as ReturnType<typeof vi.fn>;

function makeRequest(code: string) {
  return {
    request: new Request(`http://localhost/api/t/${code}`),
    context: { params: Promise.resolve({ code }) },
  };
}

function makeTopic(overrides = {}) {
  return {
    id: "topic-id-1",
    title: "Test Topic",
    description: null,
    requiresAuthForVoting: false,
    isLocked: false,
    lastActivityAt: new Date(),
    comments: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null);
  mockCookies.mockResolvedValue({ get: () => undefined });
});

describe("GET /api/t/[code]", () => {
  it("returns 404 when topic is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const { request, context } = makeRequest("notfound");

    const res = await GET(request, context);
    expect(res.status).toBe(404);
  });

  it("returns 404 when topic is expired", async () => {
    const expiredTopic = makeTopic({
      lastActivityAt: new Date(0), // epoch — very old
    });
    mockFindUnique.mockResolvedValue(expiredTopic);

    const { request, context } = makeRequest("oldcode");
    const res = await GET(request, context);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/expired/i);
  });

  it("returns topic data with empty comments", async () => {
    mockFindUnique.mockResolvedValue(makeTopic());
    const { request, context } = makeRequest("abc123xy");

    const res = await GET(request, context);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Test Topic");
    expect(data.comments).toEqual([]);
  });

  it("computes score and myVote=null for anon user with no prior vote", async () => {
    const topic = makeTopic({
      comments: [
        {
          id: "c1",
          authorName: "Alice",
          body: "Hello",
          createdAt: new Date(),
          attachments: [],
          votes: [{ value: 1, voterKey: "anon_other", voterUserId: null, voterUser: null }],
        },
      ],
    });
    mockFindUnique.mockResolvedValue(topic);
    mockCookies.mockResolvedValue({ get: () => undefined });

    const { request, context } = makeRequest("abc123xy");
    const res = await GET(request, context);
    const data = await res.json();

    expect(data.comments[0].score).toBe(1);
    expect(data.comments[0].myVote).toBeNull();
  });

  it("reflects myVote for anon user via cookie", async () => {
    const topic = makeTopic({
      comments: [
        {
          id: "c1",
          authorName: "Bob",
          body: "Hi",
          createdAt: new Date(),
          attachments: [],
          votes: [{ value: -1, voterKey: "anon_my_key", voterUserId: null, voterUser: null }],
        },
      ],
    });
    mockFindUnique.mockResolvedValue(topic);
    mockCookies.mockResolvedValue({ get: (name: string) => name === "upvote_anon_id" ? { value: "anon_my_key" } : undefined });

    const { request, context } = makeRequest("abc123xy");
    const res = await GET(request, context);
    const data = await res.json();

    expect(data.comments[0].myVote).toBe(-1);
  });

  it("reflects myVote for authenticated user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    const topic = makeTopic({
      comments: [
        {
          id: "c1",
          authorName: "Carol",
          body: "Hey",
          createdAt: new Date(),
          attachments: [],
          votes: [{ value: 1, voterKey: "user_user-1", voterUserId: "user-1", voterUser: { id: "user-1", name: "Carol", email: "c@example.com" } }],
        },
      ],
    });
    mockFindUnique.mockResolvedValue(topic);

    const { request, context } = makeRequest("abc123xy");
    const res = await GET(request, context);
    const data = await res.json();

    expect(data.comments[0].myVote).toBe(1);
  });
});
