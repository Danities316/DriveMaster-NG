import type {
  MutationAction,
  MutationEntityType,
  Payment,
  Student,
  Vehicle,
  FuelLog,
  MileageLog
} from "./domain.js";

export interface SyncMutation {
  mutationId: string;
  deviceId: string;
  schoolId: string;
  entity: MutationEntityType;
  action: MutationAction;
  payload: unknown;
  expectedVersion?: number;
}
export interface SyncResult {
  mutationId: string;
  vehicle?: Vehicle;
  fuelLog?: FuelLog;
  mileageLog?: MileageLog;
  student?: Student;
  payment?: Payment;
}
export interface SyncConflict {
  mutationId: string;
  message: string;
  serverStudent?: Student;
}
export interface SyncBatchResponse {
  success: boolean;
  processedIds: string[];
  duplicateIds: string[];
  results: SyncResult[];
  conflicts: SyncConflict[];
  failures: { mutationId: string; message: string }[];
}
export type SyncChange =
  | { cursor: string; entity: "student"; action: MutationAction; record: Student }
  | { cursor: string; entity: "payment"; action: MutationAction; record: Payment }
  | { cursor: string; entity: "vehicle"; action: MutationAction; record: Vehicle }
  | { cursor: string; entity: "fuel_log"; action: MutationAction; record: FuelLog }
  | { cursor: string; entity: "mileage_log"; action: MutationAction; record: MileageLog };
export interface SyncPullResponse {
  changes: SyncChange[];
  nextCursor: string;
  hasMore: boolean;
}
