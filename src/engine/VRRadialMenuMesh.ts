import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Slice definitions — mirrors RadialContextMenu.tsx geometry exactly
// ---------------------------------------------------------------------------
interface SliceDef {
  id: 'undo' | 'redo' | 'right' | 'bottom' | 'left';
  /** Start angle in degrees (0 = up/north, clockwise). Gap-adjusted. */
  startDeg: number;
  endDeg: number;
  /** Default accent colour */
  color: string;
  /** Label shown inside the slice */
  label: string;
  /** Small sub-label (state-dependent, set dynamically) */
  subLabel?: string;
}

const BASE_SLICES: SliceDef[] = [
  { id: 'undo',   startDeg: -67,  endDeg: -5,  color: '#6366f1', label: 'Undo' },
  { id: 'redo',   startDeg:   5,  endDeg:  67, color: '#6366f1', label: 'Redo' },
  { id: 'right',  startDeg:  77,  endDeg: 139, color: '#f59e0b', label: 'Locomotion', subLabel: 'Walk' },
  { id: 'bottom', startDeg: 149,  endDeg: 211, color: '#06b6d4', label: 'Scaling',    subLabel: 'On' },
  { id: 'left',   startDeg: 221,  endDeg: 283, color: '#06b6d4', label: 'Laser',      subLabel: 'On' },
];

export interface VRRadialMenuState {
  locomotionMode: 'walk' | 'flight' | 'noclip';
  scalingEnabled: boolean;
  laserEnabled: boolean;
  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  isHeld: boolean;
  /**
   * AssetType of the currently held asset (mirrors App.tsx's
   * `heldAssetType` state). Drives the conditional held-tab slice labels:
   * a misc file held in the hand replaces the "Duplicate" bottom slice
   * with a "Download" slice — matching the desktop RadialContextMenu,
   * since misc files are the only type that meaningfully exports raw
   * bytes to disk. Null = nothing held.
   *
   * Stored as a string (not AssetType) to keep VRRadialMenuMesh
   * independent of AssetManager's import path.
   */
  heldAssetType: string | null;
  activeTab: 'general' | 'grab' | 'held';
}

export interface VRRadialMenuCallbacks {
  onUndo: () => void;
  onRedo: () => void;
  onToggleScaling: () => void;
  onToggleLaser: () => void;
  onNextLocomotion: () => void;
  onNextGrabMode: () => void;
  onDestroy: () => void;
  onDuplicate: () => void;
  onSaveHeld: () => void;
  /**
   * Wire only when the held asset is a misc file; the menu hides the
   * corresponding slice for other types so the prop is effectively
   * unused then. Mirrors RadialContextMenu's `onDownloadHeld` prop.
   */
  onDownloadHeld?: () => void;
  onClose: () => void;
  onNextTab: () => void;
}

const SIZE = 512;      // canvas px
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_IN = 80;       // inner dead-zone radius (px)
const R_OUT = 200;     // outer ring edge (px)
const HUB_R = 70;      // center hub radius
// 0.30 m = the VR user reported the original 0.6 was too large;
// halving keeps the slices comfortably within reach (~31° angular
// subtended at the 0.55 m placement distance) while small enough
// that the user can land precise aim on a slice.
const WORLD_SIZE = 0.30; // panel width/height in metres

/**
 * Canvas-texture radial menu for VR.
 * Create one, add `group` to the scene, call `setVisible(true)` to show it.
 * Each frame call `updateAim(ray)` to highlight the aimed slice.
 * On trigger press call `select()` to fire the highlighted action.
 */
export class VRRadialMenuMesh {
  public readonly group: THREE.Group;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  // Set true after dispose(); subsequent renderer ticks or
  // external raycast calls should early-return so a stale
  // mesh can't be rendered/drawn against a freed texture.
  private _disposed: boolean = false;
  private mesh: THREE.Mesh;

  private hoveredSlice: number = -1;   // -1 = hub, ≥0 = slice index, null = nothing
  private _activeTab: 'general' | 'grab' | 'held' = 'general';
  private _state: VRRadialMenuState;
  private _callbacks: VRRadialMenuCallbacks;

