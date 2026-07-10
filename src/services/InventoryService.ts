import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { AssetType } from '../engine/AssetManager.ts';
import type { MaterialUpdate } from './NetworkService.ts';

export interface InventoryItem {
  id: string;
  name: string;
  type: AssetType | 'primitive' | 'tool' | 'system';
  createdAt: number;
  fileData?: ArrayBuffer;
  url?: string;
  primitiveType?: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
  toolType?: 'dev' | 'material' | 'light' | 'shape' | 'brush';
  folder?: string;
  previewUrl?: string;
  materialState?: MaterialUpdate | MaterialUpdate[] | Record<string, MaterialUpdate>;
  metadata?: {
    fileSize?: number;
    mimeType?: string;
    description?: string;
    folders?: string[];
  };
}

const DB_NAME = 'nexusvr-storage';
const STORE_NAME = 'inventory';

export class InventoryService {
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      },
    });

    this.initDefaultPrimitives();
  }

  private async initDefaultPrimitives(): Promise<void> {
    const primitives: Array<{ type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'; name: string }> = [
      { type: 'cube', name: 'Primitive Cube' },
      { type: 'sphere', name: 'Primitive Sphere' },
      { type: 'cylinder', name: 'Primitive Cylinder' },
      { type: 'cone', name: 'Primitive Cone' },
      { type: 'torus', name: 'Primitive Torus' },
      { type: 'plane', name: 'Primitive Plane' },
    ];

    const db = await this.dbPromise;
    for (const prim of primitives) {
      const id = `prim-default-${prim.type}`;
      const existing = await db.get(STORE_NAME, id);
      if (!existing) {
        const item: InventoryItem = {
          id,
          name: prim.name,
          type: 'primitive',
          primitiveType: prim.type,
          createdAt: Date.now(),
          metadata: { description: `Standard 3D ${prim.type} building block.` }
        };
        await db.put(STORE_NAME, item);
      }
    }

    const tools: Array<{ id: string; type: 'dev' | 'material' | 'light' | 'shape' | 'brush'; name: string; desc: string }> = [
      { id: 'tool-default-dev', type: 'dev', name: 'Dev Tool (Inspector & Gizmos)', desc: 'Inspect world objects, UUIDs, vertices, gizmos, and create shapes.' },
      { id: 'tool-default-material', type: 'material', name: 'Material Tool (Sampler & Editor)', desc: 'Extract, edit, and apply colors and roughness to meshes.' },
      { id: 'tool-default-light', type: 'light', name: 'Light Tool (Spawner)', desc: 'Place point lights, spot lights, and adjust room illumination.' },
      { id: 'tool-default-shape', type: 'shape', name: 'Shape Tool (Primitive Builder)', desc: 'Dedicated tool to rapidly spawn cubes, spheres, and geometric primitives.' },
      { id: 'tool-default-brush', type: 'brush', name: 'Geometry Line Brush', desc: 'Draw glowing 3D ribbons and strokes directly in 3D space.' },
    ];

    for (const t of tools) {
      const existing = await db.get(STORE_NAME, t.id);
      if (!existing) {
        const item: InventoryItem = {
          id: t.id,
          name: t.name,
          type: 'tool',
          toolType: t.type,
          createdAt: Date.now(),
          metadata: { description: t.desc }
        };
        await db.put(STORE_NAME, item);
      }
    }
  }

  public async saveItem(item: InventoryItem): Promise<void> {
    const db = await this.dbPromise;
    await db.put(STORE_NAME, item);
  }

  public async getItems(): Promise<InventoryItem[]> {
    const db = await this.dbPromise;
    const items = await db.getAllFromIndex(STORE_NAME, 'createdAt');
    return items.reverse(); // Newest first
  }

  public async getItem(id: string): Promise<InventoryItem | undefined> {
    const db = await this.dbPromise;
    return await db.get(STORE_NAME, id);
  }

  public async removeItem(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete(STORE_NAME, id);
  }

  public async renameItem(id: string, newName: string): Promise<void> {
    const item = await this.getItem(id);
    if (!item) return;
    item.name = newName;
    await this.saveItem(item);
  }

  public async moveItemToFolder(id: string, folder?: string): Promise<void> {
    const item = await this.getItem(id);
    if (!item) return;
    item.folder = folder || undefined;
    await this.saveItem(item);
  }

  public async getFolders(): Promise<string[]> {
    const items = await this.getItems();
    const folderSet = new Set<string>();
    for (const it of items) {
      if (it.folder) folderSet.add(it.folder);
    }
    const sys = await this.getItem('sys-folders');
    if (sys && Array.isArray(sys.metadata?.folders)) {
      for (const f of sys.metadata!.folders as string[]) folderSet.add(f);
    }
    return Array.from(folderSet).sort();
  }

  public async createFolder(folderName: string): Promise<void> {
    if (!folderName.trim()) return;
    const folders = await this.getFolders();
    if (!folders.includes(folderName.trim())) {
      folders.push(folderName.trim());
      await this.saveItem({
        id: 'sys-folders',
        name: 'System Folders',
        type: 'system',
        createdAt: 0,
        metadata: { folders }
      } as any);
    }
  }

  public async deleteFolder(folderName: string): Promise<void> {
    const items = await this.getItems();
    for (const it of items) {
      if (it.folder === folderName) {
        it.folder = undefined;
        await this.saveItem(it);
      }
    }
    const folders = await this.getFolders();
    const nextFolders = folders.filter(f => f !== folderName);
    await this.saveItem({
      id: 'sys-folders',
      name: 'System Folders',
      type: 'system',
      createdAt: 0,
      metadata: { folders: nextFolders }
    } as any);
  }

  public async renameFolder(oldName: string, newName: string): Promise<void> {
    const trimmedNew = newName.trim();
    if (!trimmedNew || oldName === trimmedNew) return;

    const items = await this.getItems();
    for (const it of items) {
      if (it.folder === oldName) {
        it.folder = trimmedNew;
        await this.saveItem(it);
      } else if (it.folder && it.folder.startsWith(`${oldName}/`)) {
        it.folder = `${trimmedNew}/${it.folder.slice(oldName.length + 1)}`;
        await this.saveItem(it);
      }
    }

    const folders = await this.getFolders();
    const nextFolders = folders.map(f => {
      if (f === oldName) return trimmedNew;
      if (f.startsWith(`${oldName}/`)) return `${trimmedNew}/${f.slice(oldName.length + 1)}`;
      return f;
    });

    await this.saveItem({
      id: 'sys-folders',
      name: 'System Folders',
      type: 'system',
      createdAt: 0,
      metadata: { folders: Array.from(new Set(nextFolders)) }
    } as any);
  }

  public async moveFolder(folderName: string, targetParent?: string): Promise<void> {
    const baseName = folderName.includes('/') ? folderName.split('/').pop()! : folderName;
    const newPath = targetParent ? `${targetParent}/${baseName}` : baseName;
    if (newPath === folderName) return;
    await this.renameFolder(folderName, newPath);
  }

  public async clearCustomItems(): Promise<void> {
    const db = await this.dbPromise;
    const all = await db.getAll(STORE_NAME);
    for (const item of all) {
      if (!item.id.startsWith('prim-default-')) {
        await db.delete(STORE_NAME, item.id);
      }
    }
  }
}
