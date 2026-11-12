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
