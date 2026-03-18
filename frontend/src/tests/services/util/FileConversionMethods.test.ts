import { safeParseFloat, transformCsvToLocation } from '../../../services/util/FileConversionMethods';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
describe('safeParseFloat', () => {

    // --- Gültige Eingaben ---
    it('parst einen gültigen positiven Float-String', () => {
        expect(safeParseFloat('123.45')).toBeCloseTo(123.45);
    });

    it('parst einen ganzzahligen String', () => {
        expect(safeParseFloat('42')).toBe(42);
    });

    it('parst negative Zahlen korrekt', () => {
        expect(safeParseFloat('-1.5')).toBeCloseTo(-1.5);
    });

    it('parst Null korrekt', () => {
        expect(safeParseFloat('0')).toBe(0);
    });

    it('parst wissenschaftliche Notation', () => {
        expect(safeParseFloat('1e3')).toBe(1000);
        expect(safeParseFloat('2.5e-2')).toBeCloseTo(0.025);
    });

    it('parst Strings mit führenden/nachfolgenden Leerzeichen', () => {
        expect(safeParseFloat('  3.14  ')).toBeCloseTo(3.14);
    });

    it('parst Infinity-String', () => {
        expect(safeParseFloat('Infinity')).toBe(Infinity);
    });

    // --- Ungültige Eingaben → NaN ---
    it('gibt NaN für einen rein alphabetischen String zurück', () => {
        expect(safeParseFloat('abc')).toBeNaN();
    });

    it('gibt NaN für einen leeren String zurück', () => {
        expect(safeParseFloat('')).toBeNaN();
    });

    it('gibt NaN für einen Leerzeichen-String zurück', () => {
        expect(safeParseFloat('   ')).toBeNaN();
    });

    it('parst nur den führenden Zahlenteil bei gemischten Strings (Komma-Trenner)', () => {
        // parseFloat('1,5') → 1 (nur bis zum ersten nicht-numerischen Zeichen)
        expect(safeParseFloat('1,5')).toBe(1);
    });

    it('gibt NaN zurück wenn der String mit einem Buchstaben beginnt', () => {
        expect(safeParseFloat('x10')).toBeNaN();
    });
});

// ============================================================================
describe('transformCsvToLocation', () => {

    // --- GeoJSON-Struktur ---
    it('gibt ein Array von GeoJSON-Features zurück', () => {
        const csv = fs.readFileSync(path.join(__dirname, 'testData/sampleLocation.csv'), 'utf-8');
        const result = transformCsvToLocation(csv);
        expect(Array.isArray(result)).toBe(true);
        expect(result[0].type).toBe('Feature');
        expect(result[0].geometry.type).toBe('Point');
    });

    it('parst CSV korrekt und legt coordinates als [longitude, latitude] an', () => {
        const csv = fs.readFileSync(path.join(__dirname, 'testData/sampleLocation.csv'), 'utf-8');
        const result = transformCsvToLocation(csv);
        expect(result).toHaveLength(1);
        // GeoJSON-Konvention: [longitude, latitude]
        expect(result[0].geometry.coordinates[0]).toBeCloseTo(20.2); // longitude
        expect(result[0].geometry.coordinates[1]).toBeCloseTo(10.1); // latitude
    });

    it('enthält alle übrigen Felder als properties (ohne latitude/longitude)', () => {
        const csv = fs.readFileSync(path.join(__dirname, 'testData/sampleLocation.csv'), 'utf-8');
        const result = transformCsvToLocation(csv);
        const props = result[0].properties;
        expect(props).toMatchObject({
            budgetShare: 100.5,
            dac5PurposeCode: 123,
            sector: 'A',
            location_type: 'B',
            foo: 'bar'
        });
        expect(props).not.toHaveProperty('latitude');
        expect(props).not.toHaveProperty('longitude');
    });

    // --- Mehrere Zeilen ---
    it('verarbeitet mehrere CSV-Zeilen korrekt', () => {
        const csv = 'latitude,longitude,name\n10.0,20.0,Alpha\n30.0,40.0,Beta';
        const result = transformCsvToLocation(csv);
        expect(result).toHaveLength(2);
        expect(result[0].geometry.coordinates).toEqual([20.0, 10.0]);
        expect(result[0].properties).toMatchObject({ name: 'Alpha' });
        expect(result[1].geometry.coordinates).toEqual([40.0, 30.0]);
        expect(result[1].properties).toMatchObject({ name: 'Beta' });
    });

    // --- Ungültige Koordinaten ---
    it('gibt NaN-Koordinaten zurück, wenn lat/lon keine Zahlen sind', () => {
        const csv = 'latitude,longitude\nx,y';
        const result = transformCsvToLocation(csv);
        expect(result[0].geometry.coordinates[0]).toBeNaN(); // longitude
        expect(result[0].geometry.coordinates[1]).toBeNaN(); // latitude
    });

    it('gibt NaN-Koordinaten zurück, wenn lat/lon fehlen', () => {
        const csv = 'name,value\nAlpha,1';
        const result = transformCsvToLocation(csv);
        expect(result[0].geometry.coordinates[0]).toBeNaN(); // longitude = undefined
        expect(result[0].geometry.coordinates[1]).toBeNaN(); // latitude = undefined
    });

    // --- Leerer CSV-Inhalt ---
    it('gibt ein leeres Array zurück bei leerem CSV-String', () => {
        const result = transformCsvToLocation('');
        expect(result).toHaveLength(0);
    });

    it('gibt ein leeres Array zurück bei nur einer Header-Zeile ohne Daten', () => {
        const csv = 'latitude,longitude,name';
        const result = transformCsvToLocation(csv);
        expect(result).toHaveLength(0);
    });

    // --- null / undefined ---
    it('gibt ein leeres Array zurück bei null-Eingabe', () => {
        const result = transformCsvToLocation(null);
        expect(result).toHaveLength(0);
    });

    it('gibt ein leeres Array zurück bei undefined-Eingabe', () => {
        const result = transformCsvToLocation(undefined);
        expect(result).toHaveLength(0);
    });
});
