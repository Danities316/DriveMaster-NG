import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureEnvFile } from "./env.js";

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
