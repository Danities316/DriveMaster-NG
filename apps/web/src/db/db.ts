import Dexie, { type Table } from "dexie";
import type {
  Payment,
  Vehicle,
  FuelLog,
  MileageLog,
  SessionBooking,
  OutboxMutationRecord,
  SyncState,
  StudentWithBalance
} from "@drivemaster/shared";
import type { Student } from "@drivemaster/shared";

/**
 * DriveMaster NG local (offline-first) database.
 *
 * PRD §11 (Offline-First Architecture): "Dexie/IndexedDB is the local
 * source of truth for immediate operations." This class only establishes
 * the schema — no read/write business logic, no synchronization engine.
 * Those belong to later units (student ledger, outbox/sync manager, etc.).
 *
 * SCHEMA VERSIONING:
 * This is version 1, the initial schema. Any future structural change
 * must add a new `.version(n)` block with an `.upgrade()` migration
 * rather than mutating this one, per Dexie's versioning model — existing
 * installed PWAs must be able to upgrade in place without data loss.
 */
export class DriveMasterDB extends Dexie {
  /**
   * Typed as StudentWithBalance (Unit 3), not the plain Student contract
   * this table started with in Unit 1 — a small, additive widening (same
   * store name, same `id, schoolId` indexes, no real IndexedDB schema
   * change) so the offline-visible balance/amountPaid fields survive a
   * local cache read without a network round-trip. See the Unit 3 report.
   */
  trainingCache!: Table<
    {
      userId: string;
      schoolId: string;
      snapshot: import("@drivemaster/shared").TrainingSnapshot;
      loadedAt: string;
    },
    string
  >;
  trainingQueue!: Table<import("../features/training/trainingLocal").QueuedTraining, string>;
  students!: Table<StudentWithBalance, string>;
  payments!: Table<Payment, string>;
  vehicles!: Table<Vehicle, string>;
  fuelLogs!: Table<FuelLog, string>;
  mileageLogs!: Table<MileageLog, string>;
  sessionBookings!: Table<SessionBooking, string>;
  outbox!: Table<OutboxMutationRecord, string>;
  syncState!: Table<SyncState, string>;
  serverStudents!: Table<Student, string>;
  serverPayments!: Table<Payment, string>;
  syncLease!: Table<{ key: string; owner: string; expiresAt: number }, string>;

  constructor(name = "drivemaster-ng") {
    super(name);

    this.version(1).stores({
      // Primary key first, then indexed fields. `schoolId` is indexed on
      // every tenant-owned table for consistency with the server schema
      // and to make a future "clear this school's local data" query
      // (PRD §26.11, school-switching) a single indexed lookup rather
      // than a full table scan.
      students: "id, schoolId",
      payments: "id, schoolId, studentId",
      vehicles: "id, schoolId",
      fuelLogs: "id, schoolId, vehicleId",
      sessionBookings: "id, schoolId, vehicleId, instructorId, studentId, startTime",

      // Outbox is keyed by the client-generated mutationId (PRD §26.7)
      // rather than an autoincrement id — that key IS the idempotency
      // token that will eventually be sent to the server. `status` and
      // `createdAt` are indexed so a future sync manager can efficiently
      // query "all PENDING mutations, oldest first".
      outbox: "mutationId, status, entity, createdAt",

      // Single-row table: one entry per device, keyed by deviceId.
      syncState: "deviceId"
    });
    this.version(4).stores({
      trainingCache: "userId, schoolId",
      trainingQueue: "id, userId, schoolId, createdAt"
    });
    this.version(3).stores({ mileageLogs: "id, schoolId, vehicleId, date" });
    this.version(2)
      .stores({
        serverStudents: "id, schoolId",
        serverPayments: "id, schoolId, studentId",
        syncLease: "key",
        outbox: "mutationId, status, entity, createdAt, sequence, schoolId"
      })
      .upgrade(async (tx) => {
        const entries = (await tx
          .table("outbox")
          .orderBy("createdAt")
          .toArray()) as OutboxMutationRecord[];
        const previous = new Map<string, string>();
        let sequence = 0;
        for (const entry of entries) {
          const payload = entry.payload as { id?: string; studentId?: string } | null;
          const id = entry.entity === "student" ? payload?.id : payload?.studentId;
          const student = id
            ? ((await tx.table("students").get(id)) as Student | undefined)
            : undefined;
          entry.schoolId = student?.schoolId;
          entry.sequence = ++sequence;
          entry.dependsOn = id ? previous.get(id) : undefined;
          if (id && entry.entity === "student") previous.set(id, entry.mutationId);
          if (entry.status === "SYNCING") entry.status = "PENDING";
          if (!entry.schoolId) {
            entry.status = "FAILED";
            entry.lastError =
              "This saved change has no identifiable school. Contact your administrator to recover it.";
          }
          await tx.table("outbox").put(entry);
        }
      });
  }
}

/**
 * Shared singleton instance for the running app. A single Dexie instance
 * per browser tab is the standard pattern — Dexie itself manages the
 * underlying IndexedDB connection lifecycle.
 */
export const db = new DriveMasterDB();
