import { afterEach, describe, expect, it, vi } from "vitest";
import { sendOwnerCode, smsConfig } from "./sms.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("SMS transport", () => {
  it("fails closed for missing production config or mock delivery", () => {
    expect(() => smsConfig({ NODE_ENV: "production" })).toThrow();
    expect(() => smsConfig({ NODE_ENV: "production", SMS_PROVIDER: "mock" })).toThrow();
    expect(() => smsConfig({ SMS_PROVIDER: "kudis" })).toThrow();
  });
  it("accepts only KudiSMS's documented success response and formats the recipient", async () => {
    vi.stubEnv("SMS_PROVIDER", "kudis");
    vi.stubEnv("KUDISMS_API_KEY", "test-key");
    vi.stubEnv("KUDISMS_SENDER_ID", "DriveMaster");
    const fetcher = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "success", error_code: "000" })
      });
    vi.stubGlobal("fetch", fetcher);
    expect(await sendOwnerCode("+2348012345678", "123456")).toBe(true);
    const payload = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(payload.recipients).toBe("2348012345678");
    expect(payload.senderID).toBe("DriveMaster");
    expect(payload.route).toBeUndefined();
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "error", error_code: "100" })
    });
    expect(await sendOwnerCode("+2348012345678", "123456")).toBe(false);
    fetcher.mockRejectedValue(new Error("timeout"));
    expect(await sendOwnerCode("+2348012345678", "123456")).toBe(false);
  });
});
