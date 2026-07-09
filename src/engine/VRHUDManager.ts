import * as THREE from 'three';
import type { InventoryItem } from '../services/InventoryService.ts';
// ===========================================================================
// VR Panel Framework
// ===========================================================================
// Pure-immersive-WebXR counterparts for the React DOM modals. The system
// cards in the curved dash menu (Session / Settings / Env / Share / Pair /
// Inspector) route to a 1024×768 Three.js panel placed beside the dash
// instead of opening the React DOM modal — which is invisible in pure
// immersive VR. Each panel renders to its own canvas + curved-plane mesh;
// App.tsx provides a live-state context (PanelContext) plus an action
// callback so the panel re-renders with current data and interactable
// buttons can mutate React state.
//
// The radial context menu is a 3D panel too — the desktop RadialContextMenu
// is a React DOM overlay that's invisible in pure immersive WebXR, so the
// user previously had no context menu at all in VR. The 3D version uses
// the same 5-slice + center-hub geometry as the desktop and resolves
// clicks via a polar hit-test (more accurate than rectangular buttons for
// arc slices).
// ===========================================================================
import type { GraphicsSettings, PerformanceStats } from './SceneEngine.ts';
import type { EnvironmentSettings } from './EnvironmentManager.ts';
import type { ConnectionMode, ChatMessage } from '../services/NetworkService.ts';
import type { LoadedAsset } from './AssetManager.ts';

/** Rect on a panel canvas (pixel coords, top-left origin). */
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A clickable button on a panel canvas with its dispatcher key. */
export interface PanelButton {
  rect: PanelRect;
  action: string;
}

/**
 * Live state App.tsx supplies so drawer output reflects the current
 * React state (inventory list, graphics settings, environment
 * settings, network state, selected asset, scene tree, camera mode,
 * scaling/laser/grab toggles). Captured as a closure snapshot —
 * VRHUDManager reads fresh values on every `redrawPanel()`, which is
 * triggered when App.tsx pushes a new context via `setDataContext`.
 */
/**
 * Per-user row for the Session & Roles panel. Built by App.tsx from
 * networkServiceRef state (local + remote peers), passed through
 * setDataContext, and rendered as a read-only list with role badges.
 * Read-only by design — role changes are owned by the desktop
 * DashMenu (which has the proper select-element UX); the VR panel
 * just shows who is connected and what role they hold.
 */
export interface PanelUser {
  id: string;
  name: string;
  role: 'admin' | 'builder' | 'moderator' | 'guest' | 'spectator';
  isSelf: boolean;
  isHost: boolean;
}

export interface PanelContext {
  inventoryItems: InventoryItem[];
  graphicsSettings: GraphicsSettings;
  performanceStats: PerformanceStats;
  environmentSettings: EnvironmentSettings;
  roomInfo: { mode: ConnectionMode; roomId: string | null; peerCount?: number };
  selectedAsset: LoadedAsset | null;
  sceneRoot: THREE.Scene | null;
  cameraState: { mode: 'orbit' | 'first-person'; slowMovement: boolean; locomotionMode: 'walk' | 'flight' | 'noclip' };
  scalingEnabled: boolean;
  laserEnabled: boolean;
  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  /** Connected users with roles, for the Session & Roles panel. */
  users: PanelUser[];
  /**
   * True when the local user is currently carrying an object (RMB-grab,
   * VR grip, or two-handed scale). Drives the VR 3D radial's 'held'
   * tab — when true, the hub cycles general → grab → held → general
   * and the right/bottom/left slices re-bind to Save Held / Duplicate
   * / Destroy respectively. Mirrors the desktop RadialContextMenu's
   * isHeld prop so both UIs expose the same held-object verbs.
   */
  isHeld: boolean;
  /**
   * Recent chat messages relayed from NetworkService (newest at tail).
   * The VR Chat Panel renders the tail of this list (not virtual-scrolled)
   * so users in pure immersive WebXR can read incoming messages and reply
   * via the on-panel alphabet grid. Desktop ChatPanel.tsx uses
   * NetworkService.onChat directly but pushes the same buffer so
   * setDataContext stays shared.
   */
  chatMessages: ChatMessage[];
}

/** Drawer signature. Provided per-panelId by App.tsx or built-in. */
export type PanelDrawer = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  helper: PanelDrawHelper,
  data: PanelContext
) => void;

/** Helpers handed to drawers so they can register clickables + standard chrome. */
export interface PanelDrawHelper {
  /** Register a clickable region. Each call appends; identical rectangles are NOT collapsed. */
  registerButton(rect: PanelRect, action: string): void;
  /** Standard background, title, subtitle, BACK + CLOSE chrome at the top of the panel. Returns the Y at which the content body starts. */
  drawStandardChrome(title: string, subtitle: string, accent: string): number;
  /** Current canvas width / height for layout math. */
  getCanvasSize(): { w: number; h: number };
}

export interface VRHUDOptions {
  drawers?: Record<string, PanelDrawer>;
  onPanelAction?: (actionId: string) => void;
}

export class VRHUDManager {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  public group: THREE.Group;
  public curvedScreenMesh: THREE.Mesh;
  public grabBarMesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  public isVisible = false;
  private items: InventoryItem[] = [];
  private onSpawnCallback: (item: InventoryItem) => void;
  private onCloseCallback: () => void;
  // Set by openPanel when a system card requested a panel while the
  // dash menu was already visible — closed panels restore the dash
  // when the user dismisses them via BACK/CLOSE so the user can
  // immediately re-grab a different system card. Otherwise the BACK
  // button leaves the user staring at empty 3D space and they must
  // re-press the left grip to summon the dash.
  private _wasDashVisibleBeforePanel = false;

  // For dragging/moving the screen
  public isBeingGrabbed = false;
  /**
   * The controller grip space (XRGripSpace Object3D) currently holding
   * the HUD, or null when the HUD is parked at its scene-relative
   * position. App.tsx's right-grip handler sets/clears this via
   * `attachToGrip` / `detach` so the release handler doesn't have to
   * inspect the scene graph.
   */
  public currentGrip: THREE.Object3D | null = null;

  // ===========================================================================
  // VR Panel sibling mesh (immersive-WebXR system panels)
  // ===========================================================================
  public panelGroup: THREE.Group;
  public panelMesh: THREE.Mesh;
  public panelGrabBarMesh: THREE.Mesh;
  private panelCanvas: HTMLCanvasElement;
  private panelCtx: CanvasRenderingContext2D;
  private panelTexture: THREE.CanvasTexture;
  /** Current panel id, or null when only the dash menu is showing. */
  public activePanel: string | null = null;
  private panelDataCtx: PanelContext | null = null;
  private panelDrawers: Map<string, PanelDrawer> = new Map();
  private panelClickables: PanelButton[] = [];
  private onPanelAction?: (actionId: string) => void;
  // ====== Radial-menu panel state (3D counterpart for VR) ======
  // The desktop radial menu is a React DOM overlay that's invisible in
  // pure immersive WebXR. The 3D panel version renders the same 5-slice +
  // center-hub layout on the panel canvas; tab state is stored here so
  // the dispatcher can flip it via `setRadialTab` and trigger a redraw.
  private _radialTab: 'general' | 'grab' | 'held' = 'general';
  /**
   * Last radial center as drawn (single source of truth so the polar
   * hit-test in handleRayIntersection always matches what the user
   * sees — without this, a future tweak to drawStandardChrome's bodyTop
   * return would silently desync the hit-test from the visual slices).
   * Updated on every drawRadialPanel() call.
   */
  private _radialCenter: { x: number; y: number; rIn: number; rOut: number; hubR: number } | null = null;
  // Whether the panel is currently held by a controller grip (so users
  // can re-positon the panel mesh in-world like the dash menu).
  public panelCurrentGrip: THREE.Object3D | null = null;

  public get radialTab(): 'general' | 'grab' | 'held' { return this._radialTab; }

