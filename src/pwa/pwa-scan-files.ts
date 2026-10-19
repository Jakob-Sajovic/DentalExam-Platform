import { ExaminationSession } from "../model/types";
import { SCAN_KINDS } from "../model/scans3d";
import { ScanFileStore } from "../storage/scan-file-store";
import { STORE_SCAN_FILES, idbPut, idbGet, idbGetAllKeys, idbDelete } from "./idb";

interface StoredScanFile {
  sha256: string;
  name: string;
  size: number;
  blob: Blob;
  storedAt: string;
}

/** Scan files in IndexedDB, one copy per distinct file however many sessions use it. */
export class PwaScanFiles implements ScanFileStore {
  async put(sha256: string, file: Blob, name: string): Promise<boolean> {
    try {
      if (await idbGet<StoredScanFile>(STORE_SCAN_FILES, sha256)) return true;
      await idbPut<StoredScanFile>(STORE_SCAN_FILES, {
        sha256,
        name,
        size: file.size,
        blob: file,
        storedAt: new Date().toISOString(),
      });
      return true;
    } catch {
      // Usually the storage quota; the scan still works for this visit.
      return false;
    }
  }

  async get(sha256: string): Promise<Blob | null> {
    try {
      const row = await idbGet<StoredScanFile>(STORE_SCAN_FILES, sha256);
      return row?.blob || null;
    } catch {
      return null;
    }
  }

  /** Delete every stored file no remaining session refers to. */
  async prune(sessions: ExaminationSession[]): Promise<void> {
    const used = new Set<string>();
    for (const s of sessions) {
      if (!s.scans3d) continue;
      for (const kind of SCAN_KINDS) {
        for (const part of s.scans3d[kind]?.parts || []) {
          used.add(part.mesh.sha256);
          for (const x of part.extras) used.add(x.sha256);
        }
      }
    }
    const keys = await idbGetAllKeys(STORE_SCAN_FILES);
    for (const key of keys) {
      if (!used.has(key)) await idbDelete(STORE_SCAN_FILES, key);
    }
  }
}
