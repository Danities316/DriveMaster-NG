import { describe, expect, it, vi } from "vitest";
import {
  createOwnerVerification,
  type VerificationState,
  type VerificationStore
} from "./ownerVerification.js";

function fixture() {
  let time = new Date("2026-10-14T10:00:00Z");
  const state: VerificationState = {
    user: {
      id: "owner",
      schoolId: "school",
      name: "Ada",
      phone: "+2348012345678",
      passwordHash: "private",
      role: "OWNER",
      isActive: true,
      phoneVerificationRequired: true,
      schoolStatus: "TRIAL"
    },
    challenge: null,
    verifiedAt: null
  };
  const rates = new Map<string, { count: number; start: number }>();
  const store: VerificationStore = {
    async transaction(_id, action) {
      return action(state);
    },
    async consume(key, max, window, now) {
      let rate = rates.get(key);
      if (!rate || now.getTime() - rate.start >= window) {
        rate = { count: 0, start: now.getTime() };
        rates.set(key, rate);
      }
      if (++rate.count > max) throw new Error("Rate limited");
    }
  };
  const send = vi.fn().mockResolvedValue(true);
  let nextCode = "123456";
  const service = createOwnerVerification({
    store,
    secret: "long-random-test-secret",
    send,
    code: () => nextCode,
    now: () => time
  });
  return {
    state,
    rates,
    store,
    send,
    service,
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
    setCode: (value: string) => {
      nextCode = value;
    }
  };
}
describe("owner phone verification", () => {
  it("generates a code only when a verification message is requested", async () => {
    const f = fixture();
    const generateCode = vi.fn(() => "123456");
    const service = createOwnerVerification({
      store: f.store,
      secret: "long-random-test-secret",
      send: f.send,
      code: generateCode,
      now: () => new Date("2026-10-14T10:00:00Z")
    });
    expect(generateCode).not.toHaveBeenCalled();
    await service.send("owner", "ip");
    expect(generateCode).toHaveBeenCalledOnce();
  });
  it("stores only a keyed digest, masks the phone and requires a code before activation", async () => {
    const f = fixture();
    const status = await f.service.send("owner", "ip");
    expect(status.delivery).toBe("sent");
    expect(status.maskedPhone).not.toContain("801234");
    expect(f.state.challenge?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(f.state.challenge)).not.toContain('"123456"');
    expect(f.state.user.phoneVerificationRequired).toBe(true);
    await f.service.verify("owner", "123456", "ip");
    expect(f.state.user.phoneVerificationRequired).toBe(false);
    expect(f.state.verifiedAt).toEqual(new Date("2026-10-14T10:00:00Z"));
    expect(f.state.challenge?.digest).toBeNull();
    await expect(f.service.verify("owner", "123456", "ip")).rejects.toThrow("Sign in again");
  });
  it("persists wrong attempts and prevents guessing after five failures", async () => {
    const f = fixture();
    await f.service.send("owner", "ip");
    for (let n = 0; n < 5; n++)
      await expect(f.service.verify("owner", "999999", "ip")).rejects.toThrow("incorrect");
    expect(f.state.challenge?.attempts).toBe(5);
    await expect(f.service.verify("owner", "123456", "ip")).rejects.toThrow("unavailable");
    expect(f.state.user.phoneVerificationRequired).toBe(true);
  });
  it("rejects expired codes and replaces old codes on resend", async () => {
    const f = fixture();
    await f.service.send("owner", "ip");
    f.advance(600000);
    await expect(f.service.verify("owner", "123456", "ip")).rejects.toThrow("expired");
    f.setCode("654321");
    await f.service.send("owner", "ip");
    await expect(f.service.verify("owner", "123456", "ip")).rejects.toThrow("incorrect");
    await f.service.verify("owner", "654321", "ip");
  });
  it("enforces cooldown and replaces the phone and code on correction", async () => {
    const f = fixture();
    await f.service.send("owner", "ip");
    await expect(f.service.send("owner", "ip", "+2348098765432")).rejects.toThrow("Wait");
    expect(f.state.user.phone).toBe("+2348012345678");
    f.advance(60000);
    f.setCode("654321");
    await f.service.send("owner", "ip", "+2348098765432");
    expect(f.send).toHaveBeenLastCalledWith("+2348098765432", "654321");
    await expect(f.service.verify("owner", "123456", "ip")).rejects.toThrow("incorrect");
  });
  it("keeps registration pending and makes a failed send's code unusable", async () => {
    const f = fixture();
    f.send.mockResolvedValue(false);
    expect((await f.service.send("owner", "ip")).delivery).toBe("failed");
    await expect(f.service.verify("owner", "123456", "ip")).rejects.toThrow("unavailable");
    expect(f.state.user.phoneVerificationRequired).toBe(true);
    f.advance(60000);
    f.send.mockResolvedValue(true);
    await f.service.send("owner", "ip");
    await f.service.verify("owner", "123456", "ip");
  });
  it("applies aggregate attempt limits across replacement challenges", async () => {
    const f = fixture();
    for (let n = 0; n < 4; n++) {
      await f.service.send("owner", "ip");
      for (let a = 0; a < 5; a++)
        await expect(f.service.verify("owner", "999999", "ip")).rejects.toThrow();
      f.advance(60000);
    }
    await f.service.send("owner", "ip");
    await expect(f.service.verify("owner", "123456", "ip")).rejects.toThrow("Rate limited");
  });
  it("caps SMS sends per owner despite changing the phone or IP", async () => {
    const f = fixture();
    for (let n = 0; n < 10; n++) {
      await f.service.send("owner", `ip-${n}`, `+23480123456${String(n).padStart(2, "0")}`);
      f.advance(60000);
    }
    await expect(f.service.send("owner", "another-ip", "+2348098765432")).rejects.toThrow(
      "Rate limited"
    );
    expect(f.send).toHaveBeenCalledTimes(10);
  });
  it("rejects suspended accounts even with a valid code", async () => {
    const f = fixture();
    await f.service.send("owner", "ip");
    f.state.user.schoolStatus = "SUSPENDED";
    await expect(f.service.verify("owner", "123456", "ip")).rejects.toThrow("Sign in again");
  });
  it("charges delivery budget only for approved sends, including provider attempts", async () => {
    const f = fixture();
    await f.service.send("owner", "ip");
    expect(f.rates.get("sms-delivery-global")?.count).toBe(1);
    await expect(f.service.send("owner", "ip")).rejects.toThrow("Wait");
    expect(f.rates.get("sms-delivery-global")?.count).toBe(1);
    f.advance(60000);
    f.send.mockResolvedValueOnce(false);
    expect((await f.service.send("owner", "ip")).delivery).toBe("failed");
    expect(f.rates.get("sms-delivery-global")?.count).toBe(2);
    f.state.user.isActive = false;
    await expect(f.service.send("owner", "another-ip")).rejects.toThrow("Sign in again");
    expect(f.rates.get("sms-delivery-global")?.count).toBe(2);
  });
  it("fails closed when the delivery budget is exhausted", async () => {
    const f = fixture();
    f.rates.set("sms-delivery-global", {
      count: 500,
      start: new Date("2026-10-14T10:00:00Z").getTime()
    });
    expect((await f.service.send("owner", "ip")).delivery).toBe("failed");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.state.challenge?.digest).toBeNull();
  });
});
