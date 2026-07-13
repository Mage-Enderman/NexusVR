import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { AssetType } from '../engine/AssetManager.ts';
import type { EnvironmentSettings } from '../engine/EnvironmentManager.ts';

export interface SavedSceneAsset {
  id: string;
  name: string;
  type: AssetType;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
  isCollidable: boolean;
  url?: string;
  fileData?: ArrayBuffer;
  metadata?: any;
  primitiveType?: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
  materialState?: any;
}

export interface SavedScene {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  environment: EnvironmentSettings;
  assets: SavedSceneAsset[];
  thumbnailUrl?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const DB_NAME = 'nexusvr-scenes-storage';
const STORE_NAME = 'scenes';

export class SceneSerializationService {
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      },
    });
  }

  public async saveScene(scene: SavedScene): Promise<void> {
    const db = await this.dbPromise;
    await db.put(STORE_NAME, scene);
  }

  public async getScenes(): Promise<SavedScene[]> {
    const db = await this.dbPromise;
    const all: SavedScene[] = await db.getAll(STORE_NAME);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public async getScene(id: string): Promise<SavedScene | undefined> {
    const db = await this.dbPromise;
    return db.get(STORE_NAME, id);
  }

  public async deleteScene(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete(STORE_NAME, id);
  }

  public exportSceneToJson(scene: SavedScene): void {
    const serializableScene = {
      ...scene,
      assets: scene.assets.map((a) => ({
        ...a,
        fileDataBase64: a.fileData ? arrayBufferToBase64(a.fileData) : undefined,
        fileData: undefined,
      })),
    };
    const jsonStr = JSON.stringify(serializableScene, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = scene.name.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase() || 'room';
    a.download = `${safeName}.nexus.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  public async importSceneFromJson(file: File): Promise<SavedScene> {
    const text = await file.text();
    const parsed = JSON.parse(text) as any;
    if (!parsed.id || !Array.isArray(parsed.assets)) {
      throw new Error('Invalid .nexus room file format');
    }
    parsed.id = `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    parsed.updatedAt = Date.now();
    parsed.assets = parsed.assets.map((a: any) => ({
      ...a,
      fileData: a.fileDataBase64 ? base64ToArrayBuffer(a.fileDataBase64) : a.fileData,
      fileDataBase64: undefined,
    }));
    await this.saveScene(parsed as SavedScene);
    return parsed as SavedScene;
  }

  public getFavoriteSceneId(): string | null {
    try {
      return localStorage.getItem('nexusvr_favorite_scene_id');
    } catch {
      return null;
    }
  }

  public setFavoriteSceneId(id: string | null): void {
    try {
      if (id) {
        localStorage.setItem('nexusvr_favorite_scene_id', id);
      } else {
        localStorage.removeItem('nexusvr_favorite_scene_id');
      }
    } catch {
      // ignore storage errors
    }
  }
}
