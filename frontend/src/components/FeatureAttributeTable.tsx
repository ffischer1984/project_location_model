import React from "react";
import type { AttributeField } from "../services/util/FeatureForm.ts";

interface FeatureAttributeTableProps {
    fields: AttributeField[];
    values: Record<string, unknown>;
    errors: Record<string, string>;
    touched: Record<string, boolean>;
    onChange: (name: string, value: unknown) => void;
    onBlur: (name: string) => void;
}

const FeatureAttributeTable: React.FC<FeatureAttributeTableProps> = ({
    fields,
    values,
    errors,
    touched,
    onChange,
    onBlur,
}) => {
    const completeCount = fields.filter(field =>
        values[field.name] !== undefined &&
        values[field.name] !== null &&
        values[field.name] !== "" &&
        !errors[field.name]
    ).length;

    return (
        <div className="attribute-table">
            <div className={`attribute-table__progress${completeCount === fields.length ? " attribute-table__progress--complete" : ""}`}>
                {completeCount} of {fields.length} fields complete
            </div>
            {fields.map(field => {
                const value = values[field.name] ?? "";
                const error = touched[field.name] ? errors[field.name] : undefined;
                const commonProps = {
                    id: `attribute-${field.name}`,
                    className: `attribute-table__input${error ? " attribute-table__input--error" : ""}`,
                    value: String(value),
                    required: field.required,
                    "aria-invalid": !!error,
                    "aria-describedby": error ? `attribute-${field.name}-error` : undefined,
                    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
                        const nextValue = event.target.value;
                        onChange(field.name, field.type === "integer" || field.type === "number"
                            ? nextValue === "" ? "" : Number(nextValue)
                            : nextValue);
                    },
                    onBlur: () => onBlur(field.name),
                };

                return (
                    <div className="attribute-table__row" key={field.name}>
                        <div className="attribute-table__labelrow">
                            <label className="map-sidebar__label" htmlFor={commonProps.id}>
                                {field.name.replace(/_/g, " ")}
                                {field.required && <span className="attribute-table__required"> *</span>}
                            </label>
                            {field.description && (
                                <span className="attribute-table__help" tabIndex={0} aria-label={`Help for ${field.name}`}>
                                    ?
                                    <span className="attribute-table__tooltip">{field.description}</span>
                                </span>
                            )}
                        </div>
                        {field.options ? (
                            <select {...commonProps}>
                                <option value="">Select a value</option>
                                {field.options.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                        ) : field.type === "string" && !field.format ? (
                            <textarea {...commonProps} rows={2} />
                        ) : (
                            <input
                                {...commonProps}
                                type={field.format === "date" ? "date" : field.type === "string" ? "text" : "number"}
                                step={field.type === "integer" ? "1" : "any"}
                            />
                        )}
                        {error && <div id={`attribute-${field.name}-error`} className="attribute-table__error">{error}</div>}
                    </div>
                );
            })}
        </div>
    );
};

export default FeatureAttributeTable;
