/* global Excel */

import { ExaminationSession } from "../model/types";
import {
  SHEET_NAME,
  IMAGE_SHEET_NAME,
  IMAGE_HEADERS,
  getColumnHeaders,
  sessionToRow,
  rowToSession,
  radiographsToImageRows,
  imageRowsToRadiographs,
  restoreRadiographs,
  readJsonBackup,
  StoredRadiographImages,
} from "./session-codec";
import {
  makeDefaultProbingData,
  makeDefaultRootCariesData,
  makeDefaultFdiQuestionnaire,
  makeDefaultBOPData,
  makeDefaultFurcationInvolvementData,
  makeDefaultICDASRootCariesData,
  makeDefaultRadiographs,
  makeDefaultOhipExtra,
} from "../model/session";

async function saveRadiographImages(
  context: Excel.RequestContext,
  session: ExaminationSession
): Promise<void> {
  const rows = radiographsToImageRows(session);
  if (rows.length === 0) return;

  const sheets = context.workbook.worksheets;
  sheets.load("items/name");
  await context.sync();

  let sheet = sheets.items.find((sh) => sh.name === IMAGE_SHEET_NAME) || null;
  let nextRow: number;

  if (!sheet) {
    sheet = sheets.add(IMAGE_SHEET_NAME);
    const headerRange = sheet.getRangeByIndexes(0, 0, 1, IMAGE_HEADERS.length);
    headerRange.values = [IMAGE_HEADERS];
    headerRange.format.font.bold = true;
    nextRow = 1;
  } else {
    const used = sheet.getUsedRangeOrNullObject();
    used.load("rowCount");
    await context.sync();
    if (used.isNullObject) {
      const headerRange = sheet.getRangeByIndexes(0, 0, 1, IMAGE_HEADERS.length);
      headerRange.values = [IMAGE_HEADERS];
      headerRange.format.font.bold = true;
      nextRow = 1;
    } else {
      nextRow = used.rowCount;
    }
  }

  // Written in batches so a full mount does not push one sync over the
  // request size limit on Excel Online.
  const BATCH = 5;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const range = sheet.getRangeByIndexes(nextRow + i, 0, batch.length, IMAGE_HEADERS.length);
    range.values = batch;
    await context.sync();
  }

  sheet.visibility = Excel.SheetVisibility.hidden;
  await context.sync();
}

/** Read this session's images back off an image sheet, if one is present. */
async function readRadiographImages(
  context: Excel.RequestContext,
  sheet: Excel.Worksheet,
  sessionId: string
): Promise<StoredRadiographImages> {
  const used = sheet.getUsedRangeOrNullObject();
  used.load("rowCount, columnCount");
  await context.sync();
  if (used.isNullObject || used.rowCount < 2) return {};

  const headerRange = sheet.getRangeByIndexes(0, 0, 1, used.columnCount);
  headerRange.load("values");
  await context.sync();
  const headers = (headerRange.values[0] as string[]).map((h) => String(h ?? ""));

  // Read in row batches — a single load of many 30 000-character cells can
  // exceed the payload limit in Excel Online.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[][] = [];
  const BATCH = 5;
  for (let start = 1; start < used.rowCount; start += BATCH) {
    const count = Math.min(BATCH, used.rowCount - start);
    const range = sheet.getRangeByIndexes(start, 0, count, used.columnCount);
    range.load("values");
    await context.sync();
    for (const r of range.values) rows.push(r);
  }

  return imageRowsToRadiographs(headers, rows, sessionId);
}

// ── Save ──────────────────────────────────────────────────────────

/**
 * Save session to the current workbook in structured row format.
 * Appends a new row to the DentalExam_Data sheet (creates it if missing).
 * Row 1 = column headers, row 2+ = data (one row per examination).
 */
