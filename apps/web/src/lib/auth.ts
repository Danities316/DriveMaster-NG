import type {
  AuthenticatedUser,
  LoginResponse,
  MeResponse,
  OwnerVerificationStatus
} from "@drivemaster/shared";
import { prepareLocalSchool } from "./localSession";

const API_BASE_URL: string = import.meta.env["VITE_API_BASE_URL"] ?? "/api";
export const AUTH_CHANGE_KEY = "drivemaster:authRevision";
export const AUTH_STORAGE_KEYS = [
  AUTH_CHANGE_KEY,
  "drivemaster:lastKnownUser",
  "drivemaster:signedOut"
];
const authRevision = () => localStorage.getItem(AUTH_CHANGE_KEY);
function beginAuthChange() {
  const revision = crypto.randomUUID();
  localStorage.setItem(AUTH_CHANGE_KEY, revision);
  return revision;
}
function requireRevision(revision: string | null) {
  if (authRevision() !== revision)
    throw new AuthError("The signed-in account changed in another tab. Sign in again.");
}
const LAST_KNOWN_USER_KEY = "drivemaster:lastKnownUser";
const SIGNED_OUT_KEY = "drivemaster:signedOut";
const VERIFICATION_KEY = "drivemaster:ownerVerification";

export type CurrentUserResult =
  | { user: null; source: "network"; verification: OwnerVerificationStatus }
  | { user: AuthenticatedUser; source: "network" }
  | { user: AuthenticatedUser; source: "cache" }
  | { user: null; source: "network" }
  | { user: null; source: "none" };

