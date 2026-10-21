/* global crypto, TextEncoder, TextDecoder, Blob, File */

/**
 * The examination bundle (.dentx): one file that carries an examination
 * together with its 3D scan files, so a scan can move between devices and be
 * archived with its data.
 *
 * A .dentx is a zip:
 *   manifest.json   format, version, who/when, and every scan file's SHA-256
 *   pregled.xlsx    the examination exactly as the .xlsx export writes it
 *                   (data sheet with the _json backup, image sheet with the
 *                   X-rays and the report pictures)
 *   skeni/…         the scan files, byte for byte
 *
 * With a password, the whole zip is encrypted with AES-256-GCM under a key
 * derived from the password (PBKDF2-SHA-256). Without the password the file
 * cannot be opened — there is no recovery.
 */

import { zip, unzip, strToU8, strFromU8, Zippable, Unzipped } from "fflate";
import { ExaminationSession } from "../model/types";
import { SCAN_KINDS, ScanFileRef, fileExtension } from "../model/scans3d";
import { ScanFileStore } from "../storage/scan-file-store";
import { buildWorkbook, readWorkbook } from "./workbook";

export const BUNDLE_EXTENSION = ".dentx";
const FORMAT = "dentalexam-bundle";
const VERSION = 1;
const WORKBOOK_PATH = "pregled.xlsx";
// Encrypted files start with this line, then one line of JSON parameters
const MAGIC = "DENTX-AES256GCM-1\n";
const PBKDF2_ITERATIONS = 600000;
// Already compressed: storing them again would only cost time
const STORED_AS_IS = ["jpg", "jpeg", "png", "3oxz", "zip"];

interface ManifestFile {
  path: string;
  name: string;
  size: number;
  sha256: string;
  kind: string;
}

interface Manifest {
  format: string;
  version: number;
  createdAt: string;
  app: string;
  sessionId: string;
  patient: { code: string; date: string };
  files: ManifestFile[];
}

export interface BundleSaveResult {
  bytes: Uint8Array;
  /** Scan files the session refers to that were not on this device. */
  missing: ScanFileRef[];
  fileCount: number;
}

export interface BundleLoadResult {
  session: ExaminationSession;
  restored: number;
}

/** The password was wrong, or a password is needed and none was given. */
export class BundlePasswordError extends Error {
  constructor(readonly needed: boolean) {
    super(needed ? "Paket je zaščiten z geslom." : "Napačno geslo — paketa ni mogoče odpreti.");
  }
}

// ── Saving ─────────────────────────────────────────────────────────

export async function buildBundle(
  session: ExaminationSession,
  files: ScanFileStore,
  appBuild: string,
  password: string | null
): Promise<BundleSaveResult> {
  const entries: Zippable = {};
  const manifestFiles: ManifestFile[] = [];
  const missing: ScanFileRef[] = [];
  const seen = new Set<string>();

  for (const kind of SCAN_KINDS) {
    for (const part of session.scans3d?.[kind]?.parts || []) {
      for (const ref of [part.mesh, ...part.extras]) {
        if (seen.has(ref.sha256)) continue;
        seen.add(ref.sha256);
        const blob = await files.get(ref.sha256);
        if (!blob) {
          missing.push(ref);
          continue;
        }
        // The hash prefix keeps two different files with one name apart
        const path = `skeni/${kind}/${ref.sha256.slice(0, 12)}_${safeName(ref.name)}`;
        const data = new Uint8Array(await blob.arrayBuffer());
        entries[path] = [data, { level: STORED_AS_IS.includes(fileExtension(ref.name)) ? 0 : 6 }];
        manifestFiles.push({ path, name: ref.name, size: ref.size, sha256: ref.sha256, kind });
      }
    }
  }

  const manifest: Manifest = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    app: appBuild,
    sessionId: session.sessionId,
    patient: { code: session.patient.code || "", date: session.patient.date || "" },
    files: manifestFiles,
  };
  entries["manifest.json"] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  // Already a zip inside: store it as is
  entries[WORKBOOK_PATH] = [buildWorkbook([session]), { level: 0 }];

  const zipped = await zipAsync(entries);
  const bytes = password ? await encrypt(zipped, password) : zipped;
  return { bytes, missing, fileCount: manifestFiles.length };
}