  // =================================================================
  // VR Chat Panel state + plumbing
  // =================================================================
  /**
   * Buffer the user is typing in the VR chat alphabet grid.
   * Empty string means no characters typed yet. Send pushes the buffer
   * up via onPanelAction('chat.send:<text>') and clears it.
   */
  private _chatInputBuffer: string = '';
  /**
   * Recent chat messages received via NetworkService (newest at tail,
   * deduped by id). Capped at CHAT_MESSAGE_HISTORY so the panel canvas
   * render stays bounded across long sessions. App.tsx pushes
   * incoming messages through appendIncomingChat.
   */
  private _recentMessages: ChatMessage[] = [];
  private static readonly CHAT_MESSAGE_HISTORY = 30;
  /**
   * Push a chat message that just arrived over the network into the
   * manager rolling buffer. Idempotent on duplicate ids. Triggers a
   * redraw only when the chat panel is currently active so non-active
   * panels do not churn.
   */
  public appendIncomingChat(msg: ChatMessage): void {
    if (this._recentMessages.some((m) => m.id === msg.id)) return;
    this._recentMessages.push(msg);
    if (this._recentMessages.length > VRHUDManager.CHAT_MESSAGE_HISTORY) {
      this._recentMessages.splice(
        0,
        this._recentMessages.length - VRHUDManager.CHAT_MESSAGE_HISTORY
      );
    }
    if (this.activePanel === 'sys-chat') this.redrawPanel();
  }
  /**
   * Clear the VR chat input buffer. Called from App.tsx after a send
   * completes (or on error) so the panel reflects that the message
   * has been dispatched regardless of dispatcher outcome.
   */
  public clearChatInput(): void {
    this._chatInputBuffer = '';
    if (this.activePanel === 'sys-chat') this.redrawPanel();
  }
  /**
   * Flip the active tab on the radial panel. No-ops if already on the
   * requested tab. Triggers a redraw only when the radial panel is
   * currently showing so opening a different panel doesn't waste a draw.
   */
  public setRadialTab(tab: 'general' | 'grab' | 'held'): void {
    if (this._radialTab === tab) return;
    // Don't let a 'held' tab persist once the user releases the object
    // — fall back to 'general' so the next open doesn't show held slices
    // with no asset to act on. App.tsx's auto-switch useEffect already
    // resets on open, but defend here too in case setDataContext
    // arrives between opens.
    if (tab === 'held' && !(this.panelDataCtx?.isHeld)) {
      tab = 'general';
    }
    this._radialTab = tab;
    if (this.activePanel === 'sys-radial') this.redrawPanel();
  }

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    onSpawn: (item: InventoryItem) => void,
    onClose: () => void,
    options?: VRHUDOptions
  ) {
    this.scene = scene;
    this.camera = camera;
    this.onSpawnCallback = onSpawn;
    this.onCloseCallback = onClose;
    this.onPanelAction = options?.onPanelAction;
    if (options?.drawers) {
      Object.entries(options.drawers).forEach(([id, drawer]) => this.panelDrawers.set(id, drawer));
    }
    // Register built-in drawers so App.tsx only needs to provide data,
    // not the rendering code. App.tsx can override by passing the same
    // panel id in `options.drawers` (the constructor's loop wins over
    // the built-ins via `set`).
    this.registerBuiltinDrawers();

    this.group = new THREE.Group();
    this.group.name = 'VRDashMenuGroup';
    this.group.visible = false;
    this.scene.add(this.group);

    // Create high-res offscreen canvas for UI
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 640;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Failed to get 2D context for VR HUD');
    this.ctx = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // Create Curved Screen Geometry (Plane curved along a cylinder)
    const width = 1.6;
    const height = 1.0;
    const radius = 1.8;
    const planeGeo = new THREE.PlaneGeometry(width, height, 32, 16);
    const posAttr = planeGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const angle = x / radius;
      const newX = Math.sin(angle) * radius;
      const newZ = (1 - Math.cos(angle)) * radius;
      posAttr.setXYZ(i, newX, y, -newZ);
    }
    planeGeo.computeVertexNormals();

    const screenMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });

    this.curvedScreenMesh = new THREE.Mesh(planeGeo, screenMat);
    this.curvedScreenMesh.name = 'VRCurvedScreen';
    this.group.add(this.curvedScreenMesh);

    // Create Grab Bar at the bottom of the curved screen. The grab bar
    // is a child of `group` (sibling of the curved screen) so the
    // right-grip handler can raycast against `grabBarMesh` directly and
    // walk up the parent chain to confirm it's a dash grab target.
    const barGeo = new THREE.BoxGeometry(0.6, 0.10, 0.04);
    const barMat = new THREE.MeshStandardMaterial({
      color: '#00f0ff',
      emissive: '#0088aa',
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8
    });
    this.grabBarMesh = new THREE.Mesh(barGeo, barMat);
    this.grabBarMesh.name = 'VRDashMenuGrabBar';
    this.grabBarMesh.userData.isVisibleGrabBar = true;
    this.group.add(this.grabBarMesh);

    // Larger invisible hit-proxy so the grab bar is easy to grab even
    // from a slightly off-axis aim. The proxy's `isGrabHitProxy` flag
    // lets future tooling identify the proxy, but the parent-walk in
    // App.tsx's right-grip handler resolves to `grabBarMesh` directly.
    const grabProxyGeo = new THREE.BoxGeometry(1.4, 0.30, 0.16);
    const grabProxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const grabProxy = new THREE.Mesh(grabProxyGeo, grabProxyMat);
    grabProxy.name = 'VRDashMenuGrabProxy';
    grabProxy.userData.isGrabHitProxy = true;
    this.grabBarMesh.add(grabProxy);
    const barPosY = -height / 2 - 0.06;
    this.grabBarMesh.position.set(0, barPosY, 0);

    // ---- Construct panel sibling mesh ----
    this.panelGroup = new THREE.Group();
    this.panelGroup.name = 'VRPanelGroup';
    this.panelGroup.visible = false;
    this.scene.add(this.panelGroup);

    this.panelCanvas = document.createElement('canvas');
    // 4:3 aspect (slightly wider than dash's 16:10) gives mainline
    // desktop-style layout flexibility — most React modal contents are
    // vertical-scrolling lists which translate cleanly to 4:3 cards.
    this.panelCanvas.width = 1024;
    this.panelCanvas.height = 768;
    const panelContext = this.panelCanvas.getContext('2d');
    if (!panelContext) throw new Error('Failed to get 2D context for VR Panel');
    this.panelCtx = panelContext;

    this.panelTexture = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTexture.colorSpace = THREE.SRGBColorSpace;

    // Panel curved screen — wider/taller than the dash (1.8m × 1.2m)
    // so content has generous card grid space. Same "bend along a
    // cylinder" technique as the dash so UV mapping is consistent.
    const pWidth = 1.8;
    const pHeight = 1.2;
    const pRadius = 2.0;
    const pPlaneGeo = new THREE.PlaneGeometry(pWidth, pHeight, 32, 16);
    const pPosAttr = pPlaneGeo.attributes.position;
    for (let i = 0; i < pPosAttr.count; i++) {
      const x = pPosAttr.getX(i);
      const y = pPosAttr.getY(i);
      const angle = x / pRadius;
      const newX = Math.sin(angle) * pRadius;
      const newZ = (1 - Math.cos(angle)) * pRadius;
      pPosAttr.setXYZ(i, newX, y, -newZ);
    }
    pPlaneGeo.computeVertexNormals();

    const pScreenMat = new THREE.MeshBasicMaterial({
      map: this.panelTexture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96
    });
    this.panelMesh = new THREE.Mesh(pPlaneGeo, pScreenMat);
    this.panelMesh.name = 'VRPanelScreen';
    this.panelGroup.add(this.panelMesh);

    // Panel grab bar (sibling of dash's grabBarMesh; same color language
    // as the system-card purple to telegraph "this is a system panel").
    const pBarGeo = new THREE.BoxGeometry(0.7, 0.10, 0.04);
    const pBarMat = new THREE.MeshStandardMaterial({
      color: '#a855f7',
      emissive: '#7c3aed',
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8
    });
    this.panelGrabBarMesh = new THREE.Mesh(pBarGeo, pBarMat);
    this.panelGrabBarMesh.name = 'VRPanelGrabBar';
    this.panelGrabBarMesh.userData.isVisibleGrabBar = true;
    this.panelGroup.add(this.panelGrabBarMesh);

    const pGrabProxyGeo = new THREE.BoxGeometry(1.5, 0.30, 0.16);
    const pGrabProxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const pGrabProxy = new THREE.Mesh(pGrabProxyGeo, pGrabProxyMat);
    pGrabProxy.name = 'VRPanelGrabProxy';
    pGrabProxy.userData.isGrabHitProxy = true;
    this.panelGrabBarMesh.add(pGrabProxy);

    const pBarPosY = -pHeight / 2 - 0.06;
    this.panelGrabBarMesh.position.set(0, pBarPosY, 0);
  }

  // ===========================================================================
  // Dash Menu existing API (unchanged surface)
  // ===========================================================================

  public setItems(items: InventoryItem[]): void {
    this.items = items;
    if (this.isVisible) {
      this.renderCanvas();
    }
  }

  public show(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    this.group.visible = true;

    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    this.camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();

    this.group.position.copy(camPos).add(camDir.clone().multiplyScalar(1.5));
    this.group.position.y = camPos.y;
    this.group.lookAt(camPos.x, this.group.position.y, camPos.z);

    this.renderCanvas();
  }

  public hide(): void {
    this.isVisible = false;
    this.group.visible = false;
    this.onCloseCallback();
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Reparent `this.group` to a controller grip space so the user can
   * physically carry the HUD around in VR.
   */
  public attachToGrip(gripSpace: THREE.Object3D): void {
    this.currentGrip = gripSpace;
    gripSpace.attach(this.group);
  }

  /**
   * Counterpart to `attachToGrip`: pull the HUD back off the
   * controller and reparent it to the scene at its current world pose.
   */
  public detach(): void {
    if (!this.currentGrip) return;
    this.currentGrip = null;
    this.scene.attach(this.group);
  }

  public renderCanvas(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 32px Outfit, sans-serif';
    ctx.fillText('NEXUS VR - CURVED DASH MENU', 30, 50);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px Outfit, sans-serif';
    ctx.fillText('Aim controller at cards to Spawn or Equip. Grab bottom cyan bar to reposition screen.', 30, 80);

    // Close Button Top Right
    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.fillRect(w - 100, 20, 80, 40);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(w - 100, 20, 80, 40);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 20px Outfit, sans-serif';
    ctx.fillText('CLOSE', w - 85, 47);

    const cols = 5;
    const cardW = 170;
    const cardH = 140;
    const startX = 35;
    const startY = 110;
    const gapX = 20;
    const gapY = 20;

    // 8 system cards + 5 default primitives = 13 cards; we slice to
    // top 15 to fill up to 3 rows. Anything past the 15th is hidden
    // (the user can scroll via the inventory panel for the full list).
    const systemItems = VRHUDManager.SYSTEM_CARDS.map((c) => ({ ...c, createdAt: 0, type: 'system' as const }));

    const defaultPrims: InventoryItem[] = [
      { id: 'prim-cube', name: 'Cube Shape', type: 'primitive', primitiveType: 'cube', createdAt: Date.now() },
      { id: 'prim-sphere', name: 'Sphere Shape', type: 'primitive', primitiveType: 'sphere', createdAt: Date.now() },
      { id: 'prim-cylinder', name: 'Cylinder Shape', type: 'primitive', primitiveType: 'cylinder', createdAt: Date.now() },
      { id: 'prim-torus', name: 'Torus Shape', type: 'primitive', primitiveType: 'torus', createdAt: Date.now() },
      { id: 'prim-cone', name: 'Cone Shape', type: 'primitive', primitiveType: 'cone', createdAt: Date.now() }
    ];

    const displayItems = [...systemItems, ...defaultPrims, ...this.items].slice(0, 15);

    displayItems.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);

      ctx.fillStyle = item.type === 'system' ? 'rgba(168, 85, 247, 0.18)' :
                      item.type === 'tool' ? 'rgba(245, 158, 11, 0.15)' :
                                             'rgba(30, 41, 59, 0.8)';
      ctx.fillRect(x, y, cardW, cardH);

      ctx.strokeStyle = item.type === 'system' ? '#a855f7' :
                        item.type === 'tool' ? '#f59e0b' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cardW, cardH);

      ctx.fillStyle = item.type === 'system' ? '#a855f7' :
                      item.type === 'tool' ? '#f59e0b' : '#38bdf8';
      ctx.font = 'bold 12px monospace';
      const badgeText = item.type === 'system' ? `SYS: ${item.id.replace(/^sys-/, '').toUpperCase()}` :
                        item.type === 'tool' ? `TOOL: ${item.toolType || 'DEV'}` :
                        item.type === 'primitive' ? `SHAPE: ${item.primitiveType || 'CUBE'}` : item.type.toUpperCase();
      ctx.fillText(badgeText.toUpperCase(), x + 12, y + 25);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Outfit, sans-serif';
      const name = item.name.length > 15 ? item.name.slice(0, 14) + '...' : item.name;
      ctx.fillText(name, x + 12, y + 60);

      ctx.fillStyle = item.type === 'system' ? '#a855f7' :
                      item.type === 'tool'   ? '#f59e0b' :
                                                '#00f0ff';
      ctx.fillRect(x + 12, y + 90, cardW - 24, 34);

      ctx.fillStyle = '#000000';
      ctx.font = 'bold 14px Outfit, sans-serif';
      const btnText = item.type === 'system' ? 'OPEN' :
                      item.type === 'tool'   ? 'EQUIP TOOL' :
                      item.type === 'vrm'    ? 'EQUIP AVATAR' :
                                                'SPAWN';
      ctx.fillText(btnText, x + 35, y + 112);
    });

    this.texture.needsUpdate = true;
  }

  /**
   * Handle VR Raycast interactions (Trigger pull / Click). Routing order:
   *   1. If a panel is active, dispatch UV to the panel's polar hit-test
   *      (for `sys-radial`) or to the panel button registry.
   *   2. Otherwise dispatch to the dash menu's card grid.
   * The same UV→canvas-pixel mapping works for both because both meshes
   * are PlaneGeometry with cylindrical vertex deformation — the UV
   * coordinates are independent of the deformation.
   */
  public handleRayIntersection(uv: THREE.Vector2): void {
    // Either the dash menu OR an active panel must be visible for any
    // hit-test to fire. Without the second clause, a panel-only state
    // (dash hidden, panel showing) would early-return before reading the
    // panel's hit-test, making the panel poster-only.
    if (!this.isVisible && !this.activePanel) return;

    // === Panel hit-test (activePanel) ===
    if (this.activePanel) {
      const x = uv.x * this.panelCanvas.width;
      const y = (1 - uv.y) * this.panelCanvas.height; // Flip Y for canvas coords

      // === Polar hit-test for the radial panel ===
      // The radial panel is more naturally hit-tested in polar coords
      // (angle + radius from the panel center) than via the rectangular
      // clickable registry. We use the EXACT center that drawRadialPanel
      // just rendered to (stored in `_radialCenter`), so the visual
      // slices and the hit-test can never drift apart.
      if (this.activePanel === 'sys-radial' && this._radialCenter) {
        const c = this._radialCenter;
        const dx = x - c.x;
        const dy = y - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= c.hubR) {
          // Center hub → tab swap (handled internally by runPanelAction).
          this.runPanelAction('radial:tab');
          return;
        }
        if (dist >= c.rIn && dist <= c.rOut) {
          // CW-from-top angle in degrees, same formula as the desktop
          // RadialContextMenu's hover detection. Slices' angle ranges
          // match the desktop's exactly (Undo -67..-5, Redo 5..67,
          // Right 77..139, Bottom 149..211, Left 221..283).
          let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
          if (angleDeg > 290) angleDeg -= 360;
          else if (angleDeg < -70) angleDeg += 360;
          if (angleDeg >= -67 && angleDeg <=  -5) { this.runPanelAction('radial:undo');   return; }
          if (angleDeg >=   5 && angleDeg <=  67) { this.runPanelAction('radial:redo');   return; }
          if (angleDeg >=  77 && angleDeg <= 139) { this.runPanelAction('radial:right');  return; }
          if (angleDeg >= 149 && angleDeg <= 211) { this.runPanelAction('radial:bottom'); return; }
          if (angleDeg >= 221 && angleDeg <= 283) { this.runPanelAction('radial:left');   return; }
          // Click was on the ring but in a gap between slices — the
          // user clearly meant the radial, so silently drop the click
          // (don't fall through to BACK/CLOSE, that would be confusing).
          return;
        }
        // Click was OUTSIDE the ring — fall through to the
        // rectangular hit-test below so BACK/CLOSE buttons (and any
        // other panel chrome) remain clickable while the radial panel
        // is open. Without this fall-through, the radial panel would
        // be uncloseable via the standard chrome and the user would
        // have to use the grip-grab workaround to dismiss it.
      }

      // === Rectangular hit-test for the rest of the panel system ===
      for (const btn of this.panelClickables) {
        if (x >= btn.rect.x && x <= btn.rect.x + btn.rect.w &&
            y >= btn.rect.y && y <= btn.rect.y + btn.rect.h) {
          if (btn.action === 'back' || btn.action === 'close') {
            this.closePanel();
            return;
          }
          // Built-in panel actions that don't need to leave the manager
          const builtIn = this.runPanelAction(btn.action);
          if (builtIn) return;
          // Up to App.tsx via the action callback
          this.onPanelAction?.(btn.action);
          return;
        }
      }
      return; // No button hit, but panel stays open
    }

    // === Dash menu hit-test (existing behavior) ===
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;

    if (x >= this.canvas.width - 100 && x <= this.canvas.width - 20 && y >= 20 && y <= 60) {
      this.hide();
      return;
    }

    const cols = 5;
    const cardW = 170;
    const cardH = 140;
    const startX = 35;
    const startY = 110;
    const gapX = 20;
    const gapY = 20;

    const systemItems = VRHUDManager.SYSTEM_CARDS.map((c) => ({ ...c, createdAt: 0, type: 'system' as const }));

    const defaultPrims: InventoryItem[] = [
      { id: 'prim-cube', name: 'Cube Shape', type: 'primitive', primitiveType: 'cube', createdAt: Date.now() },
      { id: 'prim-sphere', name: 'Sphere Shape', type: 'primitive', primitiveType: 'sphere', createdAt: Date.now() },
      { id: 'prim-cylinder', name: 'Cylinder Shape', type: 'primitive', primitiveType: 'cylinder', createdAt: Date.now() },
      { id: 'prim-torus', name: 'Torus Shape', type: 'primitive', primitiveType: 'torus', createdAt: Date.now() },
      { id: 'prim-cone', name: 'Cone Shape', type: 'primitive', primitiveType: 'cone', createdAt: Date.now() }
    ];

    const displayItems = [...systemItems, ...defaultPrims, ...this.items].slice(0, 15);

    displayItems.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const cardX = startX + col * (cardW + gapX);
      const cardY = startY + row * (cardH + gapY);

      if (x >= cardX && x <= cardX + cardW && y >= cardY && y <= cardY + cardH) {
        // For system items, route to the matching 3D panel (openPanel).
        // For non-system items, fall through to the spawn callback.
        // This is the fix for the VR bug where system cards were
        // spawning a 3D object instead of opening the system panel.
        if (item.type === 'system') {
          this.openPanel(item.id);
        } else {
          this.onSpawnCallback(item);
        }
        this.hide();
      }
    });
  }

  // ===========================================================================
  // VR Panel API
  // ===========================================================================

  /**
   * Open a system panel by id. Switches the panel mesh on, hides the
   * dash menu (so the user's gaze has only ONE thing in focus — either
   * the dash OR a system panel), positions the panel next to the dash
   * when the dash is open (otherwise centers it in front of the camera),
   * and renders the panel content via the matching registered drawer.
   */
  public openPanel(panelId: string): void {
    if (!this.panelDrawers.has(panelId)) {
      console.warn(`[VRPanel] no drawer registered for panelId="${panelId}"`);
      return;
    }

    // Hide dash so the user gets either-or focus, not both. Record the
    // pre-hide visibility so closePanel() can restore it on BACK/CLOSE
    // — the user expects "back to the dash" semantics, not "back to
    // empty space".
    this._wasDashVisibleBeforePanel = this.isVisible;
    if (this._wasDashVisibleBeforePanel) this.hide();

    // Position panel next to the dash menu when both would be visible
    // — we center it 0.95m to camera-right of the dash's path. When
    // dash was hidden, we just center the panel in the user's path.
    const camPos = new THREE.Vector3();
    const camQuat = this.camera.quaternion;
    this.camera.getWorldPosition(camPos);

    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    camForward.y = 0;
    camForward.normalize();
    const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

    const forwardDist = 1.6;
    const basePos = camPos.clone().addScaledVector(camForward, forwardDist);
    if (this._wasDashVisibleBeforePanel) {
      // Offset right so both can be visible side-by-side. 0.95m sits
      // beyond the dash's right edge but inside arm's reach.
      basePos.addScaledVector(camRight, 0.95);
    }
    this.panelGroup.position.copy(basePos);
    this.panelGroup.position.y = camPos.y;
    // lookAt rotates the panel group so the screen faces the camera;
    // the curved plane's outward normal tracks the camera-to-position axis.
    this.panelGroup.lookAt(camPos.x, this.panelGroup.position.y, camPos.z);

    this.activePanel = panelId;
    this.panelGroup.visible = true;
    this.redrawPanel();
  }

  /** Close the active panel and unhide the dash if it was visible before. */
  public closePanel(): void {
    const wasActive = this.activePanel !== null;
    this.activePanel = null;
    this.panelGroup.visible = false;
    this.panelClickables = [];
    this._radialCenter = null;
    // Restore the dash only if it was visible when the user opened this
    // panel. The flag is local-state; it's reset by the next openPanel()
    // call, so the user can chain panels (open → close → open different
    // panel) without leaking or reverting incorrectly.
    if (wasActive && this._wasDashVisibleBeforePanel) {
      this.show();
    }
  }

  /**
   * Push fresh live state. Triggers `redrawPanel` only if a panel is
   * active so we don't waste cycles drawing the canvas every render
   * when no panel is showing. Called from App.tsx via useEffect that
   * depends on the relevant state slice.
   */
  public setDataContext(ctx: PanelContext): void {
    this.panelDataCtx = ctx;
    if (this.activePanel) this.redrawPanel();
  }

  /**
   * Re-parent the panel mesh to a controller grip so the user can
   * physically carry the system panel around (parallel to dash's
   * attachToGrip).
   */
  public attachPanelToGrip(gripSpace: THREE.Object3D): void {
    this.panelCurrentGrip = gripSpace;
    gripSpace.attach(this.panelGroup);
  }

  /** Counterpart: pull the panel back off the grip onto the scene at its current world pose. */
  public detachPanel(): void {
    if (!this.panelCurrentGrip) return;
    this.panelCurrentGrip = null;
    this.scene.attach(this.panelGroup);
  }

  /**
   * Redraw the active panel by running its drawer against fresh state.
   * Public so App.tsx's `inspect.*` action dispatchers can force a redraw
   * synchronously after applying a mutation (otherwise the redraw
   * piggybacks on the next setDataContext cycle, which lags the user's
   * click on the order of one React render).
   */
  public redrawPanel(): void {
    if (!this.activePanel) return;
    const drawer = this.panelDrawers.get(this.activePanel);
    if (!drawer) return;

    const w = this.panelCanvas.width;
    const h = this.panelCanvas.height;
    const ctx = this.panelCtx;

    // Reset the clickable registry at the start of every draw. Stale
    // rectangles from a previous drawer run could otherwise fire on
    // a click that no longer has a matching rect in the new content.
    this.panelClickables = [];
    // The radial panel re-publishes its center on every redraw so the
    // polar hit-test always matches the rendered slice geometry.
    if (this.activePanel !== 'sys-radial') this._radialCenter = null;
    ctx.clearRect(0, 0, w, h);

    // Glass background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(0, 0, w, h);

    const fallback: PanelContext = {
      inventoryItems: [],
      chatMessages: [],
      graphicsSettings: VRHUDManager.fallbackGraphics,
      performanceStats: VRHUDManager.fallbackStats,
      environmentSettings: VRHUDManager.fallbackEnvironment,
      roomInfo: { mode: 'offline', roomId: null },
      selectedAsset: null,
      sceneRoot: null,
      cameraState: { mode: 'first-person', slowMovement: false, locomotionMode: 'walk' },
      scalingEnabled: true,
      laserEnabled: true,
      grabMode: 'auto',
      users: [],
      isHeld: false
    };
    const data = this.panelDataCtx ?? fallback;

    const helper: PanelDrawHelper = {
      registerButton: (rect, action) => this.panelClickables.push({ rect, action }),
      drawStandardChrome: (title, subtitle, accent) => this.drawPanelChrome(ctx, w, h, title, subtitle, accent),
      getCanvasSize: () => ({ w, h })
    };

    try {
      drawer(ctx, w, h, helper, data);
    } catch (err) {
      console.warn('[VRPanel] drawer error:', err);
      // Recover by drawing a fallback message so the user always gets
      // SOMETHING even when the drawer throws.
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('Panel drawer error \u2014 see console', 30, h - 60);
    }

    this.panelTexture.needsUpdate = true;
  }

  /**
   * Standard chrome drawn at the top of every panel: outer border,
   * title + subtitle, BACK + CLOSE buttons. Returns the Y at which
   * content body should start.
   */
  private drawPanelChrome(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    title: string,
    subtitle: string,
    accent: string
  ): number {
    // Outer + inset borders
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    // Title
    ctx.fillStyle = accent;
    ctx.font = 'bold 38px "Outfit", sans-serif';
    ctx.fillText(title, 30, 58);

    // Subtitle
    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px "Outfit", sans-serif';
    ctx.fillText(subtitle, 30, 88);

    // BACK button
    ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.fillRect(30, 108, 130, 44);
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2;
    ctx.strokeRect(30, 108, 130, 44);
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 18px sans-serif';
    ctx.fillText('\u2190 BACK', 50, 137);
    this.panelClickables.push({ rect: { x: 30, y: 108, w: 130, h: 44 }, action: 'back' });

    // CLOSE button (top-right)
    ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
    ctx.fillRect(w - 150, 108, 120, 44);
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
    ctx.strokeRect(w - 150, 108, 120, 44);
    ctx.fillStyle = '#fecaca'; ctx.font = 'bold 18px sans-serif';
    ctx.fillText('CLOSE', w - 130, 137);
    this.panelClickables.push({ rect: { x: w - 150, y: 108, w: 120, h: 44 }, action: 'close' });

    return 180; // body Y
  }

  /**
   * Run a panel action that doesn't need to cross the App.tsx boundary.
   * The action string encodes panel attribute and command in a
   * colon-separated format, e.g. `settings.resScale:1.5`. Returns true
   * if the action was handled (so handleRayIntersection can early-out
   * without falling through to `onPanelAction`).
   */
  private runPanelAction(action: string): boolean {
    if (action === 'back' || action === 'close') {
      this.closePanel();
      return true;
    }
    if (action.startsWith('sys.open:')) {
      const target = action.substring('sys.open:'.length);
      this.openPanel(target);
      return true;
    }
    // Tab flip on the radial panel center hub is a built-in so the
    // user can browse slices without bouncing through App.tsx. The
    // per-slice actions (undo/redo/loco/scale/laser/grabmode) still
    // route up via onPanelAction because they mutate React state.
    if (action === 'radial:tab') {
      // 3-way cycle when carrying an object: general → grab → held → general.
      // 2-way cycle when not carrying: general → grab → general. Mirrors
      // the desktop RadialContextMenu's hub click so both UIs behave the
      // same way. setRadialTab also guards against landing on 'held' when
      // isHeld has flipped to false since the last click.
      if (this.panelDataCtx?.isHeld) {
        const next: 'general' | 'grab' | 'held' =
          this._radialTab === 'general' ? 'grab' :
          this._radialTab === 'grab' ? 'held' : 'general';
        this.setRadialTab(next);
      } else {
        this.setRadialTab(this._radialTab === 'general' ? 'grab' : 'general');
      }
      return true;
    }
    // Chat alphabet button: append single char to the typing buffer.
    // Each letter / number dispatches 'chat.append:<c>' from the panel
    // canvas; we mutate the buffer in-place and redraw so the
    // intermediate buffers never round-trip through App.tsx.
    // Limited to single ASCII printable chars so the buffer stays
    // sanitised (no newlines, no control codes).
    if (action.startsWith('chat.append:')) {
      const ch = action.substring('chat.append:'.length);
      if (ch.length === 1 && ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e) {
        if (this._chatInputBuffer.length < 200) {
          this._chatInputBuffer += ch;
        }
        this.redrawPanel();
      }
      return true;
    }
    if (action === 'chat.backspace') {
      this._chatInputBuffer = this._chatInputBuffer.slice(0, -1);
      this.redrawPanel();
      return true;
    }
    if (action === 'chat.clear') {
      this._chatInputBuffer = '';
      this.redrawPanel();
      return true;
    }
    if (action === 'chat.send') {
      const text = this._chatInputBuffer.trim();
      if (text.length > 0) {
        // Bubble up via the colon-separated convention used by every
        // other panel action; App.tsx's onPanelAction strips the
        // 'chat.send:' prefix and forwards to networkService.
        this._chatInputBuffer = '';
        this.onPanelAction?.('chat.send:' + text);
      }
      this.redrawPanel();
      return true;
    }
    // No other built-ins for v1; everything else routes up to App.tsx.
    return false;
  }

  // ===========================================================================
  // Built-in panel drawers
  // ===========================================================================
  // These are the "out-of-the-box" implementations. App.tsx can override
  // any of them by passing a drawer with the same panelId in the
  // `options.drawers` map at construction time.

  private registerBuiltinDrawers(): void {
    this.panelDrawers.set('sys-inventory', this.drawInventoryPanel.bind(this));
    this.panelDrawers.set('sys-settings',  this.drawSettingsPanel.bind(this));
    this.panelDrawers.set('sys-env',       this.drawEnvPanel.bind(this));
    this.panelDrawers.set('sys-share',     this.drawSharePanel.bind(this));
    this.panelDrawers.set('sys-pair',      this.drawPairPanel.bind(this));
    this.panelDrawers.set('sys-session',   this.drawSessionPanel.bind(this));
    this.panelDrawers.set('sys-inspector', this.drawInspectorPanel.bind(this));
    this.panelDrawers.set('sys-material',  this.drawMaterialPanel.bind(this));
    this.panelDrawers.set('sys-chat',      this.drawChatPanel.bind(this));
    // The radial context menu is a 3D panel in VR (the React DOM version
    // is invisible in pure immersive WebXR). 5 slices + center hub,
    // tab swap on hub click. Polar hit-test in handleRayIntersection
    // dispatches the click to the matching slice action.
    this.panelDrawers.set('sys-radial',    this.drawRadialPanel.bind(this));
  }

  /** Inventory panel: lists saved items in a card grid; SPAWN/EQUIP buttons mutate React via App.tsx. */
  private drawInventoryPanel(
    ctx: CanvasRenderingContext2D,
    _w: number,
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome('INVENTORY STORAGE', 'Spawn saved items into your world', '#a855f7');
    const items = data.inventoryItems;

    if (items.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '20px sans-serif';
      ctx.fillText('No items yet. Add some from the desktop Inventory modal.', 40, bodyTop + 60);
      ctx.fillText('Spawned primitives and tools will appear here.', 40, bodyTop + 90);
      return;
    }

    const cols = 4;
    const cardW = 230;
    const cardH = 220;
    const gapX = 12;
    const gapY = 28;
    const startX = 30;
    const startY = bodyTop + 8;

    items.slice(0, 9).forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);

      const accent = item.type === 'tool' ? '#f59e0b' :
                     item.type === 'vrm'  ? '#a855f7' :
                                            '#38bdf8';
      const accentFill = item.type === 'tool' ? 'rgba(245, 158, 11, 0.16)' :
                        item.type === 'vrm'  ? 'rgba(168, 85, 247, 0.16)' :
                                               'rgba(30, 41, 59, 0.85)';

      ctx.fillStyle = accentFill;
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cardW, cardH);

      ctx.fillStyle = accent;
      ctx.font = 'bold 11px monospace';
      const badgeText = item.type === 'tool' ? `TOOL: ${(item.toolType || 'DEV').toUpperCase()}` :
                        item.type === 'primitive' ? `SHAPE: ${(item.primitiveType || 'CUBE').toUpperCase()}` :
                        item.type === 'vrm' ? 'AVATAR \u00b7 VRM' :
                        item.type === '3d-model' ? 'MODEL \u00b7 3D' :
                        'ASSET';
      ctx.fillText(badgeText, x + 12, y + 22);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px sans-serif';
      const name = item.name.length > 18 ? item.name.slice(0, 17) + '\u2026' : item.name;
      ctx.fillText(name, x + 12, y + 54);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px sans-serif';
      const subInfo = item.type === 'primitive' ? `id: ${item.id.slice(-6)}` :
                      item.metadata?.description
                        ? (item.metadata.description.length > 40
                            ? item.metadata.description.slice(0, 39) + '\u2026'
                            : item.metadata.description)
                        : 'Stored asset';
      ctx.fillText(subInfo, x + 12, y + 78);

      const btnText = item.type === 'tool' ? 'EQUIP TOOL' :
                      item.type === 'vrm' ? 'EQUIP AVATAR' : 'SPAWN';
      const btnY = y + cardH - 54;
      helper.registerButton({ x: x + 12, y: btnY, w: cardW - 24, h: 40 }, `inv.spawn:${item.id}`);
      ctx.fillStyle = accent;
      ctx.fillRect(x + 12, btnY, cardW - 24, 40);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(btnText, x + 28, btnY + 25);
    });
  }

  /** Settings panel: graphics + scope to top-level macros in VR (skip complex LOD sliders). */
  private drawSettingsPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome('GRAPHICS SETTINGS', 'Three.js rendering, shadows, anti-aliasing', '#00f0ff');
    const g = data.graphicsSettings;
    const s = data.performanceStats;

    // Performance strip
    const stripX = 40, stripY = bodyTop, stripW = w - 80, stripH = 78;
    ctx.fillStyle = 'rgba(15,23,42,0.7)';
    ctx.fillRect(stripX, stripY, stripW, stripH);
    ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 1;
    ctx.strokeRect(stripX, stripY, stripW, stripH);

    const fpsColor = s.fps >= 50 ? '#34d399' : s.fps >= 30 ? '#fbbf24' : '#fb7185';
    const drawCol = (label: string, value: string, x: number, color: string) => {
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif';
      ctx.fillText(label, x, stripY + 22);
      ctx.fillStyle = color; ctx.font = 'bold 26px monospace';
      ctx.fillText(value, x, stripY + 60);
    };
    drawCol('FPS', String(s.fps), stripX + 30, fpsColor);
    drawCol('DRAW CALLS', String(s.drawCalls), stripX + 250, '#cbd5e1');
    drawCol('TRIANGLES', (s.triangles / 1000).toFixed(1) + 'k', stripX + 510, '#cbd5e1');

    // Resolution Scale row
    const rowY = stripY + stripH + 38;
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText('RESOLUTION SCALE', 40, rowY);
    const resScales: Array<number> = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    resScales.forEach((scale, i) => {
      const x = 280 + i * 92;
      const y = rowY - 24;
      const isActive = Math.abs(g.resolutionScale - scale) < 0.01;
      ctx.fillStyle = isActive ? 'rgba(0,240,255,0.28)' : 'rgba(30,41,59,0.7)';
      ctx.fillRect(x, y, 82, 32);
      ctx.strokeStyle = isActive ? '#00f0ff' : '#475569'; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 82, 32);
      ctx.fillStyle = isActive ? '#06b6d4' : '#cbd5e1';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(scale + 'x', x + 24, y + 22);
      helper.registerButton({ x, y, w: 82, h: 32 }, `settings.resScale:${scale}`);
    });

    // Shadow Quality row
    const sqY = rowY + 50;
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText('SHADOW QUALITY', 40, sqY);
    const sqs: Array<'off' | 'low' | 'medium' | 'high' | 'ultra'> = ['off', 'low', 'medium', 'high', 'ultra'];
    sqs.forEach((q, i) => {
      const x = 280 + i * 92;
      const y = sqY - 24;
      const isActive = g.shadowQuality === q;
      ctx.fillStyle = isActive ? 'rgba(168,85,247,0.28)' : 'rgba(30,41,59,0.7)';
      ctx.fillRect(x, y, 82, 32);
      ctx.strokeStyle = isActive ? '#a855f7' : '#475569'; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 82, 32);
      ctx.fillStyle = isActive ? '#c084fc' : '#cbd5e1';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(q.toUpperCase(), x + (q.length > 5 ? 8 : 18), y + 22);
      helper.registerButton({ x, y, w: 82, h: 32 }, `settings.shadow:${q}`);
    });

    // AA row
    const aaY = sqY + 50;
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText('ANTI-ALIASING', 40, aaY);
    const aas: Array<'none' | 'fxaa' | 'msaa'> = ['none', 'fxaa', 'msaa'];
    aas.forEach((aa, i) => {
      const x = 280 + i * 132;
      const y = aaY - 24;
      const isActive = g.antiAliasing === aa;
      ctx.fillStyle = isActive ? 'rgba(244,114,182,0.28)' : 'rgba(30,41,59,0.7)';
      ctx.fillRect(x, y, 122, 32);
      ctx.strokeStyle = isActive ? '#f472b6' : '#475569'; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 122, 32);
      ctx.fillStyle = isActive ? '#f9a8d4' : '#cbd5e1';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(aa.toUpperCase(), x + 36, y + 22);
      helper.registerButton({ x, y, w: 122, h: 32 }, `settings.aa:${aa}`);
    });

    // Progressive LOD toggle
    const lodY = aaY + 50;
    const isLod = !!g.progressiveLOD;
    ctx.fillStyle = isLod ? 'rgba(16,185,129,0.28)' : 'rgba(30,41,59,0.7)';
    ctx.fillRect(40, lodY - 24, 420, 32);
    ctx.strokeStyle = isLod ? '#10b981' : '#475569'; ctx.lineWidth = 2;
    ctx.strokeRect(40, lodY - 24, 420, 32);
    ctx.fillStyle = isLod ? '#34d399' : '#cbd5e1';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`PROGRESSIVE LOD: ${isLod ? 'ON' : 'OFF'}`, 60, lodY - 2);
    helper.registerButton({ x: 40, y: lodY - 24, w: 420, h: 32 }, `settings.progressiveLod:toggle`);
  }

  /** Env panel: 4 atmosphere presets + grid visibility toggle + lighting read-out. */
  private drawEnvPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome('WORLD ENVIRONMENT', 'Skybox, lighting, and grid', '#00f0ff');
    const e = data.environmentSettings;

    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText('ATMOSPHERE', 40, bodyTop + 28);

    const presets = [
      { id: 'cyber-nebula',    name: 'Cyber Nebula',    desc: 'Neon cyberpunk sky' },
      { id: 'sunset-horizon',  name: 'Sunset Twilight', desc: 'Warm orange horizon' },
      { id: 'studio-neutral',  name: 'Studio Bright',   desc: 'Neutral inspection' },
      { id: 'starfield-space', name: 'Deep Starfield',  desc: 'Star particle void' },
      { id: 'passthrough',     name: 'Mixed Reality',   desc: 'Passthrough (Quest 3)' },
    ];
    const cols = 2;
    const cardW = (w - 100) / 2;
    const cardH = 90;
    presets.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 40 + col * (cardW + 20);
      const y = bodyTop + 50 + row * (cardH + 16);
      const isActive = e.atmosphere === p.id;
      ctx.fillStyle = isActive ? 'rgba(0,240,255,0.20)' : 'rgba(30,41,59,0.7)';
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeStyle = isActive ? '#00f0ff' : '#475569'; ctx.lineWidth = isActive ? 3 : 2;
      ctx.strokeRect(x, y, cardW, cardH);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px sans-serif';
      ctx.fillText(p.name, x + 16, y + 32);
      ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif';
      ctx.fillText(p.desc, x + 16, y + 60);
      helper.registerButton({ x, y, w: cardW, h: cardH }, `env.atmosphere:${p.id}`);
    });

    // Lighting read-out
    const rowsCount = Math.ceil(presets.length / cols);
    const lightsY = bodyTop + 50 + rowsCount * (cardH + 16) + 14;
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText('LIGHTING (read-only in VR)', 40, lightsY);
    ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif';
    ctx.fillText(`Ambient: ${e.ambientIntensity.toFixed(1)}x`, 40, lightsY + 24);
    ctx.fillText(`Sun: ${e.dirLightIntensity.toFixed(1)}x`, 240, lightsY + 24);
    ctx.fillText('Fine-tune sliders via desktop modal.', 460, lightsY + 24);

    // Grid Visibility
    const gridY = lightsY + 50;
    ctx.fillStyle = e.gridVisible ? 'rgba(168,85,247,0.28)' : 'rgba(30,41,59,0.7)';
    ctx.fillRect(40, gridY, 320, 36);
    ctx.strokeStyle = e.gridVisible ? '#a855f7' : '#475569'; ctx.lineWidth = 2;
    ctx.strokeRect(40, gridY, 320, 36);
    ctx.fillStyle = e.gridVisible ? '#c084fc' : '#cbd5e1';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`GRID: ${e.gridVisible ? 'ON' : 'OFF'}`, 60, gridY + 24);
    helper.registerButton({ x: 40, y: gridY, w: 320, h: 36 }, `env.grid:toggle`);

    // Grid size selector (read-only)
    ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif';
    ctx.fillText(`Size: ${e.gridSize.replace('-', ' ')}`, 380, gridY + 24);
    ctx.fillText(`Color: ${e.gridColor}`, 560, gridY + 24);
  }

  /** Share panel: room status + connect/disconnect actions. */
  private drawSharePanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome('SHARE & COLLABORATE', 'Invite peers to your world', '#00f0ff');
    const r = data.roomInfo;
    const isOnline = r.mode === 'online';

    // Status card
    ctx.fillStyle = isOnline ? 'rgba(16,185,129,0.25)' : 'rgba(30,41,59,0.85)';
    ctx.fillRect(40, bodyTop + 10, w - 80, 100);
    ctx.strokeStyle = isOnline ? '#10b981' : '#475569'; ctx.lineWidth = 2;
    ctx.strokeRect(40, bodyTop + 10, w - 80, 100);

    ctx.fillStyle = isOnline ? '#34d399' : '#94a3b8';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(isOnline ? 'CONNECTED' : 'OFFLINE / SOLO', 60, bodyTop + 50);

    if (isOnline) {
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px monospace';
      ctx.fillText(`Room: ${r.roomId || '----'}`, 60, bodyTop + 90);
      if (typeof r.peerCount === 'number') {
        ctx.fillStyle = '#94a3b8'; ctx.font = '14px sans-serif';
        ctx.fillText(`${r.peerCount} peer${r.peerCount === 1 ? '' : 's'} connected`, 500, bodyTop + 90);
      }
    } else {
      ctx.fillStyle = '#94a3b8'; ctx.font = '14px sans-serif';
      ctx.fillText('Tap CREATE RANDOM ROOM to host a session others can join.', 60, bodyTop + 90);
    }

    // Action button row
    const actY = bodyTop + 130;
    if (isOnline) {
      helper.registerButton({ x: 40, y: actY, w: 320, h: 50 }, 'share:disconnect');
      ctx.fillStyle = 'rgba(239,68,68,0.28)'; ctx.fillRect(40, actY, 320, 50);
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.strokeRect(40, actY, 320, 50);
      ctx.fillStyle = '#fecaca'; ctx.font = 'bold 18px sans-serif';
      ctx.fillText('DISCONNECT', 130, actY + 32);
    } else {
      helper.registerButton({ x: 40, y: actY, w: 320, h: 50 }, 'share:joinRandom');
      ctx.fillStyle = 'rgba(0,240,255,0.28)'; ctx.fillRect(40, actY, 320, 50);
      ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2; ctx.strokeRect(40, actY, 320, 50);
      ctx.fillStyle = '#06b6d4'; ctx.font = 'bold 18px sans-serif';
      ctx.fillText('CREATE RANDOM ROOM', 80, actY + 32);
    }

    // QR placeholder
    const qrSize = 110;
    const qrX = w - qrSize - 40;
    const qrY = actY + 4;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(qrX, qrY, qrSize, qrSize);
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.strokeRect(qrX, qrY, qrSize, qrSize);
    ctx.fillStyle = '#0f172a'; ctx.font = '11px sans-serif';
    ctx.fillText('see desktop', qrX + 16, qrY + 30);
    ctx.fillText('Share modal', qrX + 14, qrY + 46);
    ctx.fillText('for QR code', qrX + 12, qrY + 62);

    ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif';
    ctx.fillText('Desktop modal hosts live QR + URL.', 40, actY + 80);
  }

  /** Pair panel: pairing-mode info + host button. */
  private drawPairPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    helper: PanelDrawHelper,
    _data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome('PAIR COMPANION', 'Connect a Quest or mobile device', '#a855f7');

    ctx.fillStyle = 'rgba(168,85,247,0.15)';
    ctx.fillRect(40, bodyTop + 10, w - 80, 110);
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
    ctx.strokeRect(40, bodyTop + 10, w - 80, 110);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText('PAIRING MODE', 60, bodyTop + 50);
    ctx.fillStyle = '#c084fc'; ctx.font = '14px sans-serif';
    ctx.fillText('Open the desktop Pair Companion tab for the live pair', 60, bodyTop + 84);
    ctx.fillText('code + QR (the live code is generated server-side).', 60, bodyTop + 104);

    helper.registerButton({ x: 40, y: bodyTop + 140, w: 320, h: 50 }, 'pair:host');
    ctx.fillStyle = 'rgba(168,85,247,0.28)'; ctx.fillRect(40, bodyTop + 140, 320, 50);
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2; ctx.strokeRect(40, bodyTop + 140, 320, 50);
    ctx.fillStyle = '#c084fc'; ctx.font = 'bold 18px sans-serif';
    ctx.fillText('START PAIRING HOST', 80, bodyTop + 172);

    ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif';
    ctx.fillText('Companion devices (Quest / mobile) sync assets and world state', 400, bodyTop + 154);
    ctx.fillText('without spawning a duplicate user avatar.', 400, bodyTop + 174);
  }

  /** Session panel: read-only status of network, locomotion, slow-walk. */
  private drawSessionPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome('SESSION & ROLES', 'Connection + camera state', '#a855f7');
    const r = data.roomInfo;
    const cc = data.cameraState;

    const rows: Array<[string, string, string]> = [
      ['CONNECTION', r.mode.toUpperCase(),               '#c084fc'],
      ['ROOM',        r.roomId || '\u2014',                   '#06b6d4'],
      ['PEERS',       typeof r.peerCount === 'number' ? String(r.peerCount) : '\u2014', '#94a3b8'],
      ['CAMERA',      cc.mode === 'first-person' ? 'First Person' : 'Orbit', '#94a3b8'],
      ['LOCOMOTION',  cc.locomotionMode.toUpperCase(),    '#34d399'],
      ['SLOW WALK',   cc.slowMovement ? 'ACTIVE (Z)' : 'OFF', cc.slowMovement ? '#fbbf24' : '#94a3b8'],
    ];
    rows.forEach(([label, value, color], i) => {
      const y = bodyTop + 30 + i * 44;
      ctx.fillStyle = 'rgba(30,41,59,0.6)'; ctx.fillRect(40, y, w - 80, 38);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.strokeRect(40, y, w - 80, 38);
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText(label, 60, y + 25);
      ctx.fillStyle = color; ctx.font = 'bold 15px sans-serif';
      ctx.fillText(value, 260, y + 25);
    });

    // USERS section: read-only list of connected users with role
    // badges. Same color language as the desktop DashMenu (admin=amber,
    // builder=emerald, moderator=blue, guest=purple, spectator=slate)
    // so the visual read transfers. Caps at 5 rows; a +N overflow
    // indicator tells the user to check the desktop for the full list.
    const users = data.users;
    const usersY = bodyTop + 30 + rows.length * 44 + 20;
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText('USERS', 40, usersY);
    if (users.length === 0) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif';
      ctx.fillText('No other users connected.', 40, usersY + 24);
    } else {
      const max = 5;
      const visible = users.slice(0, max);
      visible.forEach((u, i) => {
        const y = usersY + 40 + i * 40;
        ctx.fillStyle = u.isSelf ? 'rgba(168,85,247,0.18)' : 'rgba(30,41,59,0.6)';
        ctx.fillRect(40, y, w - 80, 34);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
        ctx.strokeRect(40, y, w - 80, 34);
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px sans-serif';
        const displayName = u.isSelf ? (u.name + ' (You)') : u.name;
        const truncated = displayName.length > 18 ? displayName.slice(0, 17) + '…' : displayName;
        ctx.fillText(truncated, 56, y + 22);
        // HOST tag (skip for self; user knows they are local) + role badge
        const tagX = w - 220;
        if (u.isHost && !u.isSelf) {
          ctx.fillStyle = 'rgba(245,158,11,0.25)';
          ctx.fillRect(tagX, y + 8, 64, 18);
          ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 10px sans-serif';
          ctx.fillText('HOST', tagX + 16, y + 21);
        }
        const roleColor =
          u.role === 'admin'     ? ['#fbbf24', 'rgba(245,158,11,0.20)'] :
          u.role === 'builder'   ? ['#34d399', 'rgba(16,185,129,0.20)'] :
          u.role === 'moderator' ? ['#60a5fa', 'rgba(59,130,246,0.20)'] :
          u.role === 'guest'     ? ['#c084fc', 'rgba(168,85,247,0.20)'] :
                                    ['#cbd5e1', 'rgba(100,116,139,0.20)'];
        const badgeX = (u.isHost && !u.isSelf) ? tagX + 72 : tagX;
        ctx.fillStyle = roleColor[1];
        ctx.fillRect(badgeX, y + 8, 110, 18);
        ctx.fillStyle = roleColor[0]; ctx.font = 'bold 10px sans-serif';
        ctx.fillText(u.role.toUpperCase(), badgeX + 12, y + 21);
      });
      if (users.length > max) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif';
        ctx.fillText('+' + (users.length - max) + ' more -- see desktop for the full list', 40, usersY + 40 + max * 40 + 4);
      }
    }
  }

  /**
   * Inspector panel: desktop-parity editor for the currently selected
   * asset. Layout (1024x768 canvas, top-down mirroring the right pane
   * of `SceneInspectorWindow.tsx`):
   *
   *   y=0..180   Standard chrome (BACK + CLOSE)
   *   y=190..254 SLOT HEADER  (name + JUMP / BRING / DESTROY)
   *   y=264..366 BASIC + HIERARCHY + PARENT
   *                 VISIBLE | ACTIVE | CYCLE RENAME
   *                 WRAP IN GROUP | ADD CHILD | PARENT TO WORLD
   *                 Current parent (read-only text)
   *   y=378..564 TRANSFORM    POS / ROT / SCL with [-] [+] [RESET] per
   *                           axis (3x3 grid of stepper cards), plus
   *                           a RESET ALL TRANSFORM and CENTER PIVOT
   *                           button at the bottom
   *   y=576..686 MESH STATS + DISPLAY
   *                           Counts (read-only) + Wireframe/FlatShading
   *                           toggles + Visible toggle (redundant with
   *                           Basic card, but matches desktop's
   *                           combined "Mesh Renderer" section)
   *   y=696..758 MATERIAL     R/G/B steppers + Roughness / Metalness /
   *                           Opacity / Emissive steppers + Reset All
   *
   * All field values are read-only display + stepper buttons;
   * direct text input isn't feasible in a 2D canvas at VR scale, so
   * the RENAME action cycles through a small preset list
   * (A,B,C,D,E,F,9) instead of opening an alphabet grid (the desktop
   * uses an actual input box; the desktop modal still works for power
   * users). Hierarchy uses 3 buttons (wrap/addChild/parentToWorld)
   * instead of a clickable recursive tree (the canvas hit-test would
   * be inconsistent and the desktop has a full tree on its LEFT pane).
   *
   * Action IDs follow the panel convention: `inspect.<verb>:<arg>`,
   * consumed by `applyInspectorEdit` in App.tsx. Most mutations
   * re-call `vrHud.redrawPanel()` synchronously so the next frame
   * already reflects the new value (the existing setDataContext
   * pipeline is too slow -- between the dispatcher's setSelectedAsset
   * and the next panel-context push the user can drift through 2-3
   * controllers of motion before the panel updates).
   */
  private drawInspectorPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome(
      'SCENE INSPECTOR',
      'Edit the currently selected asset (synced to peers)',
      '#06b6d4'
    );

    // No scene at all -> strong fallback so we never silently draw
    // broken rects over a missing render context.
    if (!data.sceneRoot) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '14px sans-serif';
      ctx.fillText(
        'Scene root not available. Open inspector on desktop for full tree.',
        40, bodyTop + 60
      );
      return;
    }

    const sel = data.selectedAsset;
    if (!sel) {
      // No selection: show an object browser (read-only) so the user
      // can still reach this panel usefully. Mirrors the desktop's
      // right-pane empty state which shows a "pick an object" hint.
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 14px sans-serif';
      ctx.fillText('NO ASSET SELECTED', 40, bodyTop + 24);
      ctx.fillStyle = '#64748b'; ctx.font = '13px sans-serif';
      ctx.fillText(
        'Left grip + trigger on a 3D object to select it, then reopen this panel.',
        40, bodyTop + 50
      );
      // Mini object list so the panel still feels useful
      const meshes: Array<{ name: string; type: string }> = [];
      data.sceneRoot.traverse((c) => {
        const o = c as THREE.Object3D;
        const t =
          (c as THREE.Mesh).isMesh ? 'Mesh' :
          (c as THREE.PointLight).isLight ? 'Light' :
          (c as THREE.Line).isLine ? 'Line' :
          null;
        if (t && o.name) meshes.push({ name: o.name, type: t });
      });
      if (meshes.length === 0) {
        ctx.fillStyle = '#64748b'; ctx.font = '13px sans-serif';
        ctx.fillText('No named objects in scene.', 40, bodyTop + 90);
        return;
      }
      meshes.slice(0, 22).forEach((m, i) => {
        const y = bodyTop + 90 + i * 22;
        ctx.fillStyle = 'rgba(30,41,59,0.6)'; ctx.fillRect(40, y, w - 80, 20);
        ctx.fillStyle = '#94a3b8'; ctx.font = '12px monospace';
        ctx.fillText(`${m.name}  [${m.type}]`, 50, y + 14);
      });
      return;
    }

    // We have a selected asset -- render the editor. Pre-compute
    // commonly reused values for the layout below.
    const o3d = sel.object3d;
    const pos = o3d.position;
    const rot = o3d.rotation;
    const scl = o3d.scale;
    // Pick the FIRST material that has the requested property so color
    // edits apply to a visible material even if some children lack one.
    const mats: THREE.Material[] = [];
    o3d.traverse((c) => {
      const m = (c as THREE.Mesh).material;
      if (m) {
        if (Array.isArray(m)) mats.push(...m);
        else mats.push(m);
      }
    });
    const mat0 = mats[0] ?? null;
    const mesh0 =
      mats.length > 0
        ? (o3d.getObjectByProperty('isMesh', true) as THREE.Mesh | null)
        : null;
    const vertCount = mesh0?.geometry?.attributes?.position?.count ?? 0;
    const triCount = mesh0?.geometry?.index
      ? (mesh0.geometry.index.count / 3) | 0
      : (vertCount / 3) | 0;
    const submeshCount = mesh0?.geometry?.groups?.length ?? 1;
    // SkinnedMesh bone heuristic: count children whose userData.role === 'bone'
    // OR whose name starts with 'bone_'. Most GLTF importers expose bones via
    // the SkinnedMesh.skeleton.bones array if applicable.
    let boneCount = 0;
    const skinned = mesh0 as any;
    if (skinned?.isSkinnedMesh && skinned.skeleton?.bones) {
      boneCount = skinned.skeleton.bones.length;
    }

    // Small helper used by every section to draw a card backdrop.
    const drawCard = (top: number, bottom: number, title: string, accent: string) => {
      const cardH = bottom - top;
      ctx.fillStyle = 'rgba(8,10,18,0.55)';
      ctx.fillRect(40, top, w - 80, cardH);
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.strokeRect(40, top, w - 80, cardH);
      ctx.fillStyle = accent; ctx.font = 'bold 14px sans-serif';
      ctx.fillText(title.toUpperCase(), 50, top + 22);
    };

    // Smaller button helper used by every stepper in the panel.
    // label is centered; registers a clickable rect via helper.
    const drawBtn = (
      x: number, y: number, bw: number, bh: number,
      label: string, action: string,
      bg: string, fill: string, stroke: string
    ): void => {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = stroke; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = fill;
      ctx.font = `bold ${Math.min(14, bh * 0.55) | 0}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + bw / 2, y + bh / 2);
      helper.registerButton({ x, y, w: bw, h: bh }, action);
    };

    // ===== SLOT HEADER (y 190..254) =====
    drawCard(190, 254, 'SLOT HEADER', '#a855f7');
    // Video controls card sits BETWEEN slot header and basic when
    // the selected asset is a video. A yShift pushes all later
    // sections down so the layout doesn't overlap. We pre-declare
    // yShift = 0 so the bulk of the renderer can keep using literal
    // y-coords (only the BASIC card origin branches on it).
    let yShift = 0;
    if (sel.type === 'video') {
      yShift = 110;
      const vcTop = 264;
      const vcBot = 264 + yShift;
      drawCard(vcTop, vcBot, 'VIDEO CONTROLS', '#ec4899');
      // Read live videoState from userData so the values always
      // mirror the HTMLVideoElement engine state (no event-bridge).
      const vs = (sel.object3d.userData as {
        videoState?: {
          playing: boolean;
          currentTime: number;
          duration: number;
          globalVolume: number;
          localVolume: number;
          volumeMode: 'global' | 'local';
          muted: boolean;
        }
      }).videoState;

      // Top row: PLAY / PAUSE (single toggle button), SKIP BACK/FR
      const vRowY = vcTop + 30;
      const vBtnH = 36;
      const vBtnGap = 8;
      const colW = (w - 80 - vBtnGap * 4) / 5;
      drawBtn(
        56 + 0 * (colW + vBtnGap), vRowY, colW, vBtnH,
        vs?.playing ? '❚❚ PAUSE' : '▶ PLAY',
        vs?.playing ? 'inspect.video:pause' : 'inspect.video:play',
        vs?.playing ? 'rgba(245,158,11,0.20)' : 'rgba(16,185,129,0.20)',
        vs?.playing ? '#fbbf24' : '#86efac',
        vs?.playing ? '#f59e0b' : '#10b981'
      );
      drawBtn(
        56 + 1 * (colW + vBtnGap), vRowY, colW, vBtnH,
        '⏮ SKIP -5',
        'inspect.video:seekPrev',
        'rgba(30,41,59,0.7)', '#cbd5e1', '#475569'
      );
      drawBtn(
        56 + 2 * (colW + vBtnGap), vRowY, colW, vBtnH,
        'SKIP +5 ⏭',
        'inspect.video:seekNext',
        'rgba(30,41,59,0.7)', '#cbd5e1', '#475569'
      );
      drawBtn(
        56 + 3 * (colW + vBtnGap), vRowY, colW, vBtnH,
        '↺ RESTART',
        'inspect.video:restart',
        'rgba(30,41,59,0.7)', '#cbd5e1', '#475569'
      );
      drawBtn(
        56 + 4 * (colW + vBtnGap), vRowY, colW, vBtnH,
        vs?.muted ? '♫ UNMUTE' : '♫ MUTE',
        'inspect.video:toggleMute',
        vs?.muted ? 'rgba(244,63,94,0.20)' : 'rgba(6,182,212,0.20)',
        vs?.muted ? '#fda4af' : '#67e8f9',
        vs?.muted ? '#f43f5e' : '#06b6d4'
      );

      // Middle row: VOL down / VAL readout / VOL up
      const vRow2Y = vRowY + vBtnH + 10;
      drawBtn(
        56 + 0 * (colW + vBtnGap), vRow2Y, colW, vBtnH,
        'VOL −',
        'inspect.video:volDown',
        'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444'
      );
      // Center: VOL % readout drawn into a non-interactive strip
      const ctrX = 56 + 1 * (colW + vBtnGap);
      const ctrW = colW * 3 + vBtnGap * 2;
      ctx.fillStyle = 'rgba(30,41,59,0.7)';
      ctx.fillRect(ctrX, vRow2Y, ctrW, vBtnH);
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
      ctx.strokeRect(ctrX, vRow2Y, ctrW, vBtnH);
      const activeVol = vs
        ? (vs.volumeMode === 'global' ? vs.globalVolume : vs.localVolume)
        : 0;
      const shownPct = Math.round((vs?.muted ? 0 : activeVol) * 100);
      ctx.fillStyle = vs?.volumeMode === 'global' ? '#67e8f9' : '#f0abfc';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(
        (vs?.volumeMode === 'global' ? 'GLOBAL' : 'LOCAL') + ' ' + shownPct + '%',
        ctrX + ctrW / 2, vRow2Y + vBtnH / 2
      );
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      drawBtn(
        ctrX + ctrW + vBtnGap, vRow2Y, colW, vBtnH,
        'VOL +',
        'inspect.video:volUp',
        'rgba(16,185,129,0.20)', '#86efac', '#10b981'
      );

      // Bottom row: GLOBL mode toggle | LOCAL mode toggle | CLOSE
      // (no duplicate mute -- the top-row mute button is sufficient)
      // Uses 3-col layout so each occupies a third of the panel width,
      // no orphan gap. colW3 is local to this row.
      const vRow3Y = vRow2Y + vBtnH + 10;
      const colGap3 = 10;
      const colW3 = (w - 80 - colGap3 * 2) / 3;
      drawBtn(
        56 + 0 * (colW3 + colGap3), vRow3Y, colW3, vBtnH,
        'GLOBL ◐',
        'inspect.video:mode:global',
        vs?.volumeMode === 'global'
          ? 'rgba(6,182,212,0.20)' : 'rgba(30,41,59,0.7)',
        vs?.volumeMode === 'global' ? '#67e8f9' : '#cbd5e1',
        vs?.volumeMode === 'global' ? '#06b6d4' : '#475569'
      );
      drawBtn(
        56 + 1 * (colW3 + colGap3), vRow3Y, colW3, vBtnH,
        'LOCAL ◑',
        'inspect.video:mode:local',
        vs?.volumeMode === 'local'
          ? 'rgba(244,114,182,0.20)' : 'rgba(30,41,59,0.7)',
        vs?.volumeMode === 'local' ? '#f0abfc' : '#cbd5e1',
        vs?.volumeMode === 'local' ? '#f472b6' : '#475569'
      );
      drawBtn(
        56 + 2 * (colW3 + colGap3), vRow3Y, colW3, vBtnH,
        '✕ CLOSE',
        'inspect.video:close',
        'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444'
      );
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px sans-serif';
    const headerName = (sel.name?.length ? sel.name : o3d.name || 'Unnamed').slice(0, 32);
    ctx.fillText(headerName, 56, 252);
    // 3 small action buttons stacked to the right of the header
    const headerBtnY = 208;
    const headerBtnH = 32;
    const headerBtnW = 100;
    let bx = w - 60 - headerBtnW;
    drawBtn(bx, headerBtnY,    headerBtnW, headerBtnH, 'JUMP TO',  'inspect.jumpTo:selected',  'rgba(0,240,255,0.18)', '#06b6d4', '#00f0ff');
    bx -= headerBtnW + 8;
    drawBtn(bx, headerBtnY,    headerBtnW, headerBtnH, 'BRING TO', 'inspect.bringTo:camera',  'rgba(168,85,247,0.18)', '#c084fc', '#a855f7');
    bx -= headerBtnW + 8;
    drawBtn(bx, headerBtnY,    headerBtnW, headerBtnH, 'DESTROY',  'inspect.destroy:selected','rgba(239,68,68,0.20)',  '#fca5a5', '#ef4444');

    // ===== BASIC + HIERARCHY + PARENT (y 264..366) =====
    drawCard(264 + yShift, 366 + yShift, 'BASIC PROPS + HIERARCHY', '#10b981');
    // Three toggle/cycle buttons across the top row
    const basicY = 290 + yShift;
    const basicH = 36;
    const basicW = 220;
    let bsx = 56;
    // VISIBLE (toggle)
    const isVisibleVal = o3d.visible;
    drawBtn(
      bsx, basicY, basicW, basicH,
      isVisibleVal ? 'VISIBLE: ON' : 'VISIBLE: OFF',
      'inspect.toggle:visible',
      isVisibleVal ? 'rgba(16,185,129,0.20)' : 'rgba(30,41,59,0.7)',
      isVisibleVal ? '#34d399' : '#cbd5e1',
      isVisibleVal ? '#10b981' : '#475569'
    );
    bsx += basicW + 12;
    // ACTIVE (Three.js default active is `true`; userData.active is the
    // app's extension flag for "logs/spawn logic treats as alive")
    const isActiveVal = (o3d.userData as { active?: boolean }).active ?? true;
    drawBtn(
      bsx, basicY, basicW, basicH,
      isActiveVal ? 'ACTIVE: ON' : 'ACTIVE: OFF',
      'inspect.toggle:active',
      isActiveVal ? 'rgba(0,240,255,0.20)' : 'rgba(30,41,59,0.7)',
      isActiveVal ? '#06b6d4' : '#cbd5e1',
      isActiveVal ? '#00f0ff' : '#475569'
    );
    bsx += basicW + 12;
    // CYCLE RENAME  (steps  Asset -> Asset (A) -> ... -> Asset (F) -> Asset (9))
    drawBtn(
      bsx, basicY, basicW, basicH, 'CYCLE RENAME' + '\u00a0' + '\u21bb',
      'inspect.rename:cycle',
      'rgba(245,158,11,0.20)', '#fbbf24', '#f59e0b'
    );

    // Three hierarchy buttons across the bottom row + a read-only parent
    // line so the user knows what they're reparenting from.
    const hierY = 332 + yShift;
    const hierH = 28;
    const hierW = 220;
    let hsx = 56;
    drawBtn(hsx, hierY, hierW, hierH, 'WRAP IN GROUP',    'inspect.hierarchy:wrap',       'rgba(168,85,247,0.20)', '#c084fc', '#a855f7');
    hsx += hierW + 12;
    drawBtn(hsx, hierY, hierW, hierH, 'ADD CHILD GROUP',  'inspect.hierarchy:addChild',   'rgba(168,85,247,0.20)', '#c084fc', '#a855f7');
    hsx += hierW + 12;
    drawBtn(hsx, hierY, hierW, hierH, 'PARENT TO WORLD',  'inspect.hierarchy:parentToWorld','rgba(168,85,247,0.20)', '#c084fc', '#a855f7');
    // Parent-name read-out (sits beneath the row, smaller font)
    const parentName = o3d.parent?.name || o3d.parent?.type || '\u2014';
    ctx.fillStyle = '#64748b'; ctx.font = '12px sans-serif';
    ctx.fillText('Current parent: ' + (parentName.length > 30 ? parentName.slice(0,29) + '\u2026' : parentName), 56, 378 + yShift);

    // ===== TRANSFORM (y 378..564) =====
    drawCard(378 + yShift, 564 + yShift, 'TRANSFORM', '#06b6d4');
    // 3 rows x 3 cols grid. Each cell shows axis label + current value
    // + [-] [+] [reset] buttons at the right.
    const trStartY = 408 + yShift;
    const trCellH = 38;
    const trGapY  = 4;
    const trGapX  = 12;
    const trColsW = (w - 80 - trGapX * 2) / 3;
    // rot is in radians for THREE.Object3D.rotation, but we DISPLAY degrees
    // (matches desktop SceneInspectorWindow).
    const fmtVal = (v: number, isRot: boolean): string =>
      isRot ? ((v * 180 / Math.PI).toFixed(0) + '\u00b0') :
             v.toFixed(2);
    const rows = [
      {
        label: 'POS', prefix: 'pos', axis: 'x', get: () => pos.x, set: (v: number) => { pos.x = v; },
        alt: [
          { label: 'POS Y', prefix: 'pos', axis: 'y', get: () => pos.y, set: (v: number) => { pos.y = v; } },
          { label: 'POS Z', prefix: 'pos', axis: 'z', get: () => pos.z, set: (v: number) => { pos.z = v; } },
        ]
      },
      {
        label: 'ROT X', prefix: 'rot', axis: 'x', get: () => rot.x, set: (v: number) => { rot.x = v; },
        alt: [
          { label: 'ROT Y', prefix: 'rot', axis: 'y', get: () => rot.y, set: (v: number) => { rot.y = v; } },
          { label: 'ROT Z', prefix: 'rot', axis: 'z', get: () => rot.z, set: (v: number) => { rot.z = v; } },
        ]
      },
      {
        label: 'SCL X', prefix: 'scl', axis: 'x', get: () => scl.x, set: (v: number) => { scl.x = v; },
        alt: [
          { label: 'SCL Y', prefix: 'scl', axis: 'y', get: () => scl.y, set: (v: number) => { scl.y = v; } },
          { label: 'SCL Z', prefix: 'scl', axis: 'z', get: () => scl.z, set: (v: number) => { scl.z = v; } },
        ]
      },
    ];
    rows.forEach((row, r) => {
      const cells = [row, ...row.alt];
      cells.forEach((cell, c) => {
        const cx = 50 + c * (trColsW + trGapX);
        const cy = trStartY + r * (trCellH + trGapY);
        // card backdrop
        ctx.fillStyle = 'rgba(30,41,59,0.6)';
        ctx.fillRect(cx, cy, trColsW, trCellH);
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, trColsW, trCellH);
        // axis label
        ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 11px sans-serif';
        ctx.fillText(cell.label, cx + 8, cy + 14);
        // value
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 16px monospace';
        ctx.fillText(fmtVal(cell.get(), cell.prefix === 'rot'), cx + 8, cy + 30);
        // 3 small buttons at the right: [-] [+] [reset]
        const btnW = 32, btnH = 22;
        const btnY = cy + (trCellH - btnH) / 2;
        const btnsTotalW = btnW * 3 + 4;
        const buttonsX0 = cx + trColsW - btnsTotalW - 6;
        drawBtn(
          buttonsX0, btnY, btnW, btnH, '\u2212',
          `inspect.transform:${cell.prefix}.${cell.axis}-`,
          'rgba(239,68,68,0.25)', '#fca5a5', '#ef4444'
        );
        drawBtn(
          buttonsX0 + btnW + 2, btnY, btnW, btnH, '+',
          `inspect.transform:${cell.prefix}.${cell.axis}+`,
          'rgba(16,185,129,0.25)', '#86efac', '#10b981'
        );
        drawBtn(
          buttonsX0 + btnW * 2 + 4, btnY, btnW, btnH, '\u21ba',
          `inspect.transform:${cell.prefix}.${cell.axis}.reset`,
          'rgba(148,163,184,0.20)', '#cbd5e1', '#94a3b8'
        );
      });
    });
    // Bottom row: RESET ALL TRANSFORM + CENTER PIVOT
    const trBottomY = trStartY + 3 * (trCellH + trGapY) + 6;
    const trBottomH = 32;
    const trBottomBtnW = (w - 80 - 12) / 2;
    drawBtn(
      56, trBottomY, trBottomBtnW, trBottomH, 'RESET ALL TRANSFORM',
      'inspect.transform:resetAll',
      'rgba(148,163,184,0.20)', '#e2e8f0', '#94a3b8'
    );
    drawBtn(
      56 + trBottomBtnW + 12, trBottomY, trBottomBtnW, trBottomH, 'CENTER PIVOT',
      'inspect.transform:centerPivot',
      'rgba(99,102,241,0.20)', '#a5b4fc', '#6366f1'
    );

    // ===== MESH STATS + DISPLAY (y 576..686) =====
    drawCard(576 + yShift, 686 + yShift, 'MESH STATS + DISPLAY', '#f59e0b');
    // Stats block (read-only) on the left half
    const statsX = 56, statsY = 600 + yShift, statsRowH = 22, statsW = 240;
    ctx.fillStyle = 'rgba(15,23,42,0.65)';
    ctx.fillRect(statsX, statsY, statsW, 80);
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
    ctx.strokeRect(statsX, statsY, statsW, 80);
    const statRows: Array<[string, string]> = [
      ['Vertices',   vertCount.toLocaleString()],
      ['Triangles',  triCount.toLocaleString()],
      ['Submeshes',  String(submeshCount)],
      ['Bones',      boneCount ? boneCount.toLocaleString() : '—'],
    ];
    statRows.forEach(([k, v], i) => {
      const y = statsY + 14 + i * statsRowH;
      ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif';
      ctx.fillText(k, statsX + 10, y);
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px monospace';
      ctx.fillText(v, statsX + 110, y);
    });
    // Display toggles on the right half
    const displayX = 320, displayY = 600 + yShift, displayW = (w - 80) - 264;
    const toggleH = 26;
    const toggleRows: Array<{ label: string; action: string; on: boolean; accent: string; bg: string; }> = [
      {
        label: 'VISIBLE: ' + (o3d.visible ? 'ON' : 'OFF'),
        action: 'inspect.toggle:visible',
        on: o3d.visible,
        accent: o3d.visible ? '#10b981' : '#475569',
        bg: o3d.visible ? 'rgba(16,185,129,0.20)' : 'rgba(30,41,59,0.7)',
      },
      {
        label: 'WIREFRAME: ' + ((mat0 as THREE.MeshStandardMaterial | null)?.wireframe ? 'ON' : 'OFF'),
        action: 'inspect.toggle:wireframe',
        on: !!(mat0 as any)?.wireframe,
        accent: (mat0 as THREE.MeshStandardMaterial | null)?.wireframe ? '#06b6d4' : '#475569',
        bg: (mat0 as THREE.MeshStandardMaterial | null)?.wireframe ? 'rgba(6,182,212,0.20)' : 'rgba(30,41,59,0.7)',
      },
      {
        label: 'FLAT SHADING: ' + ((mat0 as THREE.MeshStandardMaterial | null)?.flatShading ? 'ON' : 'OFF'),
        action: 'inspect.toggle:flatShading',
        on: !!(mat0 as any)?.flatShading,
        accent: (mat0 as THREE.MeshStandardMaterial | null)?.flatShading ? '#f472b6' : '#475569',
        bg: (mat0 as THREE.MeshStandardMaterial | null)?.flatShading ? 'rgba(244,114,182,0.20)' : 'rgba(30,41,59,0.7)',
      },
    ];
    toggleRows.forEach((t, i) => {
      const y = displayY + i * (toggleH + 4);
      drawBtn(
        displayX, y, displayW, toggleH, t.label, t.action,
        t.bg, t.accent, t.accent
      );
    });

    // ===== MATERIAL (y 696..758) =====
    drawCard(696 + yShift, 758 + yShift, 'MATERIAL', '#06b6d4');
    drawBtn(660, 703 + yShift, 310, 22, 'OPEN MATERIAL & TEXTURES EDITOR', 'inspect.openMaterialEditor', 'rgba(16,185,129,0.25)', '#6ee7b7', '#10b981');
    const matY = 720 + yShift;
    // Color R/G/B row
    const colorChans: Array<{ label: string; key: 'r'|'g'|'b' }> = [
      { label: 'R', key: 'r' }, { label: 'G', key: 'g' }, { label: 'B', key: 'b' },
    ];
    const colorStep = 32; // px per cell
    const cellGap = 8;
    const colorStartX = 56;
    colorChans.forEach((chan, i) => {
      const cx = colorStartX + i * (colorStep * 3 + cellGap);
      const cv = mat0 ? Math.round((((mat0 as THREE.MeshStandardMaterial).color as THREE.Color)[chan.key]) * 255) : 0;
      // header
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText(chan.label, cx, matY + 8);
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px monospace';
      ctx.fillText(String(cv).padStart(3, ' '), cx + colorStep, matY + 8 - 0);
      // buttons
      drawBtn(cx,                matY + 14, colorStep, 22, '\u2212', `inspect.material.color.${chan.key}-`, 'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444');
      drawBtn(cx + colorStep,    matY + 14, colorStep, 22, '+',       `inspect.material.color.${chan.key}+`, 'rgba(16,185,129,0.20)', '#86efac', '#10b981');
      drawBtn(cx + colorStep*2,  matY + 14, colorStep, 22, '\u21ba', `inspect.material.color.${chan.key}.reset`, 'rgba(148,163,184,0.20)', '#cbd5e1', '#94a3b8');
    });
    // Scalar sliders (Roughness / Metalness / Opacity / Emissive)
    const scalarProps: Array<{ label: string; prop: string; fmt: (n:number)=>string; get: () => number; }> = [
      { label: 'ROUGH',  prop: 'roughness',  fmt: n => n.toFixed(2), get: () => (mat0 as THREE.MeshStandardMaterial | null)?.roughness ?? 0.5 },
      { label: 'METAL',  prop: 'metalness',  fmt: n => n.toFixed(2), get: () => (mat0 as THREE.MeshStandardMaterial | null)?.metalness ?? 0 },
      { label: 'OPACITY',prop: 'opacity',    fmt: n => n.toFixed(2), get: () => (mat0 as THREE.MeshStandardMaterial | null)?.opacity ?? 1 },
      { label: 'EMISS',  prop: 'emissive',   fmt: n => n.toFixed(2), get: () => ((mat0 as THREE.MeshStandardMaterial | null) as any)?.emissiveIntensity ?? 1 },
    ];
    const scalarStartY = 720 + yShift + 38;
    const scalarCellW = (w - 80 - cellGap * 3) / 4;
    scalarProps.forEach((p, i) => {
      const cx = 50 + i * (scalarCellW + cellGap);
      const cy = scalarStartY;
      ctx.fillStyle = 'rgba(30,41,59,0.65)';
      ctx.fillRect(cx, cy, scalarCellW, 30);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
      ctx.strokeRect(cx, cy, scalarCellW, 30);
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 10px sans-serif';
      ctx.fillText(p.label, cx + 6, cy + 12);
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px monospace';
      ctx.fillText(p.fmt(p.get()), cx + 6, cy + 27);
      const btnW = 22;
      drawBtn(cx + scalarCellW - btnW * 3 - 4, cy + 4, btnW, 22, '\u2212', `inspect.material.props:${p.prop}-`, 'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444');
      drawBtn(cx + scalarCellW - btnW * 2 - 2, cy + 4, btnW, 22, '+',       `inspect.material.props:${p.prop}+`, 'rgba(16,185,129,0.20)', '#86efac', '#10b981');
      drawBtn(cx + scalarCellW - btnW,        cy + 4, btnW, 22, '\u21ba', `inspect.material.props:${p.prop}.reset`, 'rgba(148,163,184,0.20)', '#cbd5e1', '#94a3b8');
    });

    // Reset baseline
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Dedicated Material & PBR Texture Inspector panel for VR.
   * Allows applying held or imported image textures to Albedo, Normal, Roughness,
   * Metalness, Emission, and AO texture slots, as well as fine-tuning PBR scalars.
   */
  private drawMaterialPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome(
      'MATERIAL & TEXTURE INSPECTOR',
      'Apply held or imported image textures to PBR material slots',
      '#10b981'
    );

    const sel = data.selectedAsset;
    if (!sel) {
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 16px sans-serif';
      ctx.fillText('NO ASSET SELECTED', 60, bodyTop + 40);
      ctx.font = '14px sans-serif';
      ctx.fillText('Select a 3D object in VR or via the Scene Inspector first.', 60, bodyTop + 70);
      return;
    }

    const mats: THREE.Material[] = [];
    sel.object3d.traverse((c) => {
      const m = (c as THREE.Mesh).material;
      if (m) {
        if (Array.isArray(m)) mats.push(...m);
        else mats.push(m);
      }
    });
    const mat0 = (mats[0] as THREE.MeshStandardMaterial) ?? null;

    const drawCard = (top: number, bottom: number, title: string, accent: string) => {
      const cardH = bottom - top;
      ctx.fillStyle = 'rgba(8,10,18,0.55)';
      ctx.fillRect(40, top, w - 80, cardH);
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.strokeRect(40, top, w - 80, cardH);
      ctx.fillStyle = accent; ctx.font = 'bold 14px sans-serif';
      ctx.fillText(title.toUpperCase(), 50, top + 22);
    };

    const drawBtn = (
      x: number, y: number, bw: number, bh: number,
      label: string, action: string,
      bg: string, fill: string, stroke: string
    ): void => {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = stroke; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = fill;
      ctx.font = `bold ${Math.min(13, bh * 0.55) | 0}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + bw / 2, y + bh / 2);
      helper.registerButton({ x, y, w: bw, h: bh }, action);
    };

    // Card 1: PBR TEXTURE MAP SLOTS
    drawCard(bodyTop + 10, bodyTop + 330, 'PBR TEXTURE MAP SLOTS', '#10b981');
    const slots: Array<{ label: string; key: string }> = [
      { label: 'ALBEDO / BASE COLOR MAP', key: 'map' },
      { label: 'NORMAL MAP',              key: 'normalMap' },
      { label: 'ROUGHNESS MAP',           key: 'roughnessMap' },
      { label: 'METALNESS MAP',           key: 'metalnessMap' },
      { label: 'EMISSION MAP',            key: 'emissiveMap' },
      { label: 'AO (OCCLUSION) MAP',      key: 'aoMap' },
    ];

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    slots.forEach((s, i) => {
      const rowY = bodyTop + 45 + i * 46;
      ctx.fillStyle = 'rgba(30,41,59,0.7)';
      ctx.fillRect(56, rowY, w - 112, 38);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
      ctx.strokeRect(56, rowY, w - 112, 38);

      const hasTex = mat0 && (mat0 as any)[s.key] != null;
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px sans-serif';
      ctx.fillText(s.label, 72, rowY + 23);

      ctx.fillStyle = hasTex ? '#10b981' : '#64748b'; ctx.font = 'bold 12px monospace';
      ctx.fillText(hasTex ? '[ TEXTURE ACTIVE ]' : '[ NO TEXTURE ]', 320, rowY + 23);

      // Buttons
      drawBtn(
        560, rowY + 6, 260, 26,
        'APPLY HELD / CYCLE IMAGE',
        `inspect.material.slot:${s.key}`,
        'rgba(16,185,129,0.25)', '#6ee7b7', '#10b981'
      );
      drawBtn(
        832, rowY + 6, 90, 26,
        'CLEAR',
        `inspect.material.slotClear:${s.key}`,
        'rgba(239,68,68,0.25)', '#fca5a5', '#ef4444'
      );
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });

    // Card 2: PBR SCALARS & TUNING
    drawCard(bodyTop + 345, bodyTop + 510, 'MATERIAL SCALAR TUNING', '#06b6d4');
    const scalarProps: Array<{ label: string; prop: string; fmt: (n:number)=>string; get: () => number; }> = [
      { label: 'ROUGHNESS',  prop: 'roughness',  fmt: n => n.toFixed(2), get: () => mat0?.roughness ?? 0.5 },
      { label: 'METALNESS',  prop: 'metalness',  fmt: n => n.toFixed(2), get: () => mat0?.metalness ?? 0 },
      { label: 'OPACITY',    prop: 'opacity',    fmt: n => n.toFixed(2), get: () => mat0?.opacity ?? 1 },
      { label: 'EMISS INT.', prop: 'emissive',   fmt: n => n.toFixed(2), get: () => (mat0 as any)?.emissiveIntensity ?? 1 },
    ];

    const scalarStartY = bodyTop + 385;
    const cellW = (w - 112 - 36) / 4;
    scalarProps.forEach((p, i) => {
      const cx = 56 + i * (cellW + 12);
      const cy = scalarStartY;
      ctx.fillStyle = 'rgba(30,41,59,0.7)';
      ctx.fillRect(cx, cy, cellW, 54);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
      ctx.strokeRect(cx, cy, cellW, 54);

      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 12px sans-serif';
      ctx.fillText(p.label, cx + 12, cy + 20);
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 16px monospace';
      ctx.fillText(p.fmt(p.get()), cx + 12, cy + 42);

      const btnW = 32;
      drawBtn(cx + cellW - btnW * 3 - 10, cy + 14, btnW, 26, '\u2212', `inspect.material.props:${p.prop}-`, 'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444');
      drawBtn(cx + cellW - btnW * 2 - 6,  cy + 14, btnW, 26, '+',       `inspect.material.props:${p.prop}+`, 'rgba(16,185,129,0.20)', '#86efac', '#10b981');
      drawBtn(cx + cellW - btnW - 2,      cy + 14, btnW, 26, '\u21ba', `inspect.material.props:${p.prop}.reset`, 'rgba(148,163,184,0.20)', '#cbd5e1', '#94a3b8');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });

    // Back button
    drawBtn(
      56, bodyTop + 460, 240, 32,
      '\u2190 BACK TO SCENE INSPECTOR',
      'sys.open:sys-inspector',
      'rgba(148,163,184,0.25)', '#e2e8f0', '#64748b'
    );
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * VR text chat panel. Pure-immersive-WebXR counterpart of the desktop
   * ChatPanel.tsx (which keeps working on desktop and is opened via the
   * navbar) -- brings social text chat to VR users who couldn't reach it
   * before.
   *
   * Layout (1024x768 panel canvas):
   *   - drawStandardChrome (BACK + CLOSE)         0..180
   *   - Current-input buffer strip                180..220
   *   - Last 6 messages (sender, time, text)      220..420
   *   - 6-col x 5-row alphabet grid (a-z +        420..690
   *     SPACE / BACK / CLEAR / SEND)
   *
   * Buffer state lives on the manager (`_chatInputBuffer`); per-key
   * presses mutate it via runPanelAction ("chat.append:<c>" /
   * chat.backspace / chat.clear). Send strategy: pressed SEND runs
   * runPanelAction('chat.send') which bubbles the trimmed buffer up via
   * onPanelAction('chat.send:<text>') and clears the local buffer. This
   * keeps every intermediate keystroke off the React render path.
   *
   * Self-vs-other styling is left for v2 (current build renders all
   * messages uniformly); distinguishing would need `_localPeerIdHint`
   * synced from App.tsx via setDataContext.
   */
  private drawChatPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    // Suppressed unused-param warning: the chat grid uses simple
    // fixed-row math (derived from `w` and the bodyTop returned by
    // `drawStandardChrome`); the canvas height is implicitly managed
    // by `helper.getCanvasSize()` if a future layout ever needs it.
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome(
      'TEXT CHAT',
      'Type with the on-panel grid. Pull trigger on SEND to broadcast.',
      '#a855f7'
    );

    // Merge local rolling buffer with whatever setDataContext last
    // pushed (covers the rare case where the React state update lands
    // BEFORE appendIncomingChat fires -- dedup by id).
    const allMsgs: ChatMessage[] = [];
    const seen = new Set<string>();
    for (const m of [...this._recentMessages, ...data.chatMessages]) {
      if (!seen.has(m.id)) { seen.add(m.id); allMsgs.push(m); }
    }
    allMsgs.sort((a, b) => a.timestamp - b.timestamp);

    // === Current-input buffer strip ===
    const bufY = bodyTop + 12;
    const bufH = 38;
    ctx.fillStyle = this._chatInputBuffer.length > 0
      ? 'rgba(168,85,247,0.18)'
      : 'rgba(30,41,59,0.55)';
    ctx.fillRect(40, bufY, w - 80, bufH);
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1;
    ctx.strokeRect(40, bufY, w - 80, bufH);
    ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('SEND:', 60, bufY + bufH / 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 18px monospace';
    const bufText = this._chatInputBuffer.length === 0 ? '_' : this._chatInputBuffer;
    ctx.fillText(bufText, 130, bufY + bufH / 2);

    // === Messages list (last 6) ===
    const msgStartY = bufY + bufH + 12;
    const msgHeight = 36;
    const maxVisible = 6;
    const visible = allMsgs.slice(-maxVisible);
    visible.forEach((m, idx) => {
      const y = msgStartY + idx * msgHeight;
      if (m.isSystem) {
        ctx.fillStyle = 'rgba(148,163,184,0.15)';
        ctx.fillRect(40, y, w - 80, msgHeight - 4);
        ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(m.text, w / 2, y + 18);
        ctx.textAlign = 'left';
        return;
      }
      ctx.fillStyle = 'rgba(30,41,59,0.65)';
      ctx.fillRect(40, y, w - 80, msgHeight - 4);
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
      ctx.strokeRect(40, y, w - 80, msgHeight - 4);
      ctx.fillStyle = '#c084fc';
      ctx.font = 'bold 13px sans-serif';
      const truncatedSender = (m.senderName ?? 'anon').slice(0, 14);
      ctx.fillText(truncatedSender, 52, y + 14);
      const timeStr = new Date(m.timestamp).toLocaleTimeString(
        [], { hour: '2-digit', minute: '2-digit' }
      );
      ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(timeStr, w - 50, y + 14);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e2e8f0'; ctx.font = '14px sans-serif';
      const txtMaxLen = 80;
      const txt = m.text.length > txtMaxLen
        ? m.text.slice(0, txtMaxLen - 1) + '...'
        : m.text;
      ctx.fillText(txt, 52, y + 30);
    });
    if (allMsgs.length === 0) {
      ctx.fillStyle = '#64748b'; ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'No messages yet. Pull the trigger on a letter to start typing.',
        w / 2, msgStartY + maxVisible * msgHeight / 2
      );
      ctx.textAlign = 'left';
    } else if (allMsgs.length > maxVisible) {
      ctx.fillStyle = '#475569'; ctx.font = 'italic 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        '+' + (allMsgs.length - maxVisible) + ' older not shown',
        w - 50, msgStartY + maxVisible * msgHeight + 4
      );
      ctx.textAlign = 'left';
    }

    // === Alphabet + special keys grid (6 cols x 5 rows = 30 cells) ===
    const gridStartY = msgStartY + maxVisible * msgHeight + 14;
    const gap = 8;
    const cellW = (w - 80 - 5 * gap) / 6;
    const cellH = 50;
    const cells: string[][] = [
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['g', 'h', 'i', 'j', 'k', 'l'],
      ['m', 'n', 'o', 'p', 'q', 'r'],
      ['s', 't', 'u', 'v', 'w', 'x'],
      ['y', 'z', 'SPACE', 'BACK', 'CLEAR', 'SEND'],
    ];
    cells.forEach((row, rIdx) => {
      const y = gridStartY + rIdx * (cellH + gap / 2);
      row.forEach((label, cIdx) => {
        const x = 40 + cIdx * (cellW + gap);
        let action: string;
        let accent: string;
        let labelText: string;
        let fontPx = 18;
        if (label === 'SPACE') {
          action = 'chat.append: ';
          accent = '#06b6d4';
          labelText = 'SPACE';
          fontPx = 14;
        } else if (label === 'BACK') {
          action = 'chat.backspace';
          accent = '#ef4444';
          labelText = 'BACK';
          fontPx = 14;
        } else if (label === 'CLEAR') {
          action = 'chat.clear';
          accent = '#fbbf24';
          labelText = 'CLR';
          fontPx = 14;
        } else if (label === 'SEND') {
          action = 'chat.send';
          accent = '#10b981';
          labelText = 'SEND';
          fontPx = 14;
        } else {
          action = 'chat.append:' + label;
          accent = '#a855f7';
          labelText = label.toUpperCase();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeStyle = accent + 'aa';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cellW, cellH);
        ctx.fillStyle = accent;
        ctx.font = `bold ${fontPx}px "Outfit", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, x + cellW / 2, y + cellH / 2);
        helper.registerButton({ x, y, w: cellW, h: cellH }, action);
      });
    });
    // Reset baseline
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Radial context menu rendered to the VR panel canvas. Mirrors the
   * desktop RadialContextMenu component: 5 slices around a center hub,
   * with the hub as a tab swap between 'general' (undo/redo + locomotion,
   * scaling, laser) and 'grab' (undo/redo + grab mode, snap grid,
   * collision toggle). On every draw, publishes the radial center +
   * radii to `_radialCenter` so handleRayIntersection's polar hit-test
   * resolves clicks against the EXACT geometry the user sees.
   */
  private drawRadialPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome('RADIAL CONTEXT', 'Aim controller, pull trigger on a slice', '#a855f7');

    // Center the radial in the panel below the chrome. Use slightly smaller
    // radii than the full canvas so the slice labels can sit OUTSIDE the
    // outer arc (matching the desktop radial's outside-label layout).
    const cx = w / 2;
    const cy = bodyTop + (h - bodyTop) / 2 + 10;
    const rIn = 120;
    const rOut = 300;
    const hubR = 92;
    // Publish geometry to the polar hit-test. Stored on the manager
    // (not the panel registry) so the hit-test can read it without
    // iterating the clickables list every frame.
    this._radialCenter = { x: cx, y: cy, rIn, rOut, hubR };

    // Slice geometry — EXACT match to the desktop's getArcPath input so
    // muscle memory transfers. Angles are CW-from-top (0 = 12 o'clock,
    // positive clockwise). The 5 slices are evenly distributed with a
    // ~12deg gap between them.
    const slices = [
      { id: 'undo',  start: -67, end:  -5, label: 'UNDO',  sub: '\u21b6' },
      { id: 'redo',  start:   5, end:  67, label: 'REDO',  sub: '\u21b7' },
      { id: 'right', start:  77, end: 139, label: null,    sub: null    },
      { id: 'bottom',start: 149, end: 211, label: null,    sub: null    },
      { id: 'left',  start: 221, end: 283, label: null,    sub: null    },
    ];

    // Per-slice palette + label. Driven by _radialTab so swapping the
    // tab re-paints the slices on the next redraw.
    const tab = this._radialTab;
    const decorate = (id: string): { label: string; sub: string; stroke: string } => {
      if (id === 'undo') return { label: 'UNDO', sub: '\u21b6', stroke: '#94a3b8' };
      if (id === 'redo') return { label: 'REDO', sub: '\u21b7', stroke: '#94a3b8' };
      if (tab === 'general') {
        if (id === 'right') return {
          label: 'LOCO',
          sub: data.cameraState.locomotionMode.toUpperCase(),
          stroke: '#facc15',
        };
        if (id === 'bottom') return {
          label: 'SCALE',
          sub: data.scalingEnabled ? 'ENABLED' : 'DISABLED',
          stroke: data.scalingEnabled ? '#10b981' : '#ef4444',
        };
        if (id === 'left') return {
          label: 'LASER',
          sub: data.laserEnabled ? 'ENABLED' : 'DISABLED',
          stroke: data.laserEnabled ? '#ffffff' : '#94a3b8',
        };
      } else {
        // 'held' tab — only reachable when data.isHeld === true (set
        // via setDataContext in App.tsx). Save Held / Duplicate /
        // Destroy are routed to App.tsx via onPanelAction where the
        // dispatcher checks the active radialTab and calls
        // handleSaveHeldToInventory / handleDuplicateHeld /
        // handleDestroyHeld. Colors mirror the desktop
        // RadialContextMenu's held tab (amber / cyan / rose).
        if (this._radialTab === 'held') {
          if (id === 'right') return { label: 'SAVE', sub: 'to inventory', stroke: '#f59e0b' };
          if (id === 'bottom') return { label: 'COPY', sub: 'duplicate', stroke: '#06b6d4' };
          if (id === 'left') return { label: 'KILL', sub: 'destroy', stroke: '#ef4444' };
        }
        if (id === 'right') return {
          label: 'GRAB',
          sub: data.grabMode.toUpperCase(),
          stroke: '#f59e0b',
        };
        if (id === 'bottom') return {
          label: 'GRID',
          sub: 'SNAP',
          stroke: '#06b6d4',
        };
        if (id === 'left') return {
          label: 'COLLIDE',
          sub: 'TOGGLE',
          stroke: '#a855f7',
        };
      }
      return { label: '?', sub: '', stroke: '#525252' };
    };

    // Draw each slice as a filled annular sector + a thick stroke.
    // Manual `arc` calls so we don't depend on the canvas-2d even-odd
    // fill rule, which is well-supported but worth being explicit about.
    const drawSlice = (startDeg: number, endDeg: number, stroke: string) => {
      const startRad = (startDeg - 90) * Math.PI / 180;
      const endRad = (endDeg - 90) * Math.PI / 180;
      const x1 = cx + rOut * Math.cos(startRad);
      const y1 = cy + rOut * Math.sin(startRad);
      const x3 = cx + rIn * Math.cos(endRad);
      const y3 = cy + rIn * Math.sin(endRad);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.arc(cx, cy, rOut, startRad, endRad);
      ctx.lineTo(x3, y3);
      ctx.arc(cx, cy, rIn, endRad, startRad, true);
      ctx.closePath();
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    // Per-slice polar-to-canvas helpers for label placement.
    const sliceCenter = (startDeg: number, endDeg: number) => {
      const midDeg = (startDeg + endDeg) / 2;
      const midRad = (midDeg - 90) * Math.PI / 180;
      const rMid = (rIn + rOut) / 2;
      return { x: cx + rMid * Math.cos(midRad), y: cy + rMid * Math.sin(midRad) };
    };

    slices.forEach((s) => {
      const dec = decorate(s.id);
      drawSlice(s.start, s.end, dec.stroke);
      const c = sliceCenter(s.start, s.end);
      // Label (slice name) — bold, accent-colored.
      ctx.fillStyle = dec.stroke;
      ctx.font = 'bold 28px "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dec.label, c.x, c.y - 8);
      // Sub-label (current state / sub-icon).
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 18px "Outfit", sans-serif';
      ctx.fillText(dec.sub, c.x, c.y + 18);
    });

    // Center hub — tab swap. Bright cyan accent so it stands out as the
    // "I do something different" button. The text reflects the CURRENT
    // tab; clicking flips to the other tab and redraws.
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.95)';
    ctx.fill();
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 18px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tab === 'general' ? 'MENU' : 'GRAB', cx, cy - 6);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px "Outfit", sans-serif';
    ctx.fillText('click to swap', cx, cy + 18);

    // Note: we do NOT registerButton here. The polar hit-test in
    // handleRayIntersection reads _radialCenter directly, so rectangular
    // clickables for the slices would be approximate at best and dead
    // data at worst. Keeping the registry empty for the radial panel
    // also keeps the dispatch fast.
  }

  // ===========================================================================
  // Static fallback values for the PanelContext default
  // ===========================================================================
  /**
   * Single source of truth for the dash-menu system cards.
   * Read by BOTH renderCanvas (draw cards) and handleRayIntersection
   * (hit-test cards). Add a new card by appending one row here.
   * Consumers .map at call sites adapt to InventoryItem so the
   * existing drawing loop is reused as-is.
   */
  public static readonly SYSTEM_CARDS: ReadonlyArray<{ id: string; name: string }> = [
    { id: 'sys-session',   name: 'Session & Roles'   },
    { id: 'sys-inventory', name: 'Inventory Storage' },
    { id: 'sys-chat',      name: 'Text Chat'         },
    { id: 'sys-settings',  name: 'World Settings'    },
    { id: 'sys-env',       name: 'World Environment' },
    { id: 'sys-share',     name: 'Invite & Share'    },
    { id: 'sys-pair',      name: 'Pair Companion'    },
    { id: 'sys-radial',    name: 'Radial Context'    },
    { id: 'sys-inspector', name: 'Scene Inspector'   },
  ];

  private static fallbackGraphics: GraphicsSettings = {
    resolutionScale: 1.0,
    shadowQuality: 'high',
    antiAliasing: 'msaa',
    msaaSamples: 4,
    postProcessing: false,
    lodBias: 1.0,
    progressiveLOD: false,
    lodTargetDensity: 200_000,
    lodOverrideLevel: undefined
  };
  private static fallbackStats: PerformanceStats = { fps: 60, drawCalls: 0, triangles: 0 };
  private static fallbackEnvironment: EnvironmentSettings = {
    atmosphere: 'cyber-nebula',
    gridVisible: true,
    gridSize: 'standard-60',
    gridColor: 'cyan',
    ambientIntensity: 1.2,
    dirLightIntensity: 1.5
  };

  public dispose(): void {
    this.scene.remove(this.group);
    this.curvedScreenMesh.geometry.dispose();
    if (Array.isArray(this.curvedScreenMesh.material)) {
      this.curvedScreenMesh.material.forEach(m => m.dispose());
    } else {
      this.curvedScreenMesh.material.dispose();
    }
    this.texture.dispose();

    this.scene.remove(this.panelGroup);
    if (this.panelMesh.geometry) this.panelMesh.geometry.dispose();
    const pm = this.panelMesh.material;
    if (Array.isArray(pm)) pm.forEach(m => m.dispose());
    else if (pm) (pm as THREE.Material).dispose();
    if (this.panelTexture) this.panelTexture.dispose();
  }
}
