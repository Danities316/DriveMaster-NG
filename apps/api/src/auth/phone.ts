export function normalizeNigerianPhone(value: string): string | null {
  const compact = value.trim().replace(/[\s()-]/g, "");
  const international = /^0\d{10}$/.test(compact) ? `+234${compact.slice(1)}` : compact;
  return /^\+234\d{10}$/.test(international) ? international : null;
}
