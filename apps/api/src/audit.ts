import type { Prisma } from "@prisma/client";

export interface AuditMetadata {
  entityIds?: string[];
  changedFields?: string[];
}

export interface AuditEntry {
  schoolId: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: AuditMetadata;
}

export async function writeAuditLog(tx: Prisma.TransactionClient, entry: AuditEntry) {
  const metadata: Prisma.InputJsonObject = {
    ...(entry.metadata?.entityIds ? { entityIds: [...new Set(entry.metadata.entityIds)] } : {}),
    ...(entry.metadata?.changedFields
      ? { changedFields: [...new Set(entry.metadata.changedFields)] }
      : {})
  };
  await tx.auditLog.create({
    data: {
      schoolId: entry.schoolId,
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      ...(Object.keys(metadata).length ? { metadata } : {})
    }
  });
}
