export interface SmsConfig {
  provider: "kudis" | "mock" | "disabled";
  apiKey?: string;
  senderId?: string;
  mockCode: string;
}
export function smsConfig(source: NodeJS.ProcessEnv = process.env): SmsConfig {
  const provider = source["SMS_PROVIDER"] ?? "disabled";
  if (!["kudis", "mock", "disabled"].includes(provider)) throw new Error("Invalid SMS_PROVIDER.");
  if (source["NODE_ENV"] === "production" && provider !== "kudis")
    throw new Error("Production requires SMS_PROVIDER=kudis.");
  if (provider === "kudis" && (!source["KUDISMS_API_KEY"] || !source["KUDISMS_SENDER_ID"]))
    throw new Error("KudiSMS requires an API key and approved corporate sender ID.");
  const mockCode = source["SMS_MOCK_CODE"] ?? "123456";
  if (!/^\d{6}$/.test(mockCode)) throw new Error("SMS_MOCK_CODE must contain six digits.");
  return {
    provider: provider as SmsConfig["provider"],
    apiKey: source["KUDISMS_API_KEY"],
    senderId: source["KUDISMS_SENDER_ID"],
    mockCode
  };
}
export async function sendOwnerCode(phone: string, code: string): Promise<boolean> {
  return sendSms(
    phone,
    `Your DriveMaster phone verification code is ${code}. Expires in 10 minutes. Do not share it.`
  );
}
export async function sendPasswordResetCode(phone: string, code: string): Promise<boolean> {
  return sendSms(
    phone,
    `Your DriveMaster password reset code is ${code}. Expires in 10 minutes. Do not share it.`
  );
}
async function sendSms(phone: string, message: string): Promise<boolean> {
  const config = smsConfig();
  if (config.provider === "mock") return true;
  if (config.provider !== "kudis") return false;
  try {
    const response = await fetch("https://my.kudisms.net/api/corporate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        token: config.apiKey,
        senderID: config.senderId,
        recipients: phone.replace(/^\+/, ""),
        message
      }),
      signal: AbortSignal.timeout(10000)
    });
    const data = (await response.json()) as { status?: string; error_code?: string };
    return response.ok && data.status === "success" && data.error_code === "000";
  } catch {
    return false;
  }
}
