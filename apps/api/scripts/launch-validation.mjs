// Local synthetic-data validation only. Build the API before running.
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../dist/app.js";
import { createSessionToken } from "../dist/auth/token.js";
const url = process.env.LAUNCH_TEST_DATABASE_URL;
if (!url) throw new Error("Set LAUNCH_TEST_DATABASE_URL to the isolated local test database.");
const target = new URL(url);
if (
  target.hostname !== "127.0.0.1" ||
  target.port !== "55438" ||
  !["/sync_test", "/sync_restore_test"].includes(target.pathname)
)
  throw new Error("Only isolated local launch-test databases on port 55438 are allowed.");
const client = new PrismaClient({ datasources: { db: { url } } });
globalThis.__drivemasterPrisma = client;
const secret = randomUUID() + randomUUID();
const app = createApp({
  webOrigin: "http://localhost",
  authSecret: secret,
  sessionMaxAgeSeconds: 3600,
  secureCookies: false
});
const pack = { name: "Synthetic package", sessions: 26, minutes: 30, price: "26000.00" };
const batch = async (model, data) => {
  for (let i = 0; i < data.length; i += 500)
    await model.createMany({ data: data.slice(i, i + 500) });
};
async function benchmark(count) {
  const schoolId = randomUUID(),
    ownerId = randomUUID(),
    instructorId = randomUUID(),
    vehicleId = randomUUID(),
    packageId = randomUUID();
  await client.school.create({
    data: { id: schoolId, name: "SYNTHETIC LAUNCH TEST", phone: "test", address: "test" }
  });
  const owner = await client.user.create({
    data: {
      id: ownerId,
      schoolId,
      name: "Synthetic owner",
      phone: randomUUID(),
      role: "OWNER",
      passwordHash: "not-a-real-password",
      phoneVerifiedAt: new Date()
    }
  });
  await client.user.create({
    data: {
      id: instructorId,
      schoolId,
      name: "Synthetic instructor",
      phone: randomUUID(),
      role: "INSTRUCTOR",
      passwordHash: "not-a-real-password"
    }
  });
  await client.vehicle.create({
    data: { id: vehicleId, schoolId, plateNumber: randomUUID(), model: "Test", status: "ACTIVE" }
  });
  const students = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    schoolId,
    name: `Synthetic student ${i}`,
    phone: "00000000000",
    totalTuition: "26000.00",
    enrollmentDate: new Date("2026-01-01")
  }));
  await batch(client.student, students);
  const enrollments = students.map((s) => ({
    id: randomUUID(),
    schoolId,
    kind: "enrollment",
    data: { ...pack, studentId: s.id, packageId, activationStatus: "ACTIVE" }
  }));
  await batch(client.trainingRecord, [
    { id: packageId, schoolId, kind: "package", data: pack },
    ...enrollments
  ]);
  const outings = [],
    payments = [];
  students.forEach((s, i) => {
    for (let day = 1; day <= 5; day++) {
      const start = `2026-01-0${day}T09:00:00.000Z`,
        end = `2026-01-0${day}T09:30:00.000Z`;
      outings.push({
        id: randomUUID(),
        schoolId,
        kind: "outing",
        data: {
          instructorId,
          vehicleId,
          plannedStart: start,
          plannedEnd: end,
          startedAt: start,
          endedAt: end,
          status: "COMPLETED",
          members: [
            { studentId: s.id, enrollmentId: enrollments[i].id, status: "CONFIRMED", minutes: 30 }
          ],
          fuelPerStudent: "0.00",
          allowanceReason: "Synthetic history",
          fuelIssued: "0.00",
          fuelSpent: "0.00",
          fuelReturned: "0.00"
        }
      });
      payments.push({
        id: randomUUID(),
        schoolId,
        studentId: s.id,
        amount: "1000.00",
        paymentDate: new Date(start),
        method: "CASH"
      });
    }
  });
  await batch(client.trainingRecord, outings);
  await batch(client.payment, payments);
  const headers = {
    Cookie:
      "dm_session=" +
      createSessionToken(
        { sub: ownerId, schoolId, role: "OWNER", name: owner.name, phone: owner.phone },
        secret,
        3600
      ),
    "X-Training-User": ownerId,
    "X-Training-School": schoolId
  };
  let bytes = 0;
  async function sample() {
    const start = performance.now();
    const response = await request(app).get("/api/training/snapshot").set(headers).expect(200);
    assert.equal(response.body.students.length, count);
    assert.equal(response.body.outings.length, count * 5);
    assert.equal(response.body.summaries[0].paid, "5000.00");
    bytes = Buffer.byteLength(response.text);
    return Math.round(performance.now() - start);
  }
  await sample(); // warm up
  const sequential = [];
  for (let i = 0; i < 5; i++) sequential.push(await sample());
  const concurrent = await Promise.all(Array.from({ length: 3 }, sample));
  const ordered = [...sequential].sort((a, b) => a - b);
  return {
    students: count,
    outings: outings.length,
    payments: payments.length,
    responseBytes: bytes,
    sequentialMs: sequential,
    medianMs: ordered[2],
    concurrent3Ms: concurrent,
    concurrentMaxMs: Math.max(...concurrent)
  };
}
async function fingerprint() {
  const tables =
    await client.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const result = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const rows = await client.$queryRawUnsafe(
      `SELECT row_to_json(t)::text AS row FROM public."${tablename}" t ORDER BY row_to_json(t)::text`
    );
    result[tablename] = {
      rows: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex")
    };
  }
  const sequences =
    await client.$queryRaw`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`;
  result.sequences = {};
  for (const { sequencename } of sequences) {
    assert.match(sequencename, /^[A-Za-z_]+$/);
    const values = await client.$queryRawUnsafe(
      `SELECT last_value::text, is_called FROM public."${sequencename}"`
    );
    result.sequences[sequencename] = values;
  }
  return result;
}
try {
  await request(app).get("/api/ready").expect(200);
  const mode = process.argv[2];
  if (mode === "benchmark") {
    const results = [];
    for (const size of [100, 500, 1000]) {
      console.error(`Measuring ${size} students / ${size * 5} historical outings...`);
      results.push(await benchmark(size));
    }
    console.log(
      JSON.stringify(
        { kind: "local-synthetic-baseline", measuredAt: new Date().toISOString(), results },
        null,
        2
      )
    );
  } else if (mode === "fingerprint") console.log(JSON.stringify(await fingerprint(), null, 2));
  else if (mode === "verify-restore") {
    const payment = await client.payment.findFirstOrThrow();
    await assert.rejects(
      client.payment.update({ where: { id: payment.id }, data: { amount: "999999.00" } }),
      /Payments are immutable/
    );
    console.log("Restored database readiness and append-only payment trigger passed.");
  } else throw new Error("Use benchmark, fingerprint, or verify-restore.");
} finally {
  await client.$disconnect();
  globalThis.__drivemasterPrisma = undefined;
}
