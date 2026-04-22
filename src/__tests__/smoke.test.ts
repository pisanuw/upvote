/**
 * Smoke tests — require the dev or prod server to be running.
 * Set BASE_URL env var to override (default: http://localhost:3001).
 *
 * Run: BASE_URL=http://localhost:3001 npm test -- smoke
 */

import { describe, it, expect } from "vitest";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return res;
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

describe("smoke: home page", () => {
  it("GET / returns 200 with HTML", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("UpvoteMe");
  });
});

describe("smoke: /api/topics", () => {
  it("POST with valid title returns 200 with participant and admin URLs", async () => {
    const res = await post("/api/topics", { title: "Smoke test topic" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("participantUrl");
    expect(data).toHaveProperty("adminUrl");
    expect(data.participantUrl).toMatch(/^\/t\//);
    expect(data.adminUrl).toMatch(/^\/a\//);
  });

  it("POST with too-short title returns 400", async () => {
    const res = await post("/api/topics", { title: "Hi" });
    expect(res.status).toBe(400);
  });

  it("POST requiresAuthForVoting without session returns 401", async () => {
    const res = await post("/api/topics", {
      title: "Auth topic test",
      requiresAuthForVoting: true,
    });
    expect(res.status).toBe(401);
  });
});

describe("smoke: /api/t/[code]", () => {
  it("GET on unknown code returns 404", async () => {
    const res = await get("/api/t/doesnotexist");
    expect(res.status).toBe(404);
  });

  it("GET on real topic returns topic data with comments array", async () => {
    // Create a topic first
    const create = await post("/api/topics", { title: "Smoke GET topic" });
    const { participantUrl } = await create.json();
    const code = participantUrl.replace("/t/", "");

    const res = await get(`/api/t/${code}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Smoke GET topic");
    expect(Array.isArray(data.comments)).toBe(true);
  });
});

describe("smoke: /api/a/[adminCode]", () => {
  it("GET on unknown admin code returns 404", async () => {
    const res = await get("/api/a/doesnotexist");
    expect(res.status).toBe(404);
  });

  it("GET on real admin URL returns topic data", async () => {
    const create = await post("/api/topics", { title: "Smoke admin topic" });
    const { adminUrl } = await create.json();
    const adminCode = adminUrl.replace("/a/", "");

    const res = await get(`/api/a/${adminCode}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Smoke admin topic");
  });

  it("DELETE via admin URL removes the topic", async () => {
    const create = await post("/api/topics", { title: "Smoke delete topic" });
    const { adminUrl, participantUrl } = await create.json();
    const adminCode = adminUrl.replace("/a/", "");
    const code = participantUrl.replace("/t/", "");

    const del = await fetch(`${BASE}/api/a/${adminCode}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const data = await del.json();
    expect(data.deleted).toBe(true);

    // Confirm it's gone
    const check = await get(`/api/t/${code}`);
    expect(check.status).toBe(404);
  });
});
