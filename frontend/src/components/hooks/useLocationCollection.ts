import { useEffect, useMemo, useState } from "react";
import type { ValidateFunction } from "ajv";
import Validator from "../../services/util/Validator.ts";
import type { SupportedLangs } from "../../services/util/Utils.ts";
import type { AttributeField, DrawnGeometry } from "../../services/util/FeatureForm.ts";

interface LocationDraft {
    id: string;
    geometry: DrawnGeometry;
    values: Record<string, unknown>;
    touched: Record<string, boolean>;
}

interface DraftGeometry {
    id: string;
    geometry: DrawnGeometry;
}

function getFieldErrorMap(valid: ValidateFunction<unknown>, value: Record<string, unknown>): Record<string, string> {
    if (valid({ ...value })) return {};
    const errors: Record<string, string> = {};
    for (const error of valid.errors ?? []) {
        const field = error.keyword === "required"
            ? (error.params as { missingProperty?: string }).missingProperty
            : error.instancePath?.split("/").filter(Boolean).pop();
        if (field && !errors[field]) errors[field] = error.message ?? "Invalid value";
    }
    return errors;
}

export function useLocationCollection(lang: SupportedLangs) {
    const [fields, setFields] = useState<AttributeField[]>([]);
    const [validate, setValidate] = useState<ValidateFunction<unknown> | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [active, setActive] = useState(false);
    const [drafts, setDrafts] = useState<LocationDraft[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [sessionKey, setSessionKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setFields([]);
        setValidate(null);
        setLoadError(null);
        Validator.getCoreSchema(lang).then(schema => {
            if (cancelled) return;
            const properties = schema.properties ?? {};
            const schemaFields = Object.entries(properties).map(([name, definition]) => {
                const property = definition as {
                    description?: string;
                    type?: string;
                    format?: string;
                    enum?: unknown[];
                    default?: unknown;
                };
                const defaultValue = property.default ??
                    (property.enum?.length === 1 ? property.enum[0] : undefined);
                return {
                    name,
                    description: property.description,
                    type: property.type === "integer" || property.type === "number" ? property.type : "string",
                    format: property.format,
                    options: property.enum?.map(String),
                    defaultValue,
                    required: schema.required?.includes(name) ?? false,
                } satisfies AttributeField;
            });
            setFields(schemaFields);
            setValidate(() => Validator.createCoreValidatorWithRequired(
                schema,
                schemaFields.filter(field => field.required).map(field => field.name)
            ));
        }).catch(error => {
            if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
        });
        return () => { cancelled = true; };
    }, [lang]);

    const errorsById = useMemo(() => {
        const errors: Record<string, Record<string, string>> = {};
        if (validate) {
            drafts.forEach(draft => { errors[draft.id] = getFieldErrorMap(validate, draft.values); });
        }
        return errors;
    }, [drafts, validate]);

    const selected = drafts.find(draft => draft.id === selectedId) ?? null;
    const isComplete = drafts.length > 0 && !!validate &&
        drafts.every(draft => Object.keys(errorsById[draft.id] ?? {}).length === 0);
    const collection = useMemo(() => {
        if (!isComplete) return null;
        return {
            type: "FeatureCollection" as const,
            features: drafts.map(draft => ({
                type: "Feature" as const,
                geometry: draft.geometry,
                properties: draft.values,
            })),
        };
    }, [drafts, isComplete]);
    const projectNumbers = useMemo(() => drafts
        .map(draft => draft.values.donor_project_no)
        .filter(value => value !== undefined && value !== null && value !== "")
        .map(String), [drafts]);

    const start = (features: Array<{ properties?: Record<string, unknown>; geometry?: DrawnGeometry | null }> = []) => {
        const defaults = Object.fromEntries(fields
            .filter(field => field.defaultValue !== undefined)
            .map(field => [field.name, field.defaultValue]));
        const existing: LocationDraft[] = features.flatMap((feature, index) =>
            feature.geometry ? [{
                id: `existing-${index + 1}`,
                geometry: feature.geometry,
                values: { ...defaults, ...feature.properties },
                touched: {},
            }] : []
        );
        setDrafts(existing);
        setSelectedId(null);
        setActive(true);
        setSessionKey(key => key + 1);
    };

    const stop = () => {
        setActive(false);
        setDrafts([]);
        setSelectedId(null);
        setSessionKey(key => key + 1);
    };

    const addGeometry = (id: string, geometry: DrawnGeometry) => {
        const defaults = Object.fromEntries(fields
            .filter(field => field.defaultValue !== undefined)
            .map(field => [field.name, field.defaultValue]));
        setDrafts(current => [...current, { id, geometry, values: defaults, touched: {} }]);
        setSelectedId(id);
    };
    const updateGeometry = (id: string, geometry: DrawnGeometry) => {
        setDrafts(current => current.map(draft => draft.id === id ? { ...draft, geometry } : draft));
    };
    const removeGeometry = (id: string) => {
        setDrafts(current => current.filter(draft => draft.id !== id));
        setSelectedId(current => current === id ? null : current);
    };
    const changeValue = (id: string, name: string, value: unknown) => {
        setDrafts(current => current.map(draft =>
            draft.id === id ? { ...draft, values: { ...draft.values, [name]: value } } : draft
        ));
    };
    const touchField = (id: string, name: string) => {
        setDrafts(current => current.map(draft =>
            draft.id === id ? { ...draft, touched: { ...draft.touched, [name]: true } } : draft
        ));
    };

    return {
        active,
        ready: active && !!validate,
        drafts: drafts.map(({ id, geometry }) => ({ id, geometry } as DraftGeometry)),
        selected,
        selectedFields: fields,
        errorsById,
        isComplete,
        collection,
        projectNumbers,
        loadError,
        sessionKey,
        start,
        stop,
        addGeometry,
        updateGeometry,
        removeGeometry,
        select: setSelectedId,
        changeValue,
        touchField,
    };
}