  private _slices: SliceDef[] = BASE_SLICES.map(s => ({ ...s }));
  // Hoisted scratch refs so placeNearController is allocation-free
  // when called from a per-frame aim loop. Without these, every
  // reposition would `origin.clone()` + `clone().sub()` twice per
  // call — ~180 allocations/second at 90 Hz — and the GC pressure
  // would cause micro-stutter right when the user is trying to
  // aim/select. Both helpers are private and only ever written to
  // inside the same synchronous call chain, so share-mutation is
  // safe.
  private _scratchPos = new THREE.Vector3();
  private _scratchToUser = new THREE.Vector3();
  // Hoisted Raycaster so updateAim's per-frame intersection test
  // doesn't allocate one. Mirrors the _scratchPos GC-neutral pattern:
  // callers mutate `raycaster.ray` each frame and call intersectObject;
  // `intersectObject` itself does NOT mutate fields the consumer depends
  // on (intersection result is returned), so share-mutation across
  // frames is safe. ~90 allocations/sec saved at 90 Hz.
  private _scratchRaycaster = new THREE.Raycaster();

  constructor(callbacks: VRRadialMenuCallbacks, initialState: VRRadialMenuState) {
    this._callbacks = callbacks;
    this._state = { ...initialState };

    // --- Canvas ---
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // --- Mesh ---
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'VRRadialMenuMesh';
    this.mesh.userData.isVRRadialMenu = true;

    // --- Group ---
    this.group = new THREE.Group();
    this.group.name = 'VRRadialMenuGroup';
    this.group.add(this.mesh);
    this.group.visible = false;

    this._draw();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  public get activeTab(): 'general' | 'grab' | 'held' { return this._activeTab; }

  public setVisible(v: boolean): void {
    this.group.visible = v;
    if (v) {
      this.hoveredSlice = -999; // sentinel — force draw on first aim update
      this._draw();
    }
  }

  public get isVisible(): boolean { return this.group.visible; }

  public setState(state: Partial<VRRadialMenuState>): void {
    this._state = { ...this._state, ...state };
    this._draw();
  }

  public setActiveTab(tab: 'general' | 'grab' | 'held'): void {
    this._activeTab = tab;
    this._draw();
  }

  /**
   * Place the menu panel 0.35 m along `laserDir` from `origin`,
   * then +0.05 m up (slight bust so the panel sits at wrist
   * height instead of face height — matches typical Resonite VR
   * workflow), facing back toward `origin`.
   *
   * Allocation-free: uses internal hoisted scratch refs so it is
   * safe to call from a per-frame aim loop (App.tsx's tick now
   * re-positions every frame so the menu follows the active
   * controller — otherwise wrist motion drifts the aim ray off
   * the panel and the buttons feel "non-interactive" despite the
   * action plumbing being correct). Reads `origin` and `laserDir`
   * but does NOT mutate them; the previous `.clone()`-based
   * implementation allocated ~180 vec3s/sec at 90 Hz.
   *
   * Also forces `this.group.updateMatrixWorld(true)` after writing
   * position/rotation. Without this the same-frame `updateAim()`
   * raycaster intersects the STALE matrixWorld from the previous
   * render frame — and on the very first frame after B/Y press the
   * mesh has never been rendered, so matrixWorld is still the
   * identity-equivalent (mesh "at world (0, 0, 0)") and the user's
   * aim ray never hits anything despite the menu being visually
   * drawn. updateMatrixWorld(true) recurses into the child mesh so
   * the raycaster (which reads mesh.matrixWorld) sees the same pose
   * that the renderer is about to draw.
   */
  public placeNearController(origin: THREE.Vector3, laserDir: THREE.Vector3): void {
    const pos = this._scratchPos.copy(origin).addScaledVector(laserDir, 0.35);
    pos.y += 0.05;
    this.group.position.copy(pos);

    // Face the panel's -Z toward the user (origin) so it's readable
    const toUser = this._scratchToUser.copy(origin).sub(pos);
    toUser.y = 0;
    if (toUser.lengthSq() > 1e-6) {
      toUser.normalize();
      const yaw = Math.atan2(toUser.x, toUser.z);
      this.group.rotation.set(0, yaw, 0);
    }

    // CRITICAL: force the world-matrix update NOW, in the same JS
    // tick, so the same-frame aim raycast in updateAim() intersects
    // the freshly-placed pose. The vanilla Three.js render path only
    // updates matrixWorld during renderer.render(); if we don't force
    // it here we'd be testing the raycast against the PREVIOUS frame's
    // mesh location (and on the first frame after B/Y press, against
    // the never-rendered default identity-equivalent).
    this.group.updateMatrixWorld(true);
  }

  /**
   * Call each frame with the VR controller's ray to update the highlighted slice.
   * @returns true if the ray is aimed at this menu
   */
  public updateAim(ray: THREE.Ray): boolean {
    if (!this.group.visible) return false;

    // Intersect the ray with the mesh
    const hits: THREE.Intersection[] = [];
    const raycaster = this._scratchRaycaster;
    raycaster.ray.copy(ray);
    raycaster.intersectObject(this.mesh, false, hits);

    if (hits.length === 0) {
      if (this.hoveredSlice !== -999) {
        this.hoveredSlice = -999; // nothing
        this._draw();
      }
      return false;
    }

    const uv = hits[0].uv!;
    const newHover = this._uvToSlice(uv.x, uv.y);
    if (newHover !== this.hoveredSlice) {
      this.hoveredSlice = newHover;
      this._draw();
    }
    return true;
  }

  /**
   * Fire the action for the currently hovered slice.
   * Call when the controller trigger is pressed.
   */
  public select(): void {
    const cb = this._callbacks;
    if (this.hoveredSlice === -1) {
      // Hub: cycle tab
      cb.onNextTab();
      return;
    }
    if (this.hoveredSlice < 0 || this.hoveredSlice >= this._slices.length) return;
    const slice = this._slices[this.hoveredSlice];
    switch (slice.id) {
      case 'undo':   cb.onUndo(); cb.onClose(); break;
      case 'redo':   cb.onRedo(); cb.onClose(); break;
      case 'right':
        if (this._activeTab === 'general') cb.onNextLocomotion();
        else if (this._activeTab === 'held') { cb.onSaveHeld(); cb.onClose(); }
        else cb.onNextGrabMode();
        break;
      case 'bottom':
        if (this._activeTab === 'general') { cb.onToggleScaling(); }
        else if (this._activeTab === 'held') {
          // Bottom slice in held tab is conditionally Download (for misc
          // files) or Duplicate (for everything else). Misc files are
          // the only type that meaningfully downloads — the rest are
          // already present in-world as renderable assets. Mirrors the
          // icon swap in `_buildSlices` below.
          if (this._state.heldAssetType === 'misc') {
            if (cb.onDownloadHeld) cb.onDownloadHeld();
          } else {
            cb.onDuplicate();
          }
          cb.onClose();
        }
        else cb.onClose();
        break;
      case 'left':
        if (this._activeTab === 'general') { cb.onToggleLaser(); }
        else if (this._activeTab === 'held') { cb.onDestroy(); cb.onClose(); }
        else cb.onClose();
        break;
    }
  }

  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.texture.dispose();
    (this.mesh.material as THREE.MeshBasicMaterial).dispose();
    this.mesh.geometry.dispose();
  }

