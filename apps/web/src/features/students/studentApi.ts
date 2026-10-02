import type {
  CreateStudentRequest,
  UpdateStudentRequest,
  StudentListQuery,
  StudentListResponse,
  StudentResponse,
  StudentWithBalance,
  Payment,
  PaymentMethod,
  CurrencyCode
} from "@drivemaster/shared";

const API_BASE_URL: string = import.meta.env["VITE_API_BASE_URL"] ?? "/api";

/**
 * The server explicitly rejected the request (validation, auth, not
 * found, etc.) — retrying with the same data will not help. Distinct
 * from a network failure, which the caller should treat as "try again
 * later while offline" rather than a hard error.
 */
export class StudentApiError extends Error {
  get retryable(): boolean {
    return this.status >= 500 || [401, 408, 429].includes(this.status);
  }
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "error" in data) {
      const err = (data as { error?: { message?: unknown } }).error;
      if (err && typeof err.message === "string") {
        return err.message;
      }
    }
  } catch {
    // fall through
  }
  return "Something went wrong. Please try again.";
}

export async function fetchStudents(query: StudentListQuery = {}): Promise<StudentListResponse> {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));

  const response = await fetch(`${API_BASE_URL}/students?${params.toString()}`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new StudentApiError(await parseErrorMessage(response), response.status);
  }
  return (await response.json()) as StudentListResponse;
}

export async function fetchStudent(id: string): Promise<StudentWithBalance> {
  const response = await fetch(`${API_BASE_URL}/students/${id}`, { credentials: "include" });
  if (!response.ok) {
    throw new StudentApiError(await parseErrorMessage(response), response.status);
  }
  const data = (await response.json()) as StudentResponse;
  return data.student;
}

export async function createStudentOnServer(
  input: CreateStudentRequest
): Promise<StudentWithBalance> {
  const response = await fetch(`${API_BASE_URL}/students`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new StudentApiError(await parseErrorMessage(response), response.status);
  }
  const data = (await response.json()) as StudentResponse;
  return data.student;
}

export async function updateStudentOnServer(
  id: string,
  patch: UpdateStudentRequest
): Promise<StudentWithBalance> {
  const response = await fetch(`${API_BASE_URL}/students/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) {
    throw new StudentApiError(await parseErrorMessage(response), response.status);
  }
  const data = (await response.json()) as StudentResponse;
  return data.student;
}

export interface CreatePaymentRequest {
  id: string;
  amount: string;
  paymentDate: string;
  method: PaymentMethod;
  currency?: CurrencyCode;
  reference?: string | null;
}

export interface RecordPaymentResponse {
  payment: Payment;
  totalPaid: string;
  outstandingBalance: string;
}

export interface StudentPaymentHistoryResponse {
  payments: Payment[];
  totalPaid: string;
  outstandingBalance: string;
}

export async function fetchStudentPayments(
  studentId: string
): Promise<StudentPaymentHistoryResponse> {
  const response = await fetch(`${API_BASE_URL}/students/${studentId}/payments`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new StudentApiError(await parseErrorMessage(response), response.status);
  }

  return (await response.json()) as StudentPaymentHistoryResponse;
}

export async function recordStudentPayment(
  studentId: string,
  input: CreatePaymentRequest
): Promise<RecordPaymentResponse> {
  const response = await fetch(`${API_BASE_URL}/students/${studentId}/payments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new StudentApiError(await parseErrorMessage(response), response.status);
  }

  return (await response.json()) as RecordPaymentResponse;
}

/** True for a plain network/connectivity failure (fetch itself threw), false for a server-returned rejection. */
export function isNetworkFailure(error: unknown): boolean {
  return !(error instanceof StudentApiError);
}
