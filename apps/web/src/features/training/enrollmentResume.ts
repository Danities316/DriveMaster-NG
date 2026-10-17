import { registrationId } from "./registrationId";
export interface EnrollmentResume {
  id: string;
  token: string;
  paymentId: string;
}
const key = (schoolId: string) => `drivemaster:enrollmentResume:${schoolId}`;
export function readEnrollmentResume(schoolId: string): EnrollmentResume | null {
  try {
    const raw = localStorage.getItem(key(schoolId));
    if (!raw) return null;
    const value = JSON.parse(raw) as EnrollmentResume;
    if (
      !value ||
      !/^[a-f0-9]{64}$/.test(value.token) ||
      !/^[a-f0-9-]{36}$/.test(value.id) ||
      !/^[a-f0-9-]{36}$/.test(value.paymentId)
    )
      throw new Error();
    return { id: value.id, token: value.token, paymentId: value.paymentId };
  } catch {
    throw new Error(
      "Saved registration access cannot be read. Contact the school before registering again."
    );
  }
}
export function newEnrollmentResume(): EnrollmentResume {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return { id: registrationId(), token, paymentId: registrationId() };
}
export function saveEnrollmentResume(schoolId: string, value: EnrollmentResume) {
  try {
    localStorage.setItem(key(schoolId), JSON.stringify(value));
  } catch {
    throw new Error(
      "This browser cannot save registration access. Enable browser storage or contact the school before submitting."
    );
  }
}
export function clearEnrollmentResume(schoolId: string) {
  localStorage.removeItem(key(schoolId));
}
