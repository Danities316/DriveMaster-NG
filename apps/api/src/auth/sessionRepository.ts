import { createHash } from "node:crypto";
import { getPrismaClient } from "../prisma.js";
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function isTokenRevoked(token: string): Promise<boolean> {
  const row = await getPrismaClient().revokedSession.findUnique({
    where: { tokenHash: tokenHash(token) }
  });
  return !!row && row.expiresAt > new Date();
}
export async function revokeToken(token: string, expiresAt: Date): Promise<void> {
  await getPrismaClient().revokedSession.upsert({
    where: { tokenHash: tokenHash(token) },
    create: { tokenHash: tokenHash(token), expiresAt },
    update: { expiresAt }
  });
}
