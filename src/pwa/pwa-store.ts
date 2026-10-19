import { ExaminationSession } from "../model/types";
import { SessionStore, ActionLabel, LocalSessionApi, LocalSessionInfo } from "../storage/session-store";
import { STORE_SESSIONS, idbPut, idbGet, idbGetAll, idbDelete } from "./idb";
import { PwaScanFiles } from "./pwa-scan-files";
import { buildWorkbook, readWorkbook, workbookFileName, downloadWorkbook } from "./workbook";

/** What actually sits in IndexedDB: the session plus local bookkeeping. */
interface StoredSession {
  sessionId: string;
  session: ExaminationSession;
  /** When this row was last written — drives the sort order in the list. */
  modifiedAt: string;
  /** The session's own modifiedAt at export time, to detect edits since. */
  exportedSessionModifiedAt: string | null;
  exportedAt: string | null;
}

function describe(s: ExaminationSession): { title: string; subtitle: string } {
  const p = s.patient;
  const name = p.firstName || p.lastName ? `${p.firstName} ${p.lastName}`.trim() : "";
  const title = p.code || name || "Neimenovan pregled";
  const parts = [`${p.checkup || 1}. pregled`];
  if (p.date) parts.push(p.date);
  if (p.code && name) parts.push(name);
  return { title, subtitle: parts.join(" · ") };
}

class PwaLocalSessions implements LocalSessionApi {
  constructor(private readonly scanFiles: PwaScanFiles) {}

  async list(): Promise<LocalSessionInfo[]> {
    const all = await idbGetAll<StoredSession>(STORE_SESSIONS);
    return all
      .filter((r) => r && r.session)
      .map((r) => ({
        sessionId: r.sessionId,
        ...describe(r.session),
        modifiedAt: r.modifiedAt || r.session.modifiedAt,
        exported: !!r.exportedAt,
      }))
      .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  }

  async open(sessionId: string): Promise<ExaminationSession | null> {
    const row = await idbGet<StoredSession>(STORE_SESSIONS, sessionId);
    return row?.session || null;
  }

  async remove(sessionId: string): Promise<void> {
    await idbDelete(STORE_SESSIONS, sessionId);
    // Scan files are shared between sessions; drop only the ones now unused.
    try {
      const rest = await idbGetAll<StoredSession>(STORE_SESSIONS);
      await this.scanFiles.prune(rest.filter((r) => r && r.session).map((r) => r.session));
    } catch {
      /* leftover files only cost space; never block the delete */
    }
  }

  async autosave(session: ExaminationSession): Promise<void> {
    const existing = await idbGet<StoredSession>(STORE_SESSIONS, session.sessionId);
    // The exported file is stale the moment the session changes after it, but
    // an autosave that carries no change must not clear the flag.
    const stillExported =
      !!existing?.exportedAt && existing.exportedSessionModifiedAt === session.modifiedAt;

    await idbPut<StoredSession>(STORE_SESSIONS, {
      sessionId: session.sessionId,
      session,
      modifiedAt: new Date().toISOString(),
      exportedSessionModifiedAt: stillExported ? existing.exportedSessionModifiedAt : null,
      exportedAt: stillExported ? existing.exportedAt : null,
    });
  }

  async markExported(sessionId: string): Promise<void> {
    const row = await idbGet<StoredSession>(STORE_SESSIONS, sessionId);
    if (!row) return;
    await idbPut<StoredSession>(STORE_SESSIONS, {
      ...row,
      exportedAt: new Date().toISOString(),
      exportedSessionModifiedAt: row.session.modifiedAt,
    });
  }

  async exportAll(): Promise<string> {
    const all = await idbGetAll<StoredSession>(STORE_SESSIONS);
    const sessions = all.filter((r) => r && r.session).map((r) => r.session);
    if (sessions.length === 0) throw new Error("Ni shranjenih pregledov za izvoz.");

    // Newest last, so appended rows read chronologically like the add-in's output
    sessions.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    downloadWorkbook(buildWorkbook(sessions), `DentalExam_vsi_pregledi_${new Date().toISOString().slice(0, 10)}.xlsx`);

    for (const s of sessions) await this.markExported(s.sessionId);
    return `Izvoženih ${sessions.length} pregledov v eno datoteko.`;
  }
}

/** Storage for the standalone PWA: IndexedDB for working state, .xlsx for handover. */
export class PwaStore implements SessionStore {
  readonly saveAction: ActionLabel = { label: "Shrani in izvozi (.xlsx)", icon: "💾" };
  readonly saveHelp =
    "Pregled se samodejno shranjuje v napravo med vnašanjem. S tem gumbom prenesete " +
    "datoteko .xlsx v enakem formatu kot Excel dodatek — primerno za oddajo in za DentalCompiler.";
  readonly hostLoadAction: ActionLabel | null = null;

  readonly scanFiles = new PwaScanFiles();
  readonly local = new PwaLocalSessions(this.scanFiles);

  async save(session: ExaminationSession): Promise<string> {
    await this.local.autosave(session);
    downloadWorkbook(buildWorkbook([session]), workbookFileName(session));
    await this.local.markExported(session.sessionId);
    return "Pregled shranjen v napravo in izvožen v .xlsx.";
  }

  async loadFromHost(): Promise<ExaminationSession | null> {
    return null; // No host document in the standalone app.
  }

  async loadFromFile(file: File): Promise<ExaminationSession | null> {
    const session = await readWorkbook(file);
    if (session) await this.local.autosave(session);
    return session;
  }
}
