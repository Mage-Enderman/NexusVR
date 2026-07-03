import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { LoadedAsset } from './AssetManager.ts';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface TransformUpdate {
  assetId: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  isCollidable: boolean;
}

export class ManipulationManager {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  public transformControls!: TransformControls;
  public selectedAsset: LoadedAsset | null = null;
  
  private onTransformChangeCallbacks: Set<(update: TransformUpdate) => void> = new Set();
  private onSelectionChangeCallbacks: Set<(asset: LoadedAsset | null) => void> = new Set();
  private onScaleSelfCallbacks: Set<(factor: number) => void> = new Set();
  private onDragCallbacks: Set<(isDragging: boolean) => void> = new Set();
  public isDragging = false;
  private isEKeyPressed = false;
  // Tracks whether OrbitControls was enabled BEFORE a TransformControls drag
  // started, so we can restore the correct state when the drag ends. Without
  // this, the dragging-changed handler blindly sets `orbitControls.enabled = true`
  // when the drag ends, re-enabling orbit even in first-person mode.
  private orbitWasEnabledBeforeDrag = true;

  constructor(scene: THREE.Scene, camera: THREE.Camera, domElement: HTMLElement, orbitControls?: any) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;

    this.init(orbitControls);
  }

  private init(orbitControls?: any): void {
    this.transformControls = new TransformControls(this.camera, this.domElement);
    this.transformControls.size = 0.9;
    this.transformControls.space = 'local';
    
    // In Three.js TransformControls, either getHelper() is present or cast to Object3D
    const helper = (this.transformControls as any).getHelper ? (this.transformControls as any).getHelper() : (this.transformControls as unknown as THREE.Object3D);
    this.scene.add(helper);

    // Disable orbit controls while dragging gizmo, but restore the
    // previous state when the drag ends instead of blindly enabling them.
    // This prevents re-enabling orbit controls in first-person mode after
    // a TransformControls drag completes.
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      this.isDragging = !!event.value;
      if (orbitControls) {
        if (event.value) {
          // Drag started: save current enabled state and disable
          this.orbitWasEnabledBeforeDrag = orbitControls.enabled;
          orbitControls.enabled = false;
        } else {
          // Drag ended: restore previous state
          orbitControls.enabled = this.orbitWasEnabledBeforeDrag;
        }
      }
      for (const cb of this.onDragCallbacks) cb(this.isDragging);
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (!this.selectedAsset) return;
      this.broadcastCurrentTransform();
    });

    // Wire up Mouse Wheel Shortcuts (Move Away/Towards, Scale Item, Scale Self)
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.domElement.addEventListener('mousemove', this.onMouseMove);
  }

  private onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      for (const cb of this.onScaleSelfCallbacks) cb(factor);
      return;
    }

    if (!this.selectedAsset) return;

    if (e.shiftKey) {
      // Shift + Wheel: Scale Held Item
      e.preventDefault();
      const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.selectedAsset.object3d.scale.multiplyScalar(scaleFactor);
      this.broadcastCurrentTransform();
    } else {
      // Wheel: Move Held Item Away / Towards
      e.preventDefault();
      const distDelta = e.deltaY < 0 ? -0.5 : 0.5;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.selectedAsset.object3d.position.addScaledVector(dir, -distDelta);
      this.broadcastCurrentTransform();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
    if (e.code === 'KeyE' || e.key === 'e' || e.key === 'E') {
      this.isEKeyPressed = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'KeyE' || e.key === 'e' || e.key === 'E') {
      this.isEKeyPressed = false;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.isEKeyPressed && e.buttons === 1 && this.selectedAsset) {
      const rotSpeed = 0.01;
      this.selectedAsset.object3d.rotation.y += e.movementX * rotSpeed;
      this.selectedAsset.object3d.rotation.x += e.movementY * rotSpeed;
      this.broadcastCurrentTransform();
    }
  };

  public registerOnDragChange(cb: (isDragging: boolean) => void): () => void {
    this.onDragCallbacks.add(cb);
    return () => this.onDragCallbacks.delete(cb);
  }

  public registerOnScaleSelf(cb: (factor: number) => void): () => void {
    this.onScaleSelfCallbacks.add(cb);
    return () => this.onScaleSelfCallbacks.delete(cb);
  }

  public registerOnTransformChange(cb: (update: TransformUpdate) => void): () => void {
    this.onTransformChangeCallbacks.add(cb);
    return () => this.onTransformChangeCallbacks.delete(cb);
  }

  public registerOnSelectionChange(cb: (asset: LoadedAsset | null) => void): () => void {
    this.onSelectionChangeCallbacks.add(cb);
    return () => this.onSelectionChangeCallbacks.delete(cb);
  }

  public setMode(mode: TransformMode): void {
    this.transformControls.setMode(mode);
  }

  public setSpace(space: 'local' | 'world'): void {
    this.transformControls.space = space;
  }

  public getSpace(): 'local' | 'world' {
    return this.transformControls.space as 'local' | 'world';
  }

  public selectAsset(asset: LoadedAsset | null): void {
    if (this.selectedAsset === asset) return;
    
    this.selectedAsset = asset;
    if (asset) {
      this.transformControls.attach(asset.object3d);
    } else {
      this.transformControls.detach();
    }
    
    for (const cb of this.onSelectionChangeCallbacks) cb(asset);
  }

  public toggleCollision(asset?: LoadedAsset): boolean {
    const target = asset || this.selectedAsset;
    if (!target) return false;
    
    target.isCollidable = !target.isCollidable;
    
    target.object3d.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material && !Array.isArray(mesh.material)) {
          mesh.material.transparent = !target.isCollidable;
          mesh.material.opacity = target.isCollidable ? 1.0 : 0.6;
        }
      }
    });

    this.broadcastCurrentTransform(target);
    return target.isCollidable;
  }

  public broadcastCurrentTransform(target?: LoadedAsset): void {
    const asset = target || this.selectedAsset;
    if (!asset) return;

    const obj = asset.object3d;
    const update: TransformUpdate = {
      assetId: asset.id,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      isCollidable: asset.isCollidable
    };

    for (const cb of this.onTransformChangeCallbacks) {
      cb(update);
    }
  }

  public applyRemoteTransform(update: TransformUpdate, assetMap: Map<string, LoadedAsset>): void {
    const asset = assetMap.get(update.assetId);
    if (!asset) return;

    if (this.isDragging && this.selectedAsset?.id === update.assetId) {
      return;
    }

    asset.object3d.position.set(...update.position);
    asset.object3d.rotation.set(...update.rotation);
    asset.object3d.scale.set(...update.scale);
    
    if (asset.isCollidable !== update.isCollidable) {
      asset.isCollidable = update.isCollidable;
      asset.object3d.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.material && !Array.isArray(mesh.material)) {
            mesh.material.transparent = !asset.isCollidable;
            mesh.material.opacity = asset.isCollidable ? 1.0 : 0.6;
          }
        }
      });
    }
  }

  public handleRaycastSelection(raycaster: THREE.Raycaster, assetMap: Map<string, LoadedAsset>): LoadedAsset | null {
    const objectsToTest: THREE.Object3D[] = [];
    const objToAssetMap = new Map<THREE.Object3D, LoadedAsset>();

    assetMap.forEach((asset) => {
      objectsToTest.push(asset.object3d);
      objToAssetMap.set(asset.object3d, asset);
    });

    const intersects = raycaster.intersectObjects(objectsToTest, true);
    if (intersects.length > 0) {
      let current: THREE.Object3D | null = intersects[0].object;
      while (current && !objToAssetMap.has(current)) {
        current = current.parent;
      }
      if (current && objToAssetMap.has(current)) {
        const foundAsset = objToAssetMap.get(current)!;
        this.selectAsset(foundAsset);
        return foundAsset;
      }
    }

    this.selectAsset(null);
    return null;
  }

  public dispose(): void {
    this.domElement.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.domElement.removeEventListener('mousemove', this.onMouseMove);
    this.transformControls.detach();
    this.transformControls.dispose();
  }
}