export class AuthError extends Error {}
async function accountRequest(path: string, body: object): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE_URL}/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AuthError(
      data?.error?.message ?? "Could not complete the request. Please try again."
    );
  return data;
}
export async function requestPasswordReset(phone: string): Promise<string> {
  const data = await accountRequest("password-reset/request", { phone });
  if (typeof data.requestId !== "string")
    throw new AuthError("Unexpected reset response. Try again.");
  return data.requestId;
}
function clearLocalAuthentication() {
  beginAuthChange();
  localStorage.setItem(SIGNED_OUT_KEY, "true");
  localStorage.removeItem(LAST_KNOWN_USER_KEY);
  sessionStorage.removeItem(VERIFICATION_KEY);
}
export async function resetPassword(
  requestId: string,
  code: string,
  password: string
): Promise<void> {
  const revision = authRevision();
  await accountRequest("password-reset/confirm", { requestId, code, password });
  requireRevision(revision);
  clearLocalAuthentication();
}
export async function changePassword(currentPassword: string, password: string): Promise<void> {
  const revision = authRevision();
  await accountRequest("change-password", { currentPassword, password });
  requireRevision(revision);
  clearLocalAuthentication();
}
export async function signOutEverywhere(): Promise<void> {
  const revision = authRevision();
  await accountRequest("logout-all", {});
  requireRevision(revision);
  clearLocalAuthentication();
}
export class VerificationRequiredError extends AuthError {
  constructor(public verification: OwnerVerificationStatus) {
    super("Verify your phone number to continue.");
  }
}
function isVerification(value: unknown): value is OwnerVerificationStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as OwnerVerificationStatus;
  return (
    status.verificationRequired === true &&
    typeof status.maskedPhone === "string" &&
    ["sent", "failed", "not_sent"].includes(status.delivery)
  );
}
export function getPendingVerification(): OwnerVerificationStatus | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(VERIFICATION_KEY) ?? "null");
    return isVerification(value) ? value : null;
  } catch {
    return null;
  }
}
function rememberVerification(status: OwnerVerificationStatus) {
  localStorage.removeItem(LAST_KNOWN_USER_KEY);
  localStorage.removeItem(SIGNED_OUT_KEY);
  sessionStorage.setItem(VERIFICATION_KEY, JSON.stringify(status));
}
async function verificationRequest(path: string, body?: object): Promise<unknown> {
  const revision = authRevision();
  const response = await fetch(`${API_BASE_URL}/auth/owner-verification${path}`, {
    signal: AbortSignal.timeout(20000),
    method: body ? "POST" : "GET",
    credentials: "include",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  requireRevision(revision);
  if (!response.ok)
    throw new AuthError(data.error?.message ?? "Could not verify your phone. Try again.");
  return data;
}
export async function fetchVerificationStatus(): Promise<OwnerVerificationStatus> {
  const data = await verificationRequest("");
  if (!isVerification(data)) throw new AuthError("Unexpected verification response.");
  rememberVerification(data);
  return data;
}
export async function resendVerification(phone?: string): Promise<OwnerVerificationStatus> {
  const data = await verificationRequest("/send", phone === undefined ? {} : { phone });
  if (!isVerification(data)) throw new AuthError("Unexpected verification response.");
  rememberVerification(data);
  return data;
}
export async function confirmVerification(code: string): Promise<AuthenticatedUser> {
  const revision = authRevision();
  const data = (await verificationRequest("/confirm", { code })) as LoginResponse;
  if (!isAuthenticatedUser(data.user)) throw new AuthError("Unexpected verification response.");
  await prepareLocalSchool(data.user);
  requireRevision(revision);
  sessionStorage.removeItem(VERIFICATION_KEY);
  localStorage.removeItem(SIGNED_OUT_KEY);
  persistUser(data.user);
  return data.user;
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const user = value as Record<string, unknown>;
  return (
    typeof user["id"] === "string" &&
    typeof user["schoolId"] === "string" &&
    (user["schoolName"] === undefined || typeof user["schoolName"] === "string") &&
    typeof user["name"] === "string" &&
    typeof user["phone"] === "string" &&
    (user["role"] === "OWNER" ||
      user["role"] === "RECEPTIONIST" ||
      user["role"] === "INSTRUCTOR" ||
      user["role"] === "STUDENT")
  );
}

export function getCachedUser(): AuthenticatedUser | null {
  try {
    if (getPendingVerification()) return null;
    if (localStorage.getItem(SIGNED_OUT_KEY)) return null;
    const raw = localStorage.getItem(LAST_KNOWN_USER_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isAuthenticatedUser(parsed)) {
      localStorage.removeItem(LAST_KNOWN_USER_KEY);
      return null;
    }

    return parsed;
  } catch {
    localStorage.removeItem(LAST_KNOWN_USER_KEY);
    return null;
  }
}

function persistUser(user: AuthenticatedUser): void {
  localStorage.setItem(LAST_KNOWN_USER_KEY, JSON.stringify(user));
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function login(phone: string, password: string): Promise<AuthenticatedUser> {
  const revision = beginAuthChange();
  // An explicit sign-in attempt must never leave another account's cached
  // identity available if the request fails or the device is shared.
  localStorage.setItem(SIGNED_OUT_KEY, "true");
  sessionStorage.removeItem(VERIFICATION_KEY);
  localStorage.removeItem(LAST_KNOWN_USER_KEY);
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phone, password })
  });

  const data: unknown = await parseJsonResponse<unknown>(response);
  requireRevision(revision);
  if (response.ok && isVerification(data)) {
    rememberVerification(data);
    throw new VerificationRequiredError(data);
  }
  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      typeof (data as { error?: { message?: unknown } }).error?.message === "string"
        ? (data as { error: { message: string } }).error.message
        : "Phone number or password is incorrect.";
    throw new AuthError(message);
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !isAuthenticatedUser((data as LoginResponse).user)
  ) {
    throw new AuthError("The server returned an unexpected login response.");
  }

  const user = (data as LoginResponse).user;
  try {
    await prepareLocalSchool(user);
    requireRevision(revision);
  } catch (error) {
    requireRevision(revision);
    localStorage.setItem(SIGNED_OUT_KEY, "true");
    localStorage.removeItem(LAST_KNOWN_USER_KEY);
    throw new AuthError(
      error instanceof Error ? error.message : "Unable to prepare this school's local data."
    );
  }
  localStorage.removeItem(SIGNED_OUT_KEY);
  sessionStorage.removeItem(VERIFICATION_KEY);
  persistUser(user);
  return user;
}

