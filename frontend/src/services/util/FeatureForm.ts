export type DrawnGeometry =
    | { type: "Point"; coordinates: number[] }
    | { type: "LineString"; coordinates: number[][] }
    | { type: "Polygon"; coordinates: number[][][] };

export interface AttributeField {
    name: string;
    description?: string;
    type: "string" | "number" | "integer";
    format?: string;
    options?: string[];
    defaultValue?: unknown;
    required: boolean;
}

export function getDraftTitle(locationName: unknown, id: string, geometryType: string): string {
    if (typeof locationName === "string" && locationName.trim()) return locationName.trim();
    return `${id.startsWith("existing-") ? "Location" : "New location"} (${geometryType})`;
}
