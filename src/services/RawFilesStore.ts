import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';

/**
 * Persisted raw-mode byte record. Stored in IndexedDB so the user's
 * imported raw file survives a page reload even when broadcast was
 * intentionally suppressed. App.tsx removes the entry on
 * AssetManager.removeAsset (raw asset deletion) or when the user
 * saves the asset to InventoryService (new InventoryItem owns the
 * bytes from then on).
 */
export interface RawFileRecord {
  id: string;
  name: string;
  type: string;
  bytes: ArrayBuffer;
  storedAt: number;
}

/**
 * Per-asset local byte-storage for "import as raw file" mode. When
 * the user toggles "Import as Raw File" on a large file, the misc
 * asset is broadcast-suppressed (lazy-share) and the bytes are kept
 * here in IndexedDB. When the user later grabs the asset and chooses
 * Import / Download / Save-to-Inventory, App.tsx rehydrates the
 * bytes via `load()` and feeds them back through the natural
 * import / save paths.
 *
 * Separate IndexedDB from InventoryService so cleanup is decoupled —
 * a removeAsset on the world object purges its raw bytes; the
 * InventoryService has its own independent lifecycle.
 */
export class RawFilesStore {
  private static readonly DB_NAME = 'nexusvr-raw';
  private static readonly STORE = 'rawfiles';
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(RawFilesStore.DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(RawFilesStore.STORE)) {
          db.createObjectStore(RawFilesStore.STORE, { keyPath: 'id' });
        }
      },
    });
  }

  /**
   * Persist a record. id MUST match the asset id assigned at import
   * time so App.tsx can correlate `asset.id` ↔ record. Returns once
   * the put resolves so callers can rely on `load(id)` succeeding on
   * the next microtask — no fire-and-forget TOCTOU window between
   * misc-asset-in-world and bytes-in-IndexedDB.
   */
  public async store(id: string, name: string, type: string, bytes: ArrayBuffer): Promise<void> {
    const db = await this.dbPromise;
    await db.put(
      RawFilesStore.STORE,
      { id, name, type, bytes, storedAt: Date.now() } satisfies RawFileRecord
    );
  }

  public async load(id: string): Promise<RawFileRecord | null> {
    const db = await this.dbPromise;
    const rec = (await db.get(RawFilesStore.STORE, id)) as RawFileRecord | undefined;
    return rec ?? null;
  }

  public async delete(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete(RawFilesStore.STORE, id);
  }

  public async has(id: string): Promise<boolean> {
    const db = await this.dbPromise;
    const rec = await db.get(RawFilesStore.STORE, id);
    return !!rec;
  }
}