export async function registerOwner(input: {
  ownerName: string;
  phone: string;
  password: string;
  schoolName: string;
  schoolAddress: string;
  cacNumber: string;
  frscNumber: string;
  acceptedTerms: boolean;
}): Promise<OwnerVerificationStatus> {
  const revision = beginAuthChange();
  const response = await fetch(`${API_BASE_URL}/auth/register-owner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });
  const data: unknown = await parseJsonResponse<unknown>(response);
  requireRevision(revision);
  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      typeof (data as { error?: { message?: unknown } }).error?.message === "string"
        ? (data as { error: { message: string } }).error.message
        : "Could not create the account. Try again.";
    throw new AuthError(message);
  }
  if (typeof data !== "object" || data === null || !isVerification(data))
    throw new AuthError("The server returned an unexpected registration response.");
  rememberVerification(data);
  return data;
}

export async function fetchCurrentUser(): Promise<CurrentUserResult> {
  const revision = authRevision();
  if (localStorage.getItem(SIGNED_OUT_KEY)) return { user: null, source: "network" };
  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: "GET",
      signal: AbortSignal.timeout(20000),
      credentials: "include"
    });

    if (authRevision() !== revision) return { user: null, source: "none" };
    if (localStorage.getItem(SIGNED_OUT_KEY)) return { user: null, source: "network" };

    if (response.status === 401 || response.status === 403) {
      beginAuthChange(); // Fence older in-flight responses in every tab after a server rejection.
      localStorage.removeItem(LAST_KNOWN_USER_KEY);
      try {
        return { user: null, source: "network", verification: await fetchVerificationStatus() };
      } catch {
        sessionStorage.removeItem(VERIFICATION_KEY);
      }
      return { user: null, source: "network" };
    }
    const data: unknown = await parseJsonResponse<unknown>(response);
    if (authRevision() !== revision) return { user: null, source: "none" };
    if (response.ok && isVerification(data)) {
      rememberVerification(data);
      return { user: null, source: "network", verification: data };
    }
    if (!response.ok) {
      const cached = getCachedUser();
      if (cached) {
        return { user: cached, source: "cache" };
      }
      return { user: null, source: "network" };
    }

    if (
      typeof data !== "object" ||
      data === null ||
      !isAuthenticatedUser((data as MeResponse).user)
    ) {
      const cached = getCachedUser();
      if (cached) {
        return { user: cached, source: "cache" };
      }
      return { user: null, source: "network" };
    }

    const user = (data as MeResponse).user;
    try {
      await prepareLocalSchool(user);
      if (authRevision() !== revision) return { user: null, source: "none" };
    } catch {
      if (authRevision() !== revision) return { user: null, source: "none" };
      localStorage.removeItem(LAST_KNOWN_USER_KEY);
      return { user: null, source: "network" };
    }
    sessionStorage.removeItem(VERIFICATION_KEY);
    persistUser(user);
    return { user, source: "network" };
  } catch {
    if (authRevision() !== revision) return { user: null, source: "none" };
    const cached = getCachedUser();
    if (cached) {
      return { user: cached, source: "cache" };
    }
    return { user: null, source: "none" };
  }
}

export async function logout(): Promise<void> {
  const revision = beginAuthChange();
  sessionStorage.removeItem(VERIFICATION_KEY);
  localStorage.setItem(SIGNED_OUT_KEY, "true");
  localStorage.removeItem(LAST_KNOWN_USER_KEY);
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      credentials: "include"
    });
  } catch {
    // The local sign-out marker prevents an uncleared server cookie reopening the UI.
  } finally {
    if (authRevision() === revision) localStorage.removeItem(LAST_KNOWN_USER_KEY);
  }
}
