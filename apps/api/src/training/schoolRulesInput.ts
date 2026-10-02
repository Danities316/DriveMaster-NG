import { z } from "zod";

export const schoolRulesInput = z.object({
  vehicleExpiryAction: z.enum(["WARN", "BLOCK"]).default("WARN"),
  vehicleReminderDays: z.number().int().min(0).max(365).default(30),
  schoolTargetDays: z.number().int().min(1, "Choose at least 1 training day.").max(1000),
  requireInstructorNin: z.boolean(),
  requireInstructorLicence: z.boolean(),
  permitExpiryAction: z.enum(["WARN", "BLOCK"]),
  permitReminderDays: z.number().int().min(0).max(365),
  reason: z.string().trim().min(1, "Tell us why you are changing the rules.").max(500)
});