export async function saveSessionToExcel(session: ExaminationSession): Promise<void> {
  let headers = getColumnHeaders();
  let rowData = sessionToRow(session);

  await Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();

    let sheet = sheets.items.find((s) => s.name === SHEET_NAME) || null;
    let nextRow: number;

    if (!sheet) {
      // Create sheet and write headers
      sheet = sheets.add(SHEET_NAME);
      const headerRange = sheet.getRangeByIndexes(0, 0, 1, headers.length);
      headerRange.values = [headers];
      headerRange.format.font.bold = true;
      headerRange.format.horizontalAlignment = Excel.HorizontalAlignment.center;
      nextRow = 1; // 0-indexed: row index 1 = Excel row 2
    } else {
      // Find next empty row
      const usedRange = sheet.getUsedRangeOrNullObject();
      usedRange.load("rowCount,columnCount");
      await context.sync();

      if (usedRange.isNullObject) {
        // Sheet exists but is empty — write headers
        const headerRange = sheet.getRangeByIndexes(0, 0, 1, headers.length);
        headerRange.values = [headers];
        headerRange.format.font.bold = true;
        nextRow = 1;
      } else {
        nextRow = usedRange.rowCount;

        // A sheet written by an older version has a different column set. Align
        // the new row to the existing header row by name, and append any new
        // columns at the end, so older rows and the _json column stay in place.
        const existingRange = sheet.getRangeByIndexes(0, 0, 1, Math.max(usedRange.columnCount, 1));
        existingRange.load("values");
        await context.sync();
        const existing = (existingRange.values[0] as unknown[]).map((h) => String(h ?? ""));
        while (existing.length > 0 && existing[existing.length - 1] === "") existing.pop();

        const sameLayout = existing.length === headers.length && existing.every((h, i) => h === headers[i]);
        if (!sameLayout && existing.length > 0) {
          const valueByHeader = new Map<string, unknown>();
          headers.forEach((h, i) => valueByHeader.set(h, rowData[i]));
          const added = headers.filter((h) => !existing.includes(h));
          const merged = [...existing, ...added];
          if (added.length > 0) {
            const addedRange = sheet.getRangeByIndexes(0, existing.length, 1, added.length);
            addedRange.values = [added];
            addedRange.format.font.bold = true;
          }
          headers = merged;
          rowData = merged.map((h) => (valueByHeader.has(h) ? valueByHeader.get(h) : null)) as typeof rowData;
        }
      }
    }

    // Write data row
    const dataRange = sheet.getRangeByIndexes(nextRow, 0, 1, headers.length);
    // Excel expects all values as primitives; convert booleans/nulls
    const excelRow = rowData.map((v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "boolean") return v ? 1 : 0;
      return v;
    });
    dataRange.values = [excelRow];

    await context.sync();

    await saveRadiographImages(context, session);
  });
}

// ── Load ──────────────────────────────────────────────────────────

/**
 * Load the most recent session from the current workbook.
 * Reads the last data row from DentalExam_Data and reconstructs via JSON backup.
 */
export async function loadSessionFromExcel(): Promise<ExaminationSession | null> {
  let result: ExaminationSession | null = null;

  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItemOrNullObject(SHEET_NAME);
    await context.sync();

    if (sheet.isNullObject) return;

    const usedRange = sheet.getUsedRangeOrNullObject();
    usedRange.load("rowCount, columnCount");
    await context.sync();

    if (usedRange.isNullObject || usedRange.rowCount < 2) return;

    // Read header row to find _json column
    const headerRange = sheet.getRangeByIndexes(0, 0, 1, usedRange.columnCount);
    headerRange.load("values");
    await context.sync();

    const headers = headerRange.values[0] as string[];

    // Read last data row
    const lastRowIdx = usedRange.rowCount - 1;
    const lastRowRange = sheet.getRangeByIndexes(lastRowIdx, 0, 1, usedRange.columnCount);
    lastRowRange.load("values");
    await context.sync();

    const values = lastRowRange.values[0];

    // Prefer the JSON backup cells for reliable reconstruction
    result = readJsonBackup(headers, values);

    // Fallback: reconstruct from structured columns
    if (!result) {
      result = rowToSession(headers, values);
    }

    // Backward compat: ensure fields exist for old files
    if (result) {
      if (!result.probing) result.probing = makeDefaultProbingData();
      if (!result.rootCaries) result.rootCaries = makeDefaultRootCariesData();
      if (!result.fdiQuestionnaire) result.fdiQuestionnaire = makeDefaultFdiQuestionnaire();
      if (!result.patient.checkup) result.patient.checkup = 1;
      if (!result.bop) result.bop = makeDefaultBOPData();
      if (!result.furcationInvolvement) result.furcationInvolvement = makeDefaultFurcationInvolvementData();
      if (!result.icdasRootCaries) result.icdasRootCaries = makeDefaultICDASRootCariesData();
      if (!result.radiographs) result.radiographs = makeDefaultRadiographs();
      if (!result.ohipExtra) result.ohipExtra = makeDefaultOhipExtra();
    }

    // Radiograph images live on their own sheet, keyed by session id
    if (result) {
      let stored: StoredRadiographImages = {};
      const imgSheet = context.workbook.worksheets.getItemOrNullObject(IMAGE_SHEET_NAME);
      await context.sync();
      if (!imgSheet.isNullObject) {
        try {
          stored = await readRadiographImages(context, imgSheet, result.sessionId);
        } catch {
          // A missing or malformed image sheet must never block loading the exam.
        }
      }
      restoreRadiographs(result, stored);
    }
  });

  return result;
}

