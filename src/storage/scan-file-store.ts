/**
 * Where the 3D tab keeps scan files between visits.
 *
 * Meshes are far too large for the workbook, so the session holds only their
 * name, size and SHA-256. The PWA backs this port with IndexedDB; a host
 * without local file storage simply asks for the files again each time.
 */

export interface ScanFileStore {
  /** Keep a file under its hash. Resolves false if the device refused (quota). */
  put(sha256: string, file: Blob, name: string): Promise<boolean>;
  get(sha256: string): Promise<Blob | null>;
}
