/** Accept date-only enrollment values or ISO timestamps with an explicit timezone. */
export function isValidDate(value: string): boolean {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsedDay = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== day)
    return false;
  return (
    value === day ||
    (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)))
  );
}
