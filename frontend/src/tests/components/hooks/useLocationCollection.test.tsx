/** @jest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import Validator from "../../../services/util/Validator.ts";
import { useLocationCollection } from "../../../components/hooks/useLocationCollection.ts";

describe("useLocationCollection", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("validates drawn locations and exposes a complete GeoJSON collection", async () => {
        const schema = {
            properties: {
                scheme_version: { type: "string", enum: ["4.0"] },
                donor_project_no: { type: "integer" },
                latitude: { type: "number", description: "Optional coordinates from spreadsheet uploads." },
                longitude: { type: "number", description: "Optional coordinates from spreadsheet uploads." },
            },
            required: ["scheme_version", "donor_project_no"],
        };
        jest.spyOn(Validator, "getCoreSchema").mockResolvedValue(schema as any);

        const { result } = renderHook(() => useLocationCollection("en"));
        await waitFor(() => expect(result.current.selectedFields).toHaveLength(4));

        act(() => {
            result.current.start();
            result.current.addGeometry("drawn-1", { type: "Point", coordinates: [10, 20] });
        });
        expect(result.current.isComplete).toBe(false);

        act(() => result.current.changeValue("drawn-1", "donor_project_no", 123456789));

        expect(result.current.isComplete).toBe(true);
        expect(result.current.selectedFields.find(field => field.name === "latitude")?.required).toBe(false);
        expect(result.current.collection).toEqual({
            type: "FeatureCollection",
            features: [{
                type: "Feature",
                geometry: { type: "Point", coordinates: [10, 20] },
                properties: { scheme_version: "4.0", donor_project_no: 123456789 },
            }],
        });
    });
});
