const DEVICE_ID_STORAGE_KEY = "drivemaster:deviceId";

/**
 * Every OutboxMutationRecord requires a `deviceId` (PRD §26.10, locked in
 * Unit 1's shared contract). No dedicated "Device Identity" feature has
 * been built yet (server registration, diagnostics, etc. — PRD lists
 * that as later scope), so this is the smallest thing that satisfies the
 * existing required field: a random id generated once per browser and
 * persisted in localStorage. Not sensitive — never sent as a credential,
 * only used to label which device a queued mutation came from.
 */
export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const deviceId = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}
