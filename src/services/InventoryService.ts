import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { AssetType } from '../engine/AssetManager.ts';

export interface InventoryItem {
  id: string;
  name: string;
  type: AssetType | 'primitive' | 'tool';
  createdAt: number;
  fileData?: ArrayBuffer;
  url?: string;
  primitiveType?: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
  toolType?: 'dev' | 'material' | 'light' | 'shape' | 'brush';
  previewUrl?: string;
  metadata?: {
    fileSize?: number;
    mimeType?: string;
    description?: string;
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
