import { getPrismaClient } from "../src/prisma.js";
import { hashPassword } from "../src/auth/password.js";

const email = process.env["PLATFORM_ADMIN_EMAIL"]?.trim().toLowerCase();
const password = process.env["PLATFORM_ADMIN_PASSWORD"];
const name = process.env["PLATFORM_ADMIN_NAME"]?.trim() || "DriveMaster Administrator";
if (!email || !password || password.length < 12)
  throw new Error(
    "Set PLATFORM_ADMIN_EMAIL and a PLATFORM_ADMIN_PASSWORD of at least 12 characters."
  );
const prisma = getPrismaClient();
await prisma.platformAdmin.upsert({
  where: { email },
  update: { name, passwordHash: hashPassword(password), isActive: true },
  create: { email, name, passwordHash: hashPassword(password) }
});
console.log(`Platform administrator ready: ${email}`);
await prisma.$disconnect();
