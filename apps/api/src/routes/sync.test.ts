import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { hashPassword } from "../auth/password.js";
import type { UserRecordForAuth } from "../auth/authService.js";
import type { SyncDeps } from "../sync/syncRepository.js";

const user: UserRecordForAuth = {
  id: "owner",
  schoolId: "school",
  name: "Owner",
  phone: "08012345678",
  passwordHash: hashPassword("password123"),
  role: "OWNER",
  isActive: true
};
let activeUser: UserRecordForAuth;
let deps: SyncDeps;
const build = () =>
  createApp({
    webOrigin: "http://localhost:5173",
    authSecret: "sync-test-secret-with-more-than-32-characters",
    sessionMaxAgeSeconds: 3600,
    secureCookies: false,
    authDeps: { findUserByPhone: async () => activeUser },
    syncDeps: deps
  });
const mutation = () => ({
  mutationId: randomUUID(),
  deviceId: randomUUID(),
  schoolId: "school",
  entity: "student",
  action: "CREATE",
  payload: {}
});
beforeEach(() => {
  activeUser = { ...user };
  deps = {
    process: vi.fn(async (_school, _user, item) => ({
      status: "processed" as const,
      result: { mutationId: item.mutationId }
    })),
    pull: vi.fn(async (_school, cursor) => ({ changes: [], nextCursor: cursor, hasMore: false }))
  };
});
async function login() {
  const agent = request.agent(build());
  await agent
    .post("/api/auth/login")
    .send({ phone: user.phone, password: "password123" })
    .expect(200);
  return agent;
}
describe("synchronization HTTP authorization and protocol", () => {
  it("requires authentication", async () => {
    await request(build())
      .post("/api/v1/sync/batch")
      .send({ mutations: [mutation()] })
      .expect(401);
    expect(deps.process).not.toHaveBeenCalled();
  });
  it("derives the school and actor from the session and returns acknowledgements", async () => {
    const agent = await login();
    const item = mutation();
    const response = await agent
      .post("/api/v1/sync/batch")
      .send({ mutations: [item] })
      .expect(200);
    expect(response.body.processedIds).toEqual([item.mutationId]);
    expect(deps.process).toHaveBeenCalledWith(user.schoolId, user.id, item);
  });
  it("rejects a mixed-school batch before any writes", async () => {
    const agent = await login();
    await agent
      .post("/api/v1/sync/batch")
      .send({ mutations: [mutation(), { ...mutation(), schoolId: "other" }] })
      .expect(403);
    expect(deps.process).not.toHaveBeenCalled();
  });
  it("rechecks a revoked role before sending student or financial data", async () => {
    const agent = await login();
    activeUser.role = "INSTRUCTOR";
    await agent.get("/api/v1/sync/changes?schoolId=school").expect(403);
    await agent
      .post("/api/v1/sync/batch")
      .send({ mutations: [mutation()] })
      .expect(403);
    expect(deps.pull).not.toHaveBeenCalled();
    expect(deps.process).not.toHaveBeenCalled();
  });
  it("does not accept foreign-school pull requests", async () => {
    const agent = await login();
    await agent.get("/api/v1/sync/changes?schoolId=other").expect(403);
    expect(deps.pull).not.toHaveBeenCalled();
  });
  it("validates batch sizes, identifiers and cursors", async () => {
    const agent = await login();
    await agent
      .post("/api/v1/sync/batch")
      .send({ mutations: Array.from({ length: 51 }, mutation) })
      .expect(400);
    await agent
      .post("/api/v1/sync/batch")
      .send({ mutations: [{ ...mutation(), mutationId: "invalid" }] })
      .expect(400);
    await agent.get("/api/v1/sync/changes?schoolId=school&cursor=-1").expect(400);
    await agent.get("/api/v1/sync/changes?schoolId=school&cursor=9999999999999999999").expect(400);
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.pull).not.toHaveBeenCalled();
  });
  it("reports conflicts and permanent failures separately from accepted changes", async () => {
    const agent = await login();
    const items = [mutation(), mutation()];
    deps.process = vi
      .fn()
      .mockResolvedValueOnce({
        status: "conflict",
        conflict: { mutationId: items[0]!.mutationId, message: "Changed" }
      })
      .mockResolvedValueOnce({ status: "failed", message: "Invalid fields" });
    const response = await agent.post("/api/v1/sync/batch").send({ mutations: items }).expect(200);
    expect(response.body.success).toBe(false);
    expect(response.body.processedIds).toEqual([]);
    expect(response.body.conflicts).toHaveLength(1);
    expect(response.body.failures).toHaveLength(1);
  });
});
