import type { AuthenticatedUser, LoginResponse, MeResponse } from "@drivemaster/shared";
import { prepareLocalSchool } from "./localSession";

const API_BASE_URL: string = import.meta.env["VITE_API_BASE_URL"] ?? "/api";
const LAST_KNOWN_USER_KEY = "drivemaster:lastKnownUser";
const SIGNED_OUT_KEY = "drivemaster:signedOut";

export type CurrentUserResult =
  | { user: AuthenticatedUser; source: "network" }
  | { user: AuthenticatedUser; source: "cache" }
  | { user: null; source: "network" }
  | { user: null; source: "none" };

export class AuthError extends Error {}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const user = value as Record<string, unknown>;
  return (
    typeof user["id"] === "string" &&
    typeof user["schoolId"] === "string" &&
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
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phone, password })
  });

  const data: unknown = await parseJsonResponse<unknown>(response);
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
  } catch (error) {
    localStorage.setItem(SIGNED_OUT_KEY, "true");
    localStorage.removeItem(LAST_KNOWN_USER_KEY);
    throw new AuthError(
      error instanceof Error ? error.message : "Unable to prepare this school's local data."
    );
  }
  localStorage.removeItem(SIGNED_OUT_KEY);
  persistUser(user);
  return user;
}

export async function fetchCurrentUser(): Promise<CurrentUserResult> {
  if (localStorage.getItem(SIGNED_OUT_KEY)) return { user: null, source: "network" };
  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: "GET",
      credentials: "include"
    });

    if (localStorage.getItem(SIGNED_OUT_KEY)) return { user: null, source: "network" };

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem(LAST_KNOWN_USER_KEY);
      return { user: null, source: "network" };
    }
    const data: unknown = await parseJsonResponse<unknown>(response);
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
    } catch {
      localStorage.removeItem(LAST_KNOWN_USER_KEY);
      return { user: null, source: "network" };
    }
    persistUser(user);
    return { user, source: "network" };
  } catch {
    const cached = getCachedUser();
    if (cached) {
      return { user: cached, source: "cache" };
    }
    return { user: null, source: "none" };
  }
}

export async function logout(): Promise<void> {
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
    localStorage.removeItem(LAST_KNOWN_USER_KEY);
  }
}
