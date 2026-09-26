import { describe, expect, it } from "vitest";

import * as audit from "./audit";
import { IntegrationUnavailableError } from "./errors";
import * as window from "./window";

describe("integration adapters (teammate modules not present yet)", () => {
  it("window adapter reports it is unavailable", async () => {
    const call = window.openApprovalWindow({
      patientId: "11000000-0000-0000-0000-000000000001",
      submissionId: "13000000-0000-0000-0000-000000000001",
      approvedAt: "2026-09-26T15:00:00.000Z",
    });
    await expect(call).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(call).rejects.toMatchObject({ integration: "window" });
  });

  it("audit adapter reports it is unavailable", async () => {
    const call = audit.append({ actor: "clinician:x", action: "review.approved", refId: null, payload: {} });
    await expect(call).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(call).rejects.toMatchObject({ integration: "audit" });
  });
});
