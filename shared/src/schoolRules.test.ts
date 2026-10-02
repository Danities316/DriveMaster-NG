import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHOOL_RULES,
  RECORDED_DSSP_MINIMUM_DAYS,
  instructorDocumentIssues,
  lagosDay,
  validInstructorLicence,
  validInstructorNin,
  validPermitDate
} from "./schoolRules.js";

describe("school document rules", () => {
  it("validates identifiers without losing leading zeroes", () => {
    expect(validInstructorNin("01234567890")).toBe(true);
    for (const value of [
      "1234567890",
      "123456789012",
      "1234567890A",
      " 1234567890",
      "１２３４５６７８９０１"
    ])
      expect(validInstructorNin(value)).toBe(false);
    expect(validInstructorLicence("YEN12801AA01")).toBe(true);
    expect(validInstructorLicence("YEN12801AA1")).toBe(false);
  });
  it("does not silently block existing instructors under default rules", () => {
    const issues = instructorDocumentIssues(
      { nin: null, drivers_license_number: null, permitExpiryDate: null },
      DEFAULT_SCHOOL_RULES,
      "2026-09-28"
    );
    expect(issues).toHaveLength(1);
    expect(issues.every((issue) => !issue.blocked)).toBe(true);
  });
  it("enforces required documents and missing or expired permits only when configured", () => {
    const rules = {
      ...DEFAULT_SCHOOL_RULES,
      requireInstructorNin: true,
      requireInstructorLicence: true,
      permitExpiryAction: "BLOCK" as const
    };
    expect(
      instructorDocumentIssues(
        { nin: null, drivers_license_number: null, permitExpiryDate: null },
        rules,
        "2026-09-28"
      ).filter((i) => i.blocked)
    ).toHaveLength(3);
    const doc = {
      nin: "01234567890",
      drivers_license_number: "YEN12801AA01",
      permitExpiryDate: "2026-09-28"
    };
    expect(instructorDocumentIssues(doc, rules, "2026-09-28")[0]?.blocked).toBe(false);
    expect(instructorDocumentIssues(doc, rules, "2026-09-29")[0]?.blocked).toBe(true);
  });
  it("checks real calendar dates and Nigerian day boundaries", () => {
    expect(validPermitDate("2026-02-30")).toBe(false);
    expect(validPermitDate("2028-02-29")).toBe(true);
    expect(lagosDay("2026-09-28T23:30:00Z")).toBe("2026-09-29");
    expect(RECORDED_DSSP_MINIMUM_DAYS).toBe(26);
  });
});
