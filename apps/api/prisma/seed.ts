import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();

const PHONE = "07035545177";
const PASSWORD = "Password@123";

async function main() {
    const school = await prisma.school.upsert({
        where: { id: "seed-demo-school" },
        update: {},
        create: {
            id: "seed-demo-school",
            name: "DriveMaster Demo School",
            phone: PHONE,
            address: "Lagos, Nigeria",
        },
    });

    const passwordHash = hashPassword(PASSWORD);

    const user = await prisma.user.upsert({
        where: { phone: PHONE },
        update: {
            schoolId: school.id,
            name: "Demo Owner",
            email: "owner@drivemaster.test",
            passwordHash,
            role: "OWNER",
            isActive: true,
        },
        create: {
            schoolId: school.id,
            name: "Demo Owner",
            email: "owner@drivemaster.test",
            phone: PHONE,
            passwordHash,
            role: "OWNER",
            isActive: true,
        },
    });

    console.log(
        `Seeded login account: phone=${user.phone}, password=${PASSWORD}, role=${user.role}, school=${school.name}`
    );
}

main()
    .catch((error) => {
        console.error("Seed failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
