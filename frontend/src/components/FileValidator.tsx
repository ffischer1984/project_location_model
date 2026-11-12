/* eslint-disable  @typescript-eslint/no-explicit-any */
import './scss/FileValidator.scss'

import React, {useEffect, useState} from "react";
import MapComponent from "./MapComponent";
import FeatureAttributeTable from "./FeatureAttributeTable.tsx";
import {useLocationCollection} from "./hooks/useLocationCollection.ts";
import Utils, {OGMFileTypes, SupportedLangs} from "../services/util/Utils.ts";
import {transformCsvToLocation} from "../services/util/FileConversionMethods";
import {getDraftTitle} from "../services/util/FeatureForm.ts";
import {saveAs} from 'file-saver';
import {
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogContentText,
	DialogTitle,
	FormControl,
	InputLabel,
	MenuItem,
	Select
} from '@mui/material';

import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import SendMailButton from "./SendMailButton.tsx";
import Validator from "../services/util/Validator.ts";
import FileUpload from "./FileUpload.tsx";
import {getAppConfig} from "../services/Config.ts";
import {Processing} from "./elements/Processing.tsx";


/** Formats a local date as yyyy-mm-dd (compatible with schema format: "date"). */
export function formatValidationDate(date: Date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * Overwrites date_of_data_collection with the validation date.
 * Supports flat rows (Excel) and GeoJSON Features.
 */
export function applyValidationTimestamp<T extends Record<string, unknown>>(rows: T[]): T[] {
	const date = formatValidationDate();
	return rows.map((row) => {
		if (row && typeof row === 'object' && 'properties' in row && row.properties) {
			const props = row.properties as Record<string, unknown>;
			return { ...row, properties: { ...props, date_of_data_collection: date } };
		}
		return { ...row, date_of_data_collection: date };
	});
}

export function buildValidatedGeoJsonFilename(geoJsonDataWrap: { features?: Array<{ properties?: Record<string, unknown> }> } | null): string {
	const features = geoJsonDataWrap?.features ?? [];
	const validationDate =
		(features[0]?.properties?.date_of_data_collection as string | undefined) ?? formatValidationDate();

	const projectNumbers = new Set(
		features
			.map(f => f?.properties?.donor_project_no)
			.filter(n => n != null && n !== '')
			.map(String)
	);

	if (projectNumbers.size === 1) {
		const projectNo = [...projectNumbers][0].replace(/[^\w.-]/g, '_');
		return `locations_${projectNo}_${validationDate}.geojson`;
	}
	return `locations_validated_${validationDate}.geojson`;
}

export function getDonorProjectWarnings(geoJsonDataWrap: { features?: Array<{ properties?: Record<string, unknown> }> } | null): string[] {
	const projectNumbers = new Set(
		(geoJsonDataWrap?.features ?? [])
			.map(f => f?.properties?.donor_project_no)
			.filter(n => n != null && n !== '')
			.map(String)
	);
	if (projectNumbers.size === 0) {
		return ['Warning: No BMZ project number found in the file.'];
	}
	if (projectNumbers.size > 1) {
		return ['Warning: There is more than one BMZ project number in your file. Please verify.'];
	}
	return [];
}

export function buildValidationWarnings(
	geoJsonDataWrap: { features?: Array<{ properties?: Record<string, unknown> }> } | null,
	removedExampleCount: number
): string[] {
	const warnings: string[] = [];
	const exampleNote = Utils.getExampleRowsRemovedNote(removedExampleCount);
	if (exampleNote) {
		warnings.push(exampleNote);
	}
	warnings.push(...getDonorProjectWarnings(geoJsonDataWrap));
	return warnings;
}

export const NO_LOCATIONS_AFTER_EXAMPLE_STRIP =
	'Error: No project locations remain after removing example row(s). Please replace the example data with real project locations.';

export function getValidationErrorHeader(lang: SupportedLangs): React.ReactElement {
	const schemaDocUrl = `https://mapme-initiative.github.io/project_location_model/schemas/project_core_schema_${Utils.sanitizeLang(lang)}.html`;
	return <p>Your data contains errors. Please correct them in your original file and re-upload.<br/>For field descriptions and examples, see: <a href={schemaDocUrl}>schema-definition</a></p>
}
export default function FileValidator(): React.ReactElement {
	const [lang, setLang] = useState<SupportedLangs>('en');
	const [validationResult, setValidationResult] = useState<string | null>(null);
	const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
	const [geoJsonDataWrap, setGeoJsonDataWrap] = useState<any>(null);
	const [enableEMailButton, setEnableEMailButton] = useState<boolean>(false);
	const [openNoSheetDialog, setOpenNoSheetDialog] = React.useState(false);
	const [inProNumbers, setInProNumbers] = useState<Set<string> | null>(null);
	const [isProcessing, setIsProcessing] = useState(false);
	const [isDataValid, setIsDataValid] = useState(false);
	const [downloadedCollection, setDownloadedCollection] = useState<unknown>(null);
	const collection = useLocationCollection(lang);

	useEffect(() => {
		if (collection.loadError) {
			setValidationResult(`Error: ${collection.loadError}`);
		}
	}, [collection.loadError]);


	function handleCSVFiles(data: string | ArrayBuffer | null | undefined) {
		try {
			const parsed = applyValidationTimestamp(transformCsvToLocation(data));
			const { items: transformedData, removedCount } = Utils.stripExampleRows(parsed);
			const wrap = { type: "FeatureCollection", features: transformedData };
			setGeoJsonDataWrap(wrap);
			setValidationWarnings(buildValidationWarnings(wrap, removedCount));
			if (transformedData.length === 0) {
				setValidationResult(NO_LOCATIONS_AFTER_EXAMPLE_STRIP);
				setIsDataValid(false);
				return;
			}
			validateParsedData(transformedData);
		} catch (e) {
			setValidationResult(`CSV-Files: ${e.message}`)
		}
	}

	const handleJsonFiles = (file: File) => {
		console.debug("handleJsonFiles")
		Promise.all([file.text(), Validator.getProjectValidator(lang)])
			.then(([text, validateProjectFunction]) => {
				//init validateProjects
				const validateProject = validateProjectFunction

				// Parse the uploaded GeoJSON
				const geoJsonData = JSON.parse(text);

				// Check if the input is a Feature or a FeatureCollection
				switch (geoJsonData.type) {
					case "Feature": {
						const stampedFeature = applyValidationTimestamp([geoJsonData])[0];
						const { items: stripped, removedCount } = Utils.stripExampleRows([stampedFeature]);
						if (stripped.length === 0) {
							const wrap = { type: "FeatureCollection", features: [] };
							setGeoJsonDataWrap(wrap);
							setValidationWarnings(buildValidationWarnings(wrap, removedCount));
							setValidationResult(NO_LOCATIONS_AFTER_EXAMPLE_STRIP);
							setIsDataValid(false);
							break;
						}
						const feature = stripped[0];
						const isValid = validateProject ? validateProject(feature) : false;
						const orderedFeature = Utils.orderFeature(feature);
						const wrap = { type: "FeatureCollection", features: [orderedFeature] };
						if (isValid) {
							setValidationResult("GeoJSON Feature data is valid!");
							setGeoJsonDataWrap(wrap);
							setValidationWarnings(buildValidationWarnings(wrap, removedCount));
							setIsDataValid(true);
						} else {
							const formattedErrors = Utils.formatAjvErrorsWithRow(validateProject.errors || [], 1);
							setValidationResult(formattedErrors.join("\n"));
							setValidationWarnings(buildValidationWarnings(wrap, removedCount));
							setIsDataValid(false);
						}
						break;
					}
					case "FeatureCollection": {
						const stampedFeatures = applyValidationTimestamp(geoJsonData.features);
						const { items: withoutExamples, removedCount } = Utils.stripExampleRows(stampedFeatures);
						if (withoutExamples.length === 0) {
							const wrap = { type: "FeatureCollection", features: [] };
							setGeoJsonDataWrap(wrap);
							setValidationWarnings(buildValidationWarnings(wrap, removedCount));
							setValidationResult(NO_LOCATIONS_AFTER_EXAMPLE_STRIP);
							setIsDataValid(false);
							break;
						}
						const transformedFeatures = withoutExamples
							.map((feature: any) => Utils.toValidatedFeature(feature, validateProject))
							.filter(Utils.notNull) // Remove invalid features
							.map((feature: any) => Utils.orderFeature(feature));
						if (transformedFeatures.length === withoutExamples.length) {
							setValidationResult("GeoJSON FeatureCollection data is valid!");
							setIsDataValid(true)
						} else {
							setValidationResult(
								"Error: Some features in the GeoJSON FeatureCollection failed validation."
							);
							setIsDataValid(false)
						}

						setGeoJsonDataWrap({
							type: "FeatureCollection",
							features: transformedFeatures,
						});
						setValidationWarnings(buildValidationWarnings({
							features: withoutExamples,
						}, removedCount));
						break;
					}
					default: {
						setValidationResult("Error: GeoJSON file must be a Feature or FeatureCollection.");
						setIsDataValid(false)
						return;
					}
				}
			})
			.catch(e => {
				console.error(e)
				setValidationResult(`Errors at json-validating: ${e.message} `)
			})
	}
	const resetMap = () => {
		console.debug("resetMap()")
		// Clear the GeoJSON data and reset the validation result
		setGeoJsonDataWrap(null);
		setValidationResult(null);
		setValidationWarnings([]);
		setOpenNoSheetDialog(false)
		setEnableEMailButton(false)
		setIsDataValid(false)
		collection.stop()

	};

	const startNewCollection = () => {
		// uploaded features stay on the map and become editable members of the new collection
		const uploaded = geoJsonDataWrap?.features ?? [];
		setValidationResult(null);
		setValidationWarnings([]);
		setOpenNoSheetDialog(false);
		setEnableEMailButton(false);
		setIsDataValid(false);
		setDownloadedCollection(null);
		collection.start(uploaded);
	};
	async function handleExcelFiles(
		data: string | ArrayBuffer | null | undefined
	) {
		try {
			setIsProcessing(true)
			const parsedRows = applyValidationTimestamp(await Utils.excelJSToJSON(data, lang))
			const { items: jsonData, removedCount } = Utils.stripExampleRows(parsedRows)
			setIsProcessing(false)
			console.log('Converted Excel data:', jsonData);

			if (jsonData.length === 0) {
				const wrap = { type: "FeatureCollection", features: [] };
				setGeoJsonDataWrap(wrap);
				setValidationWarnings(buildValidationWarnings(wrap, removedCount));
				setValidationResult(NO_LOCATIONS_AFTER_EXAMPLE_STRIP);
				setIsDataValid(false);
				return;
			}

			// Validierung mit dem Core Validator
			const validator = Validator.getCoreValidator(lang);
			validator
				.then(coreValidate => {
					const allErrors = jsonData.map((row, index) => {
						coreValidate(row);
						if(coreValidate.errors != null)
							return Utils.formatAjvErrorsWithRow(coreValidate.errors, index + 1);
						else
							return
					})
					.filter(Utils.notUndefined)

					if (allErrors.length == 0) { // Wenn keine Fehler gefunden wurden
						setValidationResult("Excel/CSV-Validation successfull!");
					} else {
						setValidationResult(`${allErrors.join("\n")}`);
						setEnableEMailButton(false)
					}
					const features = jsonData.map(Utils.toGeoFeature)
					const wrap = { type: "FeatureCollection", features };
					setGeoJsonDataWrap(wrap);
					setValidationWarnings(buildValidationWarnings(wrap, removedCount));
					return features;
				})
				.then(validateParsedData)


		} catch (error) {
			setIsProcessing(false)
			console.error(error)
			if (error instanceof Error) {
				setValidationResult(`Error processing Excel file: ${error.message}`);
			} else {
				setValidationResult('An unknown error occurred while processing the Excel file');
			}
		}
	}

	// FileUpload Event und Filetyp-Verarbeitung
	const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
		resetMap()
		console.debug("handleFileUpload()")
		const file = event.target.files?.[0];
		if (!file) return;

		const fileType = file.type == "" && file.name.includes(".geojson") ? "application/geo+json" : file.type;
		const reader = new FileReader();

		switch (fileType) {
			case OGMFileTypes.GEOJSON:
			case OGMFileTypes.JSON_APP:
			case OGMFileTypes.JSON_TEXT:
				//Fall 1. direktes Einspielen als GeoJson TODO: Bisher wird nur eine Feature als Geojson-Upload verarbeitet mehrere Features noch nicht
				handleJsonFiles(file);
				break;
			case OGMFileTypes.CSV:
				reader.onload = (e) => {
					const data = e.target?.result;
					handleCSVFiles(data);
				}
				reader.readAsBinaryString(file);
				break;
			case OGMFileTypes.XLS:
			case OGMFileTypes.OPENOFFICE:
			case OGMFileTypes.XLSX:
				reader.onload = (e) => {
					const data = e.target?.result;
					handleExcelFiles(data);
				}
				reader.readAsBinaryString(file);
				break
			default:
				setValidationResult("Unsupported file type. Please upload a JSON, CSV, or Excel file.");
				return;
		}
	};

	const validateParsedData = async (data: any[]) => {
		try {
			const validateProject = await Validator.getProjectValidator(lang)
			// Validate each row in the CSV/Excel data, flatMap sonst ist allErrors Object nicht 0 von der Länge bei keinen fehlern
			const allErrors = data
				.flatMap((row, index) => {
					validateProject(row);
					if (validateProject.errors != null)
						return Utils.formatAjvErrorsWithRow(validateProject.errors, index + 1);
					else
						return
					//TODO: Format the errors for this row
				})
				.filter(Utils.notUndefined)

			const orderedFeatures = data.map((feature) => Utils.orderFeature(feature));
			setGeoJsonDataWrap((prev: any) =>
				prev?.features ? { ...prev, features: orderedFeatures } : prev
			);

			console.log("validateParsedData().allErrors", allErrors)
			if (allErrors.length == 0) { // Wenn keine Fehler gefunden wurden & alle datenreihen eine inproNumber haben, dann aktiviere den Mail-Button
				setValidationResult("Excel/CSV data is valid!");
				console.log("validateParsedData().data:", data)
				const localInproNumbers = data.map(f=>f.properties[getAppConfig().columns.for_email])
				console.log("validateParsedData().localInproNumbers:", localInproNumbers)
				if (localInproNumbers.filter((n: any) => n === undefined && n === null).length > 0) { // this here should never happened, it just represent the worst case of data cause we've finished our validation-process!
					setValidationResult("Something terrible happend, we've inpro-nos which are null or undefined and they passed our validation. Please check your data again and send this crazy dataset to the it-support (us), please.")
					return;
				}
				setIsDataValid(true)
				setInProNumbers(new Set(localInproNumbers))
			} else {
				setValidationResult(allErrors.join("\n"));
				setIsDataValid(false)
			}

		} catch (e) {
			console.error(e)
			setValidationResult(`Error: looks like you internet connection problems: ${e.message}`)
		}
	};

	const downloadProcessed = () => {
		if (collection.active && !collection.collection) return;
		if (collection.active) setDownloadedCollection(collection.collection)
		else setEnableEMailButton(true)
		const ordered = Utils.orderFeatureCollection(collection.active ? collection.collection : geoJsonDataWrap);
		const blob = new Blob([JSON.stringify(ordered)], { type: 'application/geo+json' });
		saveAs(blob, buildValidatedGeoJsonFilename(ordered));
	};

	const incompleteCount = collection.drafts.filter(d => Object.keys(collection.errorsById[d.id] ?? { pending: '' }).length > 0).length;
	const selectedDraft = collection.selected;
	const editorPanel = collection.active && selectedDraft ? {
		title: getDraftTitle(selectedDraft.values.location_name, selectedDraft.id, selectedDraft.geometry.type),
		onClose: () => collection.select(null),
		body: (
			<FeatureAttributeTable
				fields={collection.selectedFields}
				values={selectedDraft.values}
				errors={collection.errorsById[selectedDraft.id] ?? {}}
				touched={selectedDraft.touched}
				onChange={(name, value) => collection.changeValue(selectedDraft.id, name, value)}
				onBlur={name => collection.touchField(selectedDraft.id, name)}
			/>
		),
	} : null;

	return <div className='file_validator'>

		<Dialog
			open={openNoSheetDialog}
			onClose={resetMap}
			aria-labelledby="alert-dialog-title"
			aria-describedby="alert-dialog-description"
		>
			<DialogTitle id="alert-dialog-title">
				{"'fill-me' Sheet not found!"}
			</DialogTitle>
			<DialogContent>
				<DialogContentText id="alert-dialog-description">
					{"You dont use the original excel-template. The excel-template has a second sheet called fill-me please adjust your data."}
				</DialogContentText>
			</DialogContent>
			<DialogActions>
				<Button onClick={resetMap} autoFocus>
					I will reset map and retry manually
				</Button>
			</DialogActions>
		</Dialog>

		{/* ____________________ Header / Description ____________________ */}

		<header>
			<h1>Location Validator</h1>
			<p>
				The Location Validator is an open-source tool designed to validate project location data against the specifications of <a target={"_blank"} href={"https://mapme-initiative.github.io/project_location_model/"}>KfW's Project Location Model (PLM)</a>. The validator accepts both Excel and GeoJSON files as input data. Use the FILE UPLOAD button to select your file. The validator identifies errors that need to be addressed, such as missing values in mandatory fields or incorrect formats for specific entries (e.g., dates not provided in the correct format).
				<br /><br />Errors must be corrected in the original file using Excel or GIS software, after which the file must be re-checked using this tool. Repeat until a green status appears, indicating that the data is valid. Once the data is valid, you can check the submitted project locations on the map below for plausibility and geographic accuracy.
				<br />In addition, the DOWNLOAD GEOJSON button will turn blue. Please download your validated file and do not change its name. After downloading, the SEND EMAIL button will turn blue. Use it to send the validated file (both the Excel as well as the GeoJSON file) to your project counterpart at KfW.<br /><br />
				<strong>Important:</strong>
			</p>
			<ul>
				<li>Please use the latest PLM Excel template for validation. You can download it either from the bottom of this page or via this link: <a href="https://mapme-initiative.github.io/project_location_model/annex1.html">PLM Excel template</a>. Earlier versions are not accepted by the validator.</li>
				<li>Select the language matching your template in the dropdown menu LANGUAGE (TEMPLATE) below.</li>
				<li>The template contains an example row that will be automatically deleted during the validation process.</li>
				<li>Make sure to attach the latest validated (and valid) version of the file to the email to your project counterpart at KfW.</li>
				<li>In case of any problems or feature requests create an issue via <a href={"https://github.com/mapme-initiative/project_location_model/issues"}>REPORT ISSUE</a>.</li>
			</ul>
			<div className="file_validator__actions">
			<FormControl variant="outlined" size="small" sx={{ minWidth: 200 }}>
				<InputLabel id="lang-select-label">LANGUAGE (TEMPLATE)</InputLabel>
				<Select
					labelId="lang-select-label"
					value={lang}
					onChange={e => setLang(Utils.sanitizeLang(String(e.target.value)))}
					disabled={collection.active}
					label="LANGUAGE (TEMPLATE)"
				>
				<MenuItem value="en">English</MenuItem>
				<MenuItem value="fr">Français</MenuItem>
				<MenuItem value="es">Español</MenuItem>
				<MenuItem value="pt">Português</MenuItem>
				</Select>
			</FormControl>
			<FileUpload
				sx={{}}
				onChange={handleFileUpload}
				title={"File upload"}
			/>
			<Button
				
				variant={"contained"}
				startIcon={<AddLocationAltIcon />}
				onClick={startNewCollection}
			>Create new location collection</Button>
			<Button
				
				variant={"contained"}
				disabled={collection.active ? !collection.isComplete : !isDataValid}
				onClick={downloadProcessed}
			>Download GeoJSON</Button>
			<SendMailButton
				
				isEnabled={collection.active
					? collection.isComplete && !!collection.collection && downloadedCollection === collection.collection
					: enableEMailButton}
				{...(collection.active ? { inProNumbers: collection.projectNumbers } : inProNumbers ? { inProNumbers: [...inProNumbers] } : {})}
			/>
			<Button target="_blank" href={"https://github.com/mapme-initiative/project_location_model/issues"}  variant={"contained"} color={"error"}>report Issue</Button>
			</div>
		</header>



		{/* ____________________ Validation Result ____________________ */}

		{(validationResult || validationWarnings.length > 0) && (
			<div
				style={{
					...(validationResult?.toLowerCase().includes("data is valid!") ? { backgroundColor: "rgba(0, 128, 0, 0.2)" } : {}),
					...(validationResult && (validationResult.toLowerCase().includes("error") || validationResult.toLowerCase().includes("missing")) ? { backgroundColor: "rgba(128, 0, 0, 0.2)" } : {}),
					maxHeight: '360px',
					overflowY: 'auto',
					overflowX: 'hidden',
					marginTop: '0.5rem',
					padding: '0.5rem',
					border: '1px solid #ccc',
					borderRadius: '4px',
				}}
			>
				<h3>Validation Result</h3>
				{validationWarnings.map((line, i) => (
					<div
						key={i}
						style={{
							backgroundColor: 'rgba(255, 152, 0, 0.35)',
							padding: '8px',
							marginBottom: '8px',
							borderRadius: '4px',
							fontWeight: 500,
						}}
					>
						{line}
					</div>
				))}
				<pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: '0.9rem' }}>
					{
						validationResult?.toLowerCase().includes("data is valid!") ? validationResult : null
					}
					{
						validationResult && !validationResult?.toLowerCase().includes("data is valid!") &&
							getValidationErrorHeader(lang)
					}
					{
						validationResult && !validationResult?.toLowerCase().includes("data is valid!") &&
							validationResult.split('\n').map((line, i) =>
								<span key={i}>{line}{'\n'}</span>)

					}
				</pre>
			</div>
		)}


		{/* ____________________ Map ____________________ */}
		{isProcessing && (<Processing/>)}
		<div className='file_validator_map' style={{ height: '400px' }}>
			<MapComponent
				geoJsonData={collection.active ? null : geoJsonDataWrap}
				drawingEnabled={collection.ready}
				drawingSessionKey={collection.sessionKey}
				drawingInitial={collection.drafts}
				drawHandlers={{
					onCreated: collection.addGeometry,
					onChanged: collection.updateGeometry,
					onRemoved: collection.removeGeometry,
					onSelected: collection.select,
				}}
				editorPanel={editorPanel}
			/>
		</div>

		{collection.active && (
			<p>
				{collection.drafts.length === 0
					? "Use the drawing tools on the map (point, line, polygon, rectangle) to add a location. An attribute table opens after each geometry. "
					: collection.isComplete
						? "All attribute tables are complete. You can now download the GeoJSON, send the email or draw another geometry. "
						: `${incompleteCount} of ${collection.drafts.length} location(s) have missing or invalid attributes. Click a geometry on the map to edit its attribute table. `}
				The language of the template cannot be changed while a collection is being created.
			</p>
		)}



		{/* ____________________ Buttons ____________________ */}

		<div className='file_validator_buttons'>

			<button
				onClick={resetMap}
			>Reset Map</button>
		</div>



		{/* ____________________ Example ____________________ */}
		<h4>Project Location Model (PLM) Templates:</h4>
		<ul className="example-files">
			<li><p><a href={"./Project_Location_Data_Template_EN_V04.xlsx"}>Excel template (EN V04)</a></p></li>
			<li><p><a href={"./Project_Location_Data_Template_ES_V04.xlsx"}>Excel template (ES V04)</a></p></li>
			<li><p><a href={"./Project_Location_Data_Template_FR_V04.xlsx"}>Excel template (FR V04)</a></p></li>
			<li><p><a href={"./Project_Location_Data_Template_PT_V04.xlsx"}>Excel template (PT V04)</a></p></li>

		</ul>

		<h4>Invalid example files</h4>
		<ul className="example-files">
			<li><p><a href={"./sheet_not_found.xlsx"}>no fill-me sheet</a></p></li>
			<li><p><a href={"./invalid_data.xlsx"}>invalid_data</a></p></li>
			{/* <li><p><a href={"./missing_lat_lon.xlsx"}>missing_lat_lon</a></p></li> */}
		</ul>

	</div>
}
