import { describe, expect, it, vi } from "vitest";
import { login, type UserRecordForAuth } from "./authService";
import { hashPassword } from "./password";

function makeUser(overrides: Partial<UserRecordForAuth> = {}): UserRecordForAuth {
  return {
    id: "user-1",
    schoolId: "school-1",
    name: "Ada Okafor",
    phone: "+2348012345678",
    passwordHash: hashPassword("correct-password"),
    role: "OWNER",
    isActive: true,
    ...overrides
  };
}

describe("login", () => {
  it("succeeds with the correct phone and password", async () => {
    const user = makeUser();
    const findUserByPhone = vi.fn().mockResolvedValue(user);

    const result = await login(user.phone, "correct-password", { findUserByPhone });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(user.id);
    }
    expect(findUserByPhone).toHaveBeenCalledWith(user.phone);
  });

  it("fails with an incorrect password", async () => {
    const user = makeUser();
    const findUserByPhone = vi.fn().mockResolvedValue(user);

    const result = await login(user.phone, "wrong-password", { findUserByPhone });

    expect(result).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("fails with an unknown phone number, using the same reason as wrong password", async () => {
    const findUserByPhone = vi.fn().mockResolvedValue(null);

    const result = await login("+2340000000000", "anything", { findUserByPhone });

    expect(result).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("fails for a deactivated account even with the correct password", async () => {
    const user = makeUser({ isActive: false });
    const findUserByPhone = vi.fn().mockResolvedValue(user);

    const result = await login(user.phone, "correct-password", { findUserByPhone });

    expect(result).toEqual({ ok: false, reason: "ACCOUNT_INACTIVE" });
  });
});