/**
 * Load from an externally selected file via insertWorksheetsFromBase64.
 * Imports the DentalExam_Data sheet temporarily, reads data, then removes it.
 */
export async function loadSessionFromFile(base64: string): Promise<ExaminationSession | null> {
  let result: ExaminationSession | null = null;

  await Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;

    // Insert worksheets from the external file
    const inserted = context.workbook.insertWorksheetsFromBase64(base64, {
      sheetNamesToInsert: [SHEET_NAME],
      positionType: Excel.WorksheetPositionType.end,
    });
    await context.sync();

    // Find the imported sheet (may be renamed if conflict)
    sheets.load("items/name");
    await context.sync();

    // Look for sheets matching "DentalExam_Data" or "DentalExam_Data (N)"
    const importedSheet = sheets.items
      .filter((s) => s.name === SHEET_NAME || s.name.startsWith(SHEET_NAME + " ("))
      .sort((a, b) => b.name.length - a.name.length)[0]; // longest name = most recent copy

    if (!importedSheet) return;

    const usedRange = importedSheet.getUsedRangeOrNullObject();
    usedRange.load("rowCount, columnCount");
    await context.sync();

    if (usedRange.isNullObject || usedRange.rowCount < 2) {
      importedSheet.delete();
      await context.sync();
      return;
    }

    // Read header + last data row
    const headerRange = importedSheet.getRangeByIndexes(0, 0, 1, usedRange.columnCount);
    headerRange.load("values");
    const lastRowIdx = usedRange.rowCount - 1;
    const lastRowRange = importedSheet.getRangeByIndexes(lastRowIdx, 0, 1, usedRange.columnCount);
    lastRowRange.load("values");
    await context.sync();

    const headers = headerRange.values[0] as string[];
    const values = lastRowRange.values[0];

    result = readJsonBackup(headers, values);
    if (!result) {
      result = rowToSession(headers, values);
    }

    // Backward compat: ensure fields exist for old files
    if (result) {
      if (!result.probing) result.probing = makeDefaultProbingData();
      if (!result.rootCaries) result.rootCaries = makeDefaultRootCariesData();
      if (!result.fdiQuestionnaire) result.fdiQuestionnaire = makeDefaultFdiQuestionnaire();
      if (!result.patient.checkup) result.patient.checkup = 1;
      if (!result.bop) result.bop = makeDefaultBOPData();
      if (!result.furcationInvolvement) result.furcationInvolvement = makeDefaultFurcationInvolvementData();
      if (!result.icdasRootCaries) result.icdasRootCaries = makeDefaultICDASRootCariesData();
      if (!result.radiographs) result.radiographs = makeDefaultRadiographs();
      if (!result.ohipExtra) result.ohipExtra = makeDefaultOhipExtra();
    }

    // Clean up imported sheet
    importedSheet.delete();
    await context.sync();
  });

  // Radiograph images are imported in a second pass, in their own Excel.run:
  // files written before this feature existed have no image sheet at all, and
  // asking insertWorksheetsFromBase64 for a missing sheet fails the whole call.
  // Assertion resets control-flow narrowing: TS cannot see the assignment
  // that happens inside the Excel.run callback above.
  const loaded = result as ExaminationSession | null;
  if (loaded) {
    let stored: StoredRadiographImages = {};
    try {
      stored = await loadRadiographImagesFromFile(base64, loaded.sessionId);
    } catch {
      // No image sheet, or an unreadable one — the exam still loads without films.
    }
    restoreRadiographs(loaded, stored);
  }

  return result;
}

async function loadRadiographImagesFromFile(
  base64: string,
  sessionId: string
): Promise<StoredRadiographImages> {
  let images: StoredRadiographImages = {};

  await Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;

    context.workbook.insertWorksheetsFromBase64(base64, {
      sheetNamesToInsert: [IMAGE_SHEET_NAME],
      positionType: Excel.WorksheetPositionType.end,
    });
    await context.sync();

    sheets.load("items/name");
    await context.sync();

    const imported = sheets.items
      .filter((sh) => sh.name === IMAGE_SHEET_NAME || sh.name.startsWith(IMAGE_SHEET_NAME + " ("))
      .sort((a, b) => b.name.length - a.name.length)[0];

    if (!imported) return;

    try {
      images = await readRadiographImages(context, imported, sessionId);
    } finally {
      imported.delete();
      await context.sync();
    }
  });

  return images;
}

