/**
 * Storage port.
 *
 * The tabs know how to collect an examination; they do not know where it is
 * kept. The Office add-in supplies an ExcelStore that talks to the host
 * workbook; the standalone PWA supplies a PwaStore backed by IndexedDB and
 * SheetJS. Both write the same sheet layout, so their .xlsx files are
 * interchangeable and the existing DentalCompiler keeps working.
 */

import { ExaminationSession } from "../model/types";

export interface ActionLabel {
  label: string;
  icon: string;
}

export interface LocalSessionInfo {
  sessionId: string;
  title: string;
  subtitle: string;
  modifiedAt: string;
  exported: boolean;
}

/** Locally persisted sessions — offered by the PWA store only. */
export interface LocalSessionApi {
  list(): Promise<LocalSessionInfo[]>;
  open(sessionId: string): Promise<ExaminationSession | null>;
  remove(sessionId: string): Promise<void>;
  autosave(session: ExaminationSession): Promise<void>;
  exportAll(): Promise<string>;
}

export interface SessionStore {
  /** Primary save action on the Save & Report tab. */
  readonly saveAction: ActionLabel;
  /** Help text under the Save & Report tab. */
  readonly saveHelp: string;
  /** "Load from the host document" — null hides the button (PWA has no host). */
  readonly hostLoadAction: ActionLabel | null;

  save(session: ExaminationSession): Promise<string>;
  loadFromHost(): Promise<ExaminationSession | null>;
  loadFromFile(file: File): Promise<ExaminationSession | null>;

  readonly local?: LocalSessionApi;

  /** Examination + scan files in one .dentx file — offered by the PWA store only. */
  readonly bundle?: BundleApi;
}

export interface BundleApi {
  /** Save the bundle (download); a password encrypts it. Returns a status message. */
  save(session: ExaminationSession, password: string | null): Promise<string>;
}
