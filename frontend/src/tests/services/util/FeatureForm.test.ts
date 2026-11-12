import { describe, expect, it } from "@jest/globals";
import { getDraftTitle } from "../../../services/util/FeatureForm.ts";

describe("getDraftTitle", () => {
    it("trims a string location name", () => {
        expect(getDraftTitle("  Riverside  ", "existing-1", "Point")).toBe("Riverside");
    });

    it("uses the fallback for blank or non-string location names", () => {
        expect(getDraftTitle("   ", "existing-1", "Point")).toBe("Location (Point)");
        expect(getDraftTitle(42, "drawn-1", "Polygon")).toBe("New location (Polygon)");
    });
});
