/* global Blob, FileReader, document, URL */

import * as XLSX from "xlsx";
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
} from "../excel/session-codec";
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
import { examFileTag } from "../model/exam";

/**
 * Reads and writes the exact sheet layout the Office add-in produces, so a
 * file exported here opens in the add-in and feeds DentalCompiler unchanged.
 */

export function buildWorkbook(sessions: ExaminationSession[]): Uint8Array {
  const headers = getColumnHeaders();
  const dataRows = sessions.map((s) =>
    sessionToRow(s).map((v) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? 1 : 0) : v))
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...dataRows]), SHEET_NAME);

  const imageRows = sessions.flatMap((s) => radiographsToImageRows(s));
  if (imageRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([IMAGE_HEADERS, ...imageRows]), IMAGE_SHEET_NAME);
  }

  // SheetJS returns an ArrayBuffer for type "array" — normalise so callers
  // always get a byte view regardless of the build.
  const written = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  return written instanceof Uint8Array ? written : new Uint8Array(written);
}

/** Parse an .xlsx and return the last examination it contains. */
export async function readWorkbook(file: File): Promise<ExaminationSession | null> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });

  const dataSheet = wb.Sheets[SHEET_NAME];
  if (!dataSheet) throw new Error(`V datoteki ni lista "${SHEET_NAME}".`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(dataSheet, { header: 1, raw: true, defval: "" });
  if (grid.length < 2) return null;

  const headers = (grid[0] as unknown[]).map((h) => String(h ?? ""));
  const values = grid[grid.length - 1] as unknown[];

  let session: ExaminationSession | null = null;

  // The _json backup is authoritative when present; flat columns are the fallback.
  session = readJsonBackup(headers, values);
  if (!session) session = rowToSession(headers, values);
  if (!session) return null;

  // Backward compat with files written by older versions
  if (!session.probing) session.probing = makeDefaultProbingData();
  if (!session.rootCaries) session.rootCaries = makeDefaultRootCariesData();
  if (!session.fdiQuestionnaire) session.fdiQuestionnaire = makeDefaultFdiQuestionnaire();
  if (!session.bop) session.bop = makeDefaultBOPData();
  if (!session.furcationInvolvement) session.furcationInvolvement = makeDefaultFurcationInvolvementData();
  if (!session.icdasRootCaries) session.icdasRootCaries = makeDefaultICDASRootCariesData();
  if (!session.radiographs) session.radiographs = makeDefaultRadiographs();
  if (!session.ohipExtra) session.ohipExtra = makeDefaultOhipExtra();

  // Radiograph payloads live on their own sheet
  let stored: StoredRadiographImages = {};
  const imageSheet = wb.Sheets[IMAGE_SHEET_NAME];
  if (imageSheet) {
    try {
      const imgGrid = XLSX.utils.sheet_to_json<unknown[]>(imageSheet, { header: 1, raw: true, defval: "" });
      if (imgGrid.length >= 2) {
        const imgHeaders = (imgGrid[0] as unknown[]).map((h) => String(h ?? ""));
        stored = imageRowsToRadiographs(
          imgHeaders,
          imgGrid.slice(1) as unknown[][],
          session.sessionId
        );
      }
    } catch {
      // An unreadable image sheet must not block loading the examination.
    }
  }
  restoreRadiographs(session, stored);

  return session;
}

/** Build the file name used for downloads: code, exam type and number, date. */
export function workbookFileName(session: ExaminationSession): string {
  const p = session.patient;
  const who = (p.code || `${p.lastName}_${p.firstName}` || "pregled").replace(/[^\w\-.]+/g, "_");
  return `${who}_${examFileTag(p)}_${p.date || "bez-datuma"}.xlsx`;
}

/**
 * Hand the file to the user. In an installed PWA this is the one place the
 * platform still differs: iOS routes it through the share sheet rather than a
 * downloads folder, so the anchor must be in the document when clicked.
 */
export function downloadWorkbook(
  bytes: Uint8Array,
  fileName: string,
  type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Revoked on a delay: Safari reads the blob asynchronously after the click.
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 30000);
}