// ── Opening ────────────────────────────────────────────────────────

export async function isEncryptedBundle(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer());
  return new TextDecoder().decode(head) === MAGIC;
}

/**
 * Open a bundle: the examination, and its scan files back into the device's
 * storage. Every scan file is checked against its SHA-256 before it is kept.
 */
export async function readBundle(file: Blob, files: ScanFileStore, password: string | null): Promise<BundleLoadResult> {
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  if (await isEncryptedBundle(file)) {
    if (!password) throw new BundlePasswordError(true);
    bytes = await decrypt(bytes, password);
  }

  let entries: Unzipped;
  try {
    entries = await unzipAsync(bytes);
  } catch {
    throw new Error("Datoteka ni veljaven paket pregleda (.dentx).");
  }
  const manifestRaw = entries["manifest.json"];
  if (!manifestRaw) throw new Error("V paketu ni datoteke manifest.json.");
  const manifest = JSON.parse(strFromU8(manifestRaw)) as Manifest;
  if (manifest.format !== FORMAT) throw new Error("Datoteka ni paket pregleda (.dentx).");
  if (manifest.version > VERSION) {
    throw new Error("Paket je ustvarila novejša različica aplikacije — posodobite aplikacijo.");
  }

  const workbook = entries[WORKBOOK_PATH];
  if (!workbook) throw new Error("V paketu ni podatkov pregleda.");
  const session = await readWorkbook(new File([workbook], WORKBOOK_PATH));
  if (!session) throw new Error("V paketu ni podatkov pregleda.");

  let restored = 0;
  for (const f of manifest.files) {
    const data = entries[f.path];
    if (!data) throw new Error(`V paketu manjka datoteka ${f.name}.`);
    if ((await sha256Hex(data)) !== f.sha256) throw new Error(`Datoteka ${f.name} v paketu je poškodovana.`);
    if (!(await files.put(f.sha256, new Blob([data]), f.name))) {
      throw new Error("V napravi ni dovolj prostora za datoteke skenov.");
    }
    restored++;
  }
  return { session, restored };
}

// ── Encryption ─────────────────────────────────────────────────────

interface CipherHeader {
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  if (!crypto?.subtle) throw new Error("Brskalnik ne omogoča šifriranja (potrebna je varna povezava https).");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(plain: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as Uint8Array<ArrayBuffer>));
  const header: CipherHeader = { kdf: "PBKDF2-SHA-256", iterations: PBKDF2_ITERATIONS, salt: toB64(salt), iv: toB64(iv) };
  const head = new TextEncoder().encode(MAGIC + JSON.stringify(header) + "\n");
  const out = new Uint8Array(head.length + cipher.length);
  out.set(head, 0);
  out.set(cipher, head.length);
  return out;
}

async function decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const start = MAGIC.length;
  const end = bytes.indexOf(10, start); // the header line ends with "\n"
  if (end < 0) throw new Error("Poškodovan šifriran paket.");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, end))) as CipherHeader;
  const key = await deriveKey(password, fromB64(header.salt), header.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(header.iv) }, key, bytes.subarray(end + 1) as Uint8Array<ArrayBuffer>);
    return new Uint8Array(plain);
  } catch {
    // GCM authentication fails for a wrong password (or a damaged file)
    throw new BundlePasswordError(false);
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function zipAsync(entries: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => zip(entries, (err, data) => (err ? reject(err) : resolve(data))));
}

function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => unzip(bytes, (err, data) => (err ? reject(err) : resolve(data))));
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeName(name: string): string {
  return name.replace(/[^\w\-.]+/g, "_");
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
