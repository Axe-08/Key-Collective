import { describe, expect, it, vi } from "vitest";
import {
  type CommonsRule,
  commonsEnforcement,
  hashTenantId,
  recordWouldDeny,
} from "../../../src/pool/enforcement";

describe("Commons Enforcement Switch & Would-Deny Tracking (WP-5.1 T-5.1.1)", () => {
  describe("commonsEnforcement", () => {
    const rules: CommonsRule[] = ["brake", "eye_for_eye", "share_cap", "jail"];

    it("returns observe for every rule when COMMONS_ENFORCEMENT is unset", () => {
      for (const rule of rules) {
        expect(commonsEnforcement(rule, {})).toBe("observe");
        expect(commonsEnforcement(rule, undefined)).toBe("observe");
      }
    });

    it("returns observe for every rule when COMMONS_ENFORCEMENT is explicitly observe", () => {
      for (const rule of rules) {
        expect(commonsEnforcement(rule, { COMMONS_ENFORCEMENT: "observe" })).toBe("observe");
      }
    });

    it("enforces only specified rules when COMMONS_ENFORCE_RULES is set", () => {
      const env = {
        COMMONS_ENFORCEMENT: "enforce",
        COMMONS_ENFORCE_RULES: "brake,jail",
      };

      expect(commonsEnforcement("brake", env)).toBe("enforce");
      expect(commonsEnforcement("jail", env)).toBe("enforce");
      expect(commonsEnforcement("eye_for_eye", env)).toBe("observe");
      expect(commonsEnforcement("share_cap", env)).toBe("observe");
    });

    it("enforces only brake when COMMONS_ENFORCE_RULES is brake", () => {
      const env = {
        COMMONS_ENFORCEMENT: "enforce",
        COMMONS_ENFORCE_RULES: "brake",
      };

      expect(commonsEnforcement("brake", env)).toBe("enforce");
      expect(commonsEnforcement("eye_for_eye", env)).toBe("observe");
      expect(commonsEnforcement("share_cap", env)).toBe("observe");
      expect(commonsEnforcement("jail", env)).toBe("observe");
    });

    it("enforces all rules when COMMONS_ENFORCEMENT is enforce without COMMONS_ENFORCE_RULES", () => {
      const env = { COMMONS_ENFORCEMENT: "enforce" };

      for (const rule of rules) {
        expect(commonsEnforcement(rule, env)).toBe("enforce");
      }
    });
  });

  describe("recordWouldDeny", () => {
    it("hashes raw tenant id and writes exactly one data point without the raw tenant id", async () => {
      const writeDataPointMock = vi.fn();
      const mockAe = { writeDataPoint: writeDataPointMock };
      const rawTenant = "usr_goog_test_tenant_secret_id_999";

      await recordWouldDeny("brake", rawTenant, "exceeded 35% pool cu", mockAe);

      expect(writeDataPointMock).toHaveBeenCalledTimes(1);

      const point = writeDataPointMock.mock.calls[0][0] as {
        blobs: string[];
        doubles: number[];
        indexes: string[];
      };

      // Blobs must contain dataset/type name, rule, tenantHash, and detail
      expect(point.blobs[0]).toBe("commons_would_deny");
      expect(point.blobs[1]).toBe("brake");
      expect(point.blobs[3]).toBe("exceeded 35% pool cu");

      // Crucial privacy invariant: raw tenant ID must never appear in telemetry
      const pointStr = JSON.stringify(point);
      expect(pointStr).not.toContain(rawTenant);

      // Verify the tenant hash matches sha256
      const expectedHash = await hashTenantId(rawTenant);
      expect(point.blobs[2]).toBe(expectedHash);
      expect(point.indexes).toContain(expectedHash);
    });
  });
});
