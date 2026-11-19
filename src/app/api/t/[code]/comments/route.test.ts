/**
 * The new-comment mail to the site owner, through the installed nodemailer
 * with a fake SMTP wire (no network, no database): the route's SMTP settings
 * reach createTransport, and the message nodemailer builds names the topic,
 * the author, the comment and the link. What a visitor types never becomes a
 * recipient or a header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import nodemailer from "nodemailer";
import { fakeSmtp } from "@/__tests__/fake-smtp";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    topic: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    comment: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
  getAttachmentBucket: vi.fn(),
}));

import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

const mockTopicFindUnique = prisma.topic.findUnique as ReturnType<typeof vi.fn>;
const mockTopicUpdate = prisma.topic.update as ReturnType<typeof vi.fn>;
const mockCommentCreate = prisma.comment.create as ReturnType<typeof vi.fn>;
const mockHeaders = headers as unknown as ReturnType<typeof vi.fn>;

const OWNER = "owner@upvoteme.test";
const realEnv = { ...process.env };

function postComment(code: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return POST(new Request(`http://localhost/api/t/${code}/comments`, { method: "POST", body: form }), {
    params: Promise.resolve({ code }),
  });
}

/** The Subject header with RFC 2047 Q-encoded words decoded (nodemailer encodes a '"'). */
function subjectOf(raw: string) {
  const value = raw.split("\r\n").find((line) => line.startsWith("Subject: "))!.slice("Subject: ".length);
  return value.replace(/=\?UTF-8\?Q\?(.*?)\?=/gi, (_word, q: string) =>
    Buffer.from(
      q.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_hex, h: string) => String.fromCharCode(parseInt(h, 16))),
      "latin1",
    ).toString("utf8"),
  );
}

function topic(title: string) {
  return {
    id: "topic-1",
    title,
    shortCode: "abc123",
    adminOwnerUserId: "owner-1",
    isLocked: false,
    requiresAuthForVoting: false,
    lastActivityAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    NEXTAUTH_URL: "https://upvoteme.hintwise.org",
    AUTH_SMTP_HOST: "smtp.test",
    AUTH_SMTP_PORT: "465",
    AUTH_SMTP_USER: "u",
    AUTH_SMTP_PASS: "p",
    AUTH_SMTP_FROM: OWNER,
  });
  mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.7" }));
  mockTopicUpdate.mockResolvedValue({});
  mockCommentCreate.mockImplementation(async ({ data }: { data: { authorName: string; body: string } }) => ({
    id: "comment-1",
    parentId: null,
    authorName: data.authorName,
    body: data.body,
    createdAt: new Date(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...realEnv };
});

describe("POST /api/t/[code]/comments, the owner's mail", () => {
  it("mails the site owner over SMTP with the topic, author, comment and link", async () => {
    const { sent } = fakeSmtp(nodemailer);
    mockTopicFindUnique.mockResolvedValue(topic("Lunch poll"));

    const res = await postComment("abc123", { authorName: "Bea", body: "Tacos, please." });

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const [mail] = sent;
    expect(mail.smtp).toEqual({ host: "smtp.test", port: 465, auth: { user: "u", pass: "p" } });
    expect(mail.envelope).toEqual({ from: OWNER, to: [OWNER] });
    expect(subjectOf(mail.raw)).toBe('New comment on "Lunch poll"');
    expect(mail.text).toContain('Bea commented on your topic "Lunch poll":');
    expect(mail.text).toContain("Tacos, please.");
    expect(mail.text).toContain("View it at: https://upvoteme.hintwise.org/t/abc123");
  });

  it("keeps a line break in a visitor's title or name out of the headers and recipients", async () => {
    const { sent } = fakeSmtp(nodemailer);
    mockTopicFindUnique.mockResolvedValue(topic("Lunch\r\nBcc: attacker@evil.test"));

    const res = await postComment("abc123", {
      authorName: "Bea <attacker@evil.test>, attacker2@evil.test",
      body: "Hi\r\nCc: attacker3@evil.test",
    });

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const [mail] = sent;
    expect(mail.envelope).toEqual({ from: OWNER, to: [OWNER] });
    const headerBlock = mail.raw.split("\r\n\r\n")[0];
    expect(headerBlock).not.toMatch(/^(Bcc|Cc):/im);
    expect(headerBlock).not.toContain("evil.test");
  });

  it("sends nothing when SMTP is not configured", async () => {
    const { sent, spy } = fakeSmtp(nodemailer);
    delete process.env.AUTH_SMTP_HOST;
    mockTopicFindUnique.mockResolvedValue(topic("Lunch poll"));

    const res = await postComment("abc123", { authorName: "Bea", body: "Tacos, please." });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
