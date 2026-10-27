"use client";

/**
 * A copy of exam code on this device, so a dropped connection or a crashed
 * tab never loses work. `synced` turns true once the server confirms a save;
 * anything still unsynced on the next load is offered back to the student.
 * Every call is best effort: without IndexedDB the server save still works.
 */
export type LocalDraft = { language: string; source: string; synced: boolean; savedAt: number };

const DB = "aethercode";
const STORE = "drafts";

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

const key = (attemptPath: string, itemId: string) => `${attemptPath}#${itemId}`;

export async function putDraft(attemptPath: string, itemId: string, draft: Omit<LocalDraft, "savedAt">): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...draft, savedAt: Date.now() } satisfies LocalDraft, key(attemptPath, itemId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** Drafts for this attempt the server never confirmed, by item id. */
export async function unsyncedDrafts(attemptPath: string): Promise<Map<string, LocalDraft>> {
  const found = new Map<string, LocalDraft>();
  const db = await open();
  if (!db) return found;
  const prefix = `${attemptPath}#`;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).openCursor(IDBKeyRange.bound(prefix, `${prefix}￿`));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const draft = cursor.value as LocalDraft;
      if (!draft.synced) found.set(String(cursor.key).slice(prefix.length), draft);
      cursor.continue();
    };
    request.onerror = () => resolve();
  });
  return found;
}
