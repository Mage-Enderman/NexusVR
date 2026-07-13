import * as THREE from 'three';
import {
  buildActiveMenuItems,
  computeArcSlices,
  type ContextMenuItemDef,
  type ComputedArcSlice,
  type ContextMenuContext,
} from './ContextMenuManager.ts';

export interface VRRadialMenuState {
  locomotionMode: 'walk' | 'flight' | 'noclip';
  scalingEnabled: boolean;
  laserEnabled: boolean;
  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  isHeld: boolean;
  isMuted?: boolean;
  heldAssetType: string | null;
  heldAssetCustomItems?: ContextMenuItemDef[];
  activeTab: 'general' | 'grab' | 'held' | 'light' | 'dev';
  activeTool?: string | null;
  noShadows?: boolean;
  lightColor?: string;
  selectionMode?: 'single' | 'multi';
  gizmoMode?: 'translate' | 'rotate' | 'scale';
  gizmoSpace?: 'local' | 'world';
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
  onDownloadHeld?: () => void;
  onToggleMute?: () => void;
  onClose: () => void;
  onNextTab: () => void;
  onSpawnPointLight?: () => void;
  onSpawnSpotLight?: () => void;
  onSpawnSunLight?: () => void;
  onToggleNoShadows?: () => void;
  onChangeLightColor?: () => void;
  onUnequipTool?: () => void;
  onOpenInspector?: () => void;
  onToggleSelectionMode?: () => void;
  onDeselectAll?: () => void;
  onSetGizmoMode?: (mode: 'translate' | 'rotate' | 'scale') => void;
  onToggleGizmoSpace?: () => void;
  onSpawnPrimitive?: (type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane') => void;
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
  private _activeTab: 'general' | 'grab' | 'held' | 'light' | 'dev' = 'general';
  private menuStack: ContextMenuItemDef[][] = [];
  private _state: VRRadialMenuState;
  private _callbacks: VRRadialMenuCallbacks;
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
    this.texture.repeat.y = -1;
    this.texture.offset.y = 1;

    // --- Mesh ---
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'VR Radial Menu Mesh';
    this.mesh.userData.isVRRadialMenu = true;

    // --- Group ---
    this.group = new THREE.Group();
    this.group.name = 'VR Radial Menu';
    this.group.add(this.mesh);
    this.group.visible = false;

    this._draw();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  public get activeTab(): 'general' | 'grab' | 'held' | 'light' | 'dev' { return this._activeTab; }

  public setVisible(v: boolean): void {
    this.group.visible = v;
    if (v) {
      this.menuStack = [];
      this.hoveredSlice = -999; // sentinel — force draw on first aim update
      this._draw();
    }
  }

  public get isVisible(): boolean { return this.group.visible; }

  public setState(state: Partial<VRRadialMenuState>): void {
    this._state = { ...this._state, ...state };
    this._draw();
  }

  public setActiveTab(tab: 'general' | 'grab' | 'held' | 'light' | 'dev'): void {
    this.menuStack = [];
    this._activeTab = tab;
    this._draw();
  }

  /**
   * Place the menu panel 0.35 m along `laserDir` from `origin`,
   * then +0.05 m up (slight bust so the panel sits at wrist
   * height instead of face height — matches typical Resonite VR
   * workflow), with its +Z (front-face) normal oriented toward
   * the user.
   *
   * `userHeadPos` is the camera/HMD world position used to compute
   * the panel's facing direction. It is OPTIONAL — when omitted
   * the function falls back to `origin` (the controller position).
   *
   * The fallback is the source of the "upside down text" bug:
   *   - When the user holds the controller out to the side (which
   *     is the natural VR pose — controllers don't sit at the
   *     head), the panel is anchored to the hand and rotated to
   *     face the hand.
   *   - The user's HEAD is somewhere else, so they end up looking
   *     at the plane's -Z (back) side.
   *   - With `side: THREE.DoubleSide`, the back face of a
   *     `PlaneGeometry` shows the canvas LEFT-RIGHT MIRRORED. The
   *     plane's UVs are identical on both sides, so the canvas's
   *     top is still mapped to the world +Y vertex (which the
   *     viewer sees as UP — world +Y is up regardless of viewing
   *     position). But the canvas's right is mapped to the
   *     plane's +X vertex, and when the viewer looks at the back
   *     of the plane the world +X direction is to their LEFT
   *     (right-hand rule: camera's -Z is world +Z, camera's +Y
   *     is world +Y → camera's +X is world -X). So the canvas's
   *     right is on the viewer's left, swapping every glyph
   *     horizontally. The user reads this as "the text is wrong"
   *     (and colloquially as "upside down" because mirrored
   *     Latin script is unreadable).
   * Passing the HMD position as `userHeadPos` rotates the panel
   * so its +Z normal points at the user's head, putting the
   * canvas-correct front face toward them — the canvas's right
   * lines up with the viewer's right and the text reads
   * normally.
   *
   * Allocation-free: uses internal hoisted scratch refs so it is
   * safe to call from a per-frame aim loop. Reads `origin`,
   * `laserDir` and `userHeadPos` but does NOT mutate them; the
   * previous `.clone()`-based implementation allocated ~180
   * vec3s/sec at 90 Hz.
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
  public placeNearController(
    origin: THREE.Vector3,
    laserDir: THREE.Vector3,
    userHeadPos?: THREE.Vector3
  ): void {
    const pos = this._scratchPos.copy(origin).addScaledVector(laserDir, 0.35);
    pos.y += 0.05;
    this.group.position.copy(pos);

    // Face the panel's +Z toward the USER (HMD/camera), not the
    // controller. If we used the controller (origin) as the user
    // anchor, the panel would face the hand; with the head a metre
    // or so away from the hand, the user ends up viewing the panel
    // from the back (where DoubleSide renders the canvas inverted).
    const userPos = userHeadPos ?? origin;
    const toUser = this._scratchToUser.copy(userPos).sub(pos);
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
   *
   * Diag: when (window as any).__vrRadialDebug === true, every press
   * logs ONE `[vr-radial]` line with the resolved hoveredSlice and
   * which branch dispatched. Enable in the browser console with:
   *     window.__vrRadialDebug = true
   * to break the guess-and-fix loop if a press fails to fire.
   */
  public select(): void {
    const cb = this._callbacks;
    const debug = (window as any).__vrRadialDebug === true;
    if (this.hoveredSlice === -1) {
      if (debug) console.log('[vr-radial] select fired (hub)');
      if (this.menuStack.length > 0) {
        this.menuStack.pop();
        this._draw();
        return;
      }
      cb.onNextTab();
      return;
    }
    const slices = this._buildSlices();
    if (this.hoveredSlice < 0 || this.hoveredSlice >= slices.length) {
      if (debug) console.log('[vr-radial] select fired (silent bail; hoveredSlice=' + this.hoveredSlice + ')');
      return;
    }
    const slice = slices[this.hoveredSlice];
    if (debug) console.log('[vr-radial] select fired (slice=' + slice.id + ')');

    if (slice.id === '__back') {
      this.menuStack.pop();
      this._draw();
      return;
    }

    if (slice.submenu && slice.submenu.length > 0) {
      const submenuItems = [...slice.submenu];
      if (!submenuItems.some(i => i.id === '__back')) {
        submenuItems.push({
          id: '__back',
          label: 'Back',
          subLabel: 'Up one level',
          color: '#64748b',
          icon: 'back',
          closeOnClick: false,
        });
      }
      this.menuStack.push(submenuItems);
      this._draw();
      return;
    }

    if (slice.action) {
      slice.action();
    } else {
      switch (slice.id) {
        case 'mute':      cb.onToggleMute?.(); break;
        case 'undo':      cb.onUndo(); break;
        case 'redo':      cb.onRedo(); break;
        case 'point':     cb.onSpawnPointLight?.(); break;
        case 'spot':      cb.onSpawnSpotLight?.(); break;
        case 'sun':       cb.onSpawnSunLight?.(); break;
        case 'noshadows': cb.onToggleNoShadows?.(); break;
        case 'color':     cb.onChangeLightColor?.(); break;
        case 'unequip':   cb.onUnequipTool?.(); break;
        case 'locomotion': cb.onNextLocomotion(); break;
        case 'scaling':   cb.onToggleScaling(); break;
        case 'laser':     cb.onToggleLaser(); break;
        case 'save':      cb.onSaveHeld(); break;
        case 'copy':
          if (this._state.heldAssetType === 'misc') cb.onDownloadHeld?.();
          else cb.onDuplicate();
          break;
        case 'destroy':   cb.onDestroy(); break;
      }
    }

    if (slice.closeOnClick !== false) {
      cb.onClose();
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
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;

    const slices = this._buildSlices();
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      if (
        (angleDeg >= s.startDeg && angleDeg <= s.endDeg) ||
        (angleDeg - 360 >= s.startDeg && angleDeg - 360 <= s.endDeg) ||
        (angleDeg + 360 >= s.startDeg && angleDeg + 360 <= s.endDeg)
      ) {
        return i;
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
    const tabLabel = this.menuStack.length > 0 ? 'BACK' :
      this._activeTab === 'dev' || this._state.activeTool === 'dev'
      ? 'DEV'
      : this._activeTab === 'light' || this._state.activeTool === 'light'
      ? 'LIGHT'
      : this._activeTab === 'general' ? 'MENU' : this._activeTab === 'grab' ? 'GRAB' : 'HELD';
    ctx.fillText(tabLabel, CX, CY - 8);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = 'rgba(148,163,184,0.9)';
    ctx.fillText('tap to cycle', CX, CY + 12);
    ctx.restore();

    this.texture.needsUpdate = true;
  }

  private _getContext(): ContextMenuContext {
    const s = this._state;
    const cb = this._callbacks;
    return {
      locomotionMode: s.locomotionMode,
      scalingEnabled: s.scalingEnabled,
      laserEnabled: s.laserEnabled,
      grabMode: s.grabMode,
      isHeld: s.isHeld,
      heldAssetType: s.heldAssetType,
      heldAssetCustomItems: s.heldAssetCustomItems,
      isMuted: s.isMuted,
      activeTool: s.activeTool,
      noShadows: s.noShadows,
      lightColor: s.lightColor,
      selectionMode: s.selectionMode,
      gizmoMode: s.gizmoMode,
      gizmoSpace: s.gizmoSpace,
      onUndo: cb.onUndo,
      onRedo: cb.onRedo,
      onToggleMute: cb.onToggleMute,
      onNextLocomotion: cb.onNextLocomotion,
      onToggleScaling: cb.onToggleScaling,
      onToggleLaser: cb.onToggleLaser,
      onNextGrabMode: cb.onNextGrabMode,
      onSaveHeld: cb.onSaveHeld,
      onDuplicate: cb.onDuplicate,
      onDownloadHeld: cb.onDownloadHeld,
      onDestroy: cb.onDestroy,
      onSpawnPointLight: cb.onSpawnPointLight,
      onSpawnSpotLight: cb.onSpawnSpotLight,
      onSpawnSunLight: cb.onSpawnSunLight,
      onToggleNoShadows: cb.onToggleNoShadows,
      onChangeLightColor: cb.onChangeLightColor,
      onUnequipTool: cb.onUnequipTool,
      onOpenInspector: cb.onOpenInspector,
      onToggleSelectionMode: cb.onToggleSelectionMode,
      onDeselectAll: cb.onDeselectAll,
      onSetGizmoMode: cb.onSetGizmoMode,
      onToggleGizmoSpace: cb.onToggleGizmoSpace,
      onSpawnPrimitive: cb.onSpawnPrimitive,
    };
  }

  private _buildSlices(): ComputedArcSlice[] {
    let currentItems: ContextMenuItemDef[];
    if (this.menuStack.length > 0) {
      currentItems = this.menuStack[this.menuStack.length - 1];
    } else {
      currentItems = buildActiveMenuItems(this._getContext(), this._activeTab);
    }
    return computeArcSlices(currentItems);
  }

  private _drawSlice(
    slice: ComputedArcSlice,
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
    const subText = slice.subLabel || (slice.submenu && slice.submenu.length > 0 ? '▸ Submenu' : undefined);
    if (subText) {
      ctx.font = `12px sans-serif`;
      ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.85)' : 'rgba(148,163,184,0.9)';
      ctx.fillText(subText, tx, ty + 9);
    }
    ctx.restore();
  }

  /** Convert "north = 0°, clockwise" degrees to canvas radians (east = 0). */
  private _degToCanvasRad(deg: number): number {
    return (deg - 90) * (Math.PI / 180);
  }
}
