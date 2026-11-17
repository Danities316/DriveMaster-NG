import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureEnvFile, loadEnv } from "./env.js";

describe("loadEnv", () => {
    it("rejects the example auth token placeholder in production", () => {
        const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
        const authTokenSecret = example
            .split(/\r?\n/)
            .find((line) => line.startsWith("AUTH_TOKEN_SECRET="))
            ?.slice("AUTH_TOKEN_SECRET=".length);

        expect(authTokenSecret).toBeDefined();
        expect(() =>
            loadEnv({
                NODE_ENV: "production",
                DATABASE_URL: "postgresql://localhost/test",
                WEB_ORIGIN: "https://example.test",
                AUTH_TOKEN_SECRET: authTokenSecret
            })
        ).toThrow(/AUTH_TOKEN_SECRET must be replaced/i);
    });
});

describe("ensureEnvFile", () => {
    it("throws a helpful message when the project .env file is missing", () => {
        const tempDir = mkdtempSync(join(tmpdir(), "drivemaster-env-"));
        const missingEnvPath = join(tempDir, ".env");

        expect(() => ensureEnvFile(missingEnvPath)).toThrow(
            /Copy .*\.env\.example.*\.env/i
        );
    });

    it("accepts an existing env file", () => {
        const tempDir = mkdtempSync(join(tmpdir(), "drivemaster-env-"));
        const envPath = join(tempDir, ".env");
        writeFileSync(envPath, "DATABASE_URL=postgres://localhost/test\n");

        expect(() => ensureEnvFile(envPath)).not.toThrow();
    });

    it("does not require a local env file in production", () => {
        const tempDir = mkdtempSync(join(tmpdir(), "drivemaster-env-"));
        const missingEnvPath = join(tempDir, ".env");
        vi.stubEnv("NODE_ENV", "production");

        try {
            expect(() => ensureEnvFile(missingEnvPath)).not.toThrow();
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