  /** True after the mesh has been disposed; render/aim loops should bail. */
  public get disposed(): boolean { return this._disposed; }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /** Convert UV (0–1, 0–1) to slice index (or -1 for hub, -999 for outside). */
  private _uvToSlice(u: number, v: number): number {
    // Canvas: u→X, (1-v)→Y (WebGL UV origin bottom-left; canvas top-left)
    const px = u * SIZE;
    const py = (1 - v) * SIZE;
    const dx = px - CX;
    const dy = py - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < HUB_R) return -1; // hub
    if (dist > R_OUT + 10) return -999; // outside ring

    // Angle from top (north = 0°, clockwise)
    let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (angleDeg > 290) angleDeg -= 360;
    else if (angleDeg < -70) angleDeg += 360;

    for (let i = 0; i < this._slices.length; i++) {
      const s = this._slices[i];
      if (s.startDeg <= s.endDeg) {
        if (angleDeg >= s.startDeg && angleDeg <= s.endDeg) return i;
      } else {
        if (angleDeg >= s.startDeg || angleDeg <= s.endDeg) return i;
      }
    }
    return -999;
  }

  private _draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);

    const slices = this._buildSlices();

    // --- Background disk ---
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R_OUT + 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 10, 18, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,240,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // --- Pie slices ---
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      const isHovered = this.hoveredSlice === i;
      this._drawSlice(s, isHovered);
    }

    // --- Center hub ---
    const hubHovered = this.hoveredSlice === -1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, HUB_R, 0, Math.PI * 2);
    ctx.fillStyle = hubHovered ? 'rgba(0,240,255,0.2)' : 'rgba(8,10,18,0.95)';
    ctx.fill();
    ctx.strokeStyle = this._state.isHeld ? '#f59e0b' : '#00f0ff';
    ctx.lineWidth = hubHovered ? 3 : 2;
    ctx.stroke();
    ctx.restore();

    // Hub label
    ctx.save();
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tabLabel = this._activeTab === 'general' ? 'MENU' : this._activeTab === 'grab' ? 'GRAB' : 'HELD';
    ctx.fillText(tabLabel, CX, CY - 8);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = 'rgba(148,163,184,0.9)';
    ctx.fillText('tap to cycle', CX, CY + 12);
    ctx.restore();

    this.texture.needsUpdate = true;
  }

  private _buildSlices(): (SliceDef & { label: string; subLabel: string; color: string })[] {
    const s = this._state;
    const tab = this._activeTab;
    return this._slices.map(slice => {
      let label = slice.label;
      let subLabel = '';
      let color = slice.color;

      if (slice.id === 'undo') {
        label = 'Undo'; subLabel = '↩'; color = '#818cf8';
      } else if (slice.id === 'redo') {
        label = 'Redo'; subLabel = '↪'; color = '#818cf8';
      } else if (slice.id === 'right') {
        if (tab === 'general') {
          label = 'Locomotion';
          subLabel = s.locomotionMode === 'walk' ? '🚶 Walk' : s.locomotionMode === 'flight' ? '✈ Flight' : '👻 Noclip';
          color = '#f59e0b';
        } else if (tab === 'held') {
          label = 'Save'; subLabel = 'to Inventory'; color = '#f59e0b';
        } else {
          label = 'Grab Mode';
          subLabel = s.grabMode;
          color = '#f59e0b';
        }
      } else if (slice.id === 'bottom') {
        if (tab === 'general') {
          label = 'Scaling';
          subLabel = s.scalingEnabled ? '✓ On' : '✗ Off';
          color = s.scalingEnabled ? '#10b981' : '#ef4444';
        } else if (tab === 'held') {
          if (s.heldAssetType === 'misc') {
            label = 'Download';
            subLabel = 'to device';
            color = '#06b6d4';
          } else {
            label = 'Duplicate';
            subLabel = 'Make a copy';
            color = '#06b6d4';
          }
        } else {
          label = 'Snap Grid'; subLabel = 'Toggle'; color = '#06b6d4';
        }
      } else if (slice.id === 'left') {
        if (tab === 'general') {
          label = 'Laser';
          subLabel = s.laserEnabled ? '✓ On' : '✗ Off';
          color = s.laserEnabled ? '#06b6d4' : '#64748b';
        } else if (tab === 'held') {
          label = 'Destroy'; subLabel = 'Remove'; color = '#ef4444';
        } else {
          label = 'Collision'; subLabel = 'Toggle'; color = '#a855f7';
        }
      }
      return { ...slice, label, subLabel, color };
    });
  }

  private _drawSlice(
    slice: SliceDef & { label: string; subLabel: string; color: string },
    isHovered: boolean
  ): void {
    const ctx = this.ctx;
    const startRad = this._degToCanvasRad(slice.startDeg);
    const endRad   = this._degToCanvasRad(slice.endDeg);

    // Sector fill
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(CX + R_IN * Math.cos(startRad), CY + R_IN * Math.sin(startRad));
    ctx.arc(CX, CY, R_OUT, startRad, endRad, false);
    ctx.arc(CX, CY, R_IN, endRad, startRad, true);
    ctx.closePath();
    ctx.fillStyle = isHovered
      ? `${slice.color}44`
      : 'rgba(22,26,42,0.88)';
    ctx.fill();
    ctx.strokeStyle = isHovered ? slice.color : `${slice.color}88`;
    ctx.lineWidth = isHovered ? 3 : 1.5;
    ctx.stroke();
    ctx.restore();

    // Text in slice centre
    const midDeg = (slice.startDeg + slice.endDeg) / 2;
    const midRad = this._degToCanvasRad(midDeg);
    const rMid = (R_IN + R_OUT) / 2;
    const tx = CX + rMid * Math.cos(midRad);
    const ty = CY + rMid * Math.sin(midRad);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Label
    ctx.font = `bold 15px sans-serif`;
    ctx.fillStyle = isHovered ? '#ffffff' : slice.color;
    ctx.fillText(slice.label, tx, ty - 9);

    // Sub-label
    if (slice.subLabel) {
      ctx.font = `12px sans-serif`;
      ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.85)' : 'rgba(148,163,184,0.9)';
      ctx.fillText(slice.subLabel, tx, ty + 9);
    }
    ctx.restore();
  }

  /** Convert "north = 0°, clockwise" degrees to canvas radians (east = 0). */
  private _degToCanvasRad(deg: number): number {
    return (deg - 90) * (Math.PI / 180);
  }
}
