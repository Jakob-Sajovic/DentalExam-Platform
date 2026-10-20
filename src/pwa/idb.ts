/* global indexedDB, IDBDatabase, IDBRequest */

/**
 * Minimal promise wrapper over IndexedDB — no dependency, and enough for
 * the examination sessions and the 3D scan files they refer to.
 */

// Not "dentalexam": the stable app on the same github.io origin uses that name
// at version 1, and opening it here at version 2 would lock the stable app out.
const DB_NAME = "dentalexam-platform";
const DB_VERSION = 2;
export const STORE_SESSIONS = "sessions";
// 3D scan files keyed by SHA-256, shared by every session that uses them (v2)
export const STORE_SCAN_FILES = "scanFiles";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains(STORE_SCAN_FILES)) {
        db.createObjectStore(STORE_SCAN_FILES, { keyPath: "sha256" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB ni na voljo."));
    req.onblocked = () => reject(new Error("Baza je zaklenjena v drugem zavihku. Zaprite druge zavihke aplikacije."));
  });

  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Napaka pri dostopu do lokalne baze."));
  });
}

export async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  await promisify(tx.objectStore(storeName).put(value));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Zapis je bil prekinjen (morda je zmanjkalo prostora)."));
  });
}

export async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return promisify<T>(db.transaction(storeName, "readonly").objectStore(storeName).get(key) as IDBRequest<T>);
}

export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return promisify<T[]>(db.transaction(storeName, "readonly").objectStore(storeName).getAll() as IDBRequest<T[]>);
}

export async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  await promisify(tx.objectStore(storeName).delete(key));
}

/** Rough picture of how much room is left — shown on the landing page. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } };
  if (!nav.storage?.estimate) return null;
  try {
    const est = await nav.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch {
    return null;
  }
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  const nav = navigator as Navigator & { storage?: { persist?: () => Promise<boolean> } };
  if (!nav.storage?.persist) return false;
  try {
    return await nav.storage.persist();
  } catch {
    return false;
  }
}

export async function idbGetAllKeys(storeName: string): Promise<string[]> {
  const db = await openDb();
  const req = db.transaction(storeName, "readonly").objectStore(storeName).getAllKeys();
  return (await promisify(req)).map((k) => String(k));
}
