import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import confetti from 'canvas-confetti';

import { SceneEngine } from './engine/SceneEngine.ts';
import type { GraphicsSettings } from './engine/SceneEngine.ts';
import { AssetManager } from './engine/AssetManager.ts';
import type { AssetType, LoadedAsset } from './engine/AssetManager.ts';
import { ManipulationManager } from './engine/ManipulationManager.ts';
import type { TransformMode } from './engine/ManipulationManager.ts';
import { AvatarManager } from './engine/AvatarManager.ts';
import { NetworkService } from './services/NetworkService.ts';
import type { ConnectionMode, AssetSpawnData, PendingSpawnData, ChatMessage } from './services/NetworkService.ts';
import { InventoryService } from './services/InventoryService.ts';
import type { InventoryItem } from './services/InventoryService.ts';
import { UndoRedoManager } from './services/UndoRedoManager.ts';
import type { TransformSnapshot, AssetSnapshot } from './services/UndoRedoManager.ts';

import { Navbar } from './components/Navbar.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { InventoryModal } from './components/InventoryModal.tsx';
import { ShareModal } from './components/ShareModal.tsx';
import { ChatPanel } from './components/ChatPanel.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { FileImportModal } from './components/FileImportModal.tsx';
import { type AtmospherePreset,  EnvironmentManager } from './engine/EnvironmentManager.ts';
import type { EnvironmentSettings } from './engine/EnvironmentManager.ts';
import { WorldEnvironmentModal } from './components/WorldEnvironmentModal.tsx';
import { AssetImportDialog } from './components/AssetImportDialog.tsx';
import type { ImportConfig } from './components/AssetImportDialog.tsx';
import type { UserRole, DefaultPermissionsConfig } from './types/permissions.ts';
import { ROLE_PERMISSIONS } from './types/permissions.ts';
import { DashMenu } from './components/DashMenu.tsx';
import { VRHUDManager } from './engine/VRHUDManager.ts';
import { BrushManager } from './engine/BrushManager.ts';
import { WorldToolsPanel } from './components/WorldToolsPanel.tsx';
import type { ToolType } from './components/WorldToolsPanel.tsx';
import { SceneInspectorWindow } from './components/SceneInspectorWindow.tsx';
import { RadialContextMenu } from './components/RadialContextMenu.tsx';
import { VRRadialMenuMesh } from './engine/VRRadialMenuMesh.ts';
import type { VRRadialMenuState, VRRadialMenuCallbacks } from './engine/VRRadialMenuMesh.ts';
import { X } from 'lucide-react';

/**
 * Build a small 3D loading placeholder at the given world position.
 * Returns the THREE.Group (already positioned, NOT yet parented) plus
 * a `dispose()` cleanup callback that releases all GPU resources —
 * including the Sprite's `CanvasTexture`, which Three.js does NOT
 * auto-dispose when its material is disposed (textures can be shared
 * across multiple materials). Without this explicit call, every
 * cancelled or resolved placeholder leaks a 512x128 RGBA backing on
 * GPU until component unmount.
 */
function createLoadingPlaceholder(
  name: string,
  requesterName: string,
  position: THREE.Vector3,
  isOversized: boolean = false
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.position.copy(position);

  // Color palette: cyan = in-flight loading, red = "Too Large" indicator
  // (the binary was stripped from the broadcast to keep Quest's WebRTC
  // data channel from OOMing on a >5MB base64 round-trip).
  const primaryColor = isOversized ? 0xff3344 : 0x00f0ff;
  const secondaryColor = isOversized ? 0xff5566 : 0xa855f7;
  const primaryHex = isOversized ? '#ff3344' : '#00f0ff';
  const nameHex = isOversized ? '#ff8899' : '#e2e8f0';
  const titleText = isOversized ? 'Too Large' : 'Loading';

  // Wireframe icosahedron — pulses scale to read as "loading" or
  // stays static for the "Too Large" indicator (handled by the
  // animation loop's `oversized` skip below).
  const icoGeo = new THREE.IcosahedronGeometry(0.4, 0);
  const icoMat = new THREE.MeshBasicMaterial({
    color: primaryColor,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
  });
  group.add(new THREE.Mesh(icoGeo, icoMat));

  // Counter-rotation ring, matches the app's palette (purple for
  // loading, bright red for the oversized indicator).
  const ringGeo = new THREE.TorusGeometry(0.55, 0.02, 16, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: secondaryColor,
    transparent: true,
    opacity: 0.65,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Floating canvas-textured sprite label: "Loading / <name> / by <>".
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(7, 9, 14, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = primaryHex;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = primaryHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(titleText, canvas.width / 2, canvas.height / 2 - 28);
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = nameHex;
    const maxLen = 26;
    const displayName = name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
    ctx.fillText(displayName, canvas.width / 2, canvas.height / 2 + 8);
    // For oversized the requester line is suppressed — the user already
    // knows why they can't see it, and dropping the line keeps the
    // label visually focused on the failure mode.
    if (!isOversized) {
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#a855f7';
      ctx.fillText(`by ${requesterName}`, canvas.width / 2, canvas.height / 2 + 44);
    }
  }
  const spriteTexture = new THREE.CanvasTexture(canvas);
  spriteTexture.colorSpace = THREE.SRGBColorSpace;
  spriteTexture.needsUpdate = true;
  const spriteMat = new THREE.SpriteMaterial({ map: spriteTexture, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 0.9;
  group.add(sprite);

  const dispose = () => {
    icoGeo.dispose();
    icoMat.dispose();
    ringGeo.dispose();
    ringMat.dispose();
    // CRITICAL: explicit texture dispose to release GPU backing.
    spriteTexture.dispose();
    spriteMat.dispose();
  };

  return { group, dispose };
}

/**
 * Light-weight file-extension → AssetType mapping so the loading
 * placeholder's broadcast carries an accurate `type` field (peers
 * can render category-appropriate styling or skip irrelevant fields).
 */
function guessAssetType(filename: string): AssetType {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.vrm')) return 'vrm';
  if (lower.endsWith('.glb') || lower.endsWith('.gltf') || lower.endsWith('.obj') || lower.endsWith('.fbx')) return '3d-model';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')) return 'image';
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')) return 'video';
  return 'misc';
}

export const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Engine references
  const sceneEngineRef = useRef<SceneEngine | null>(null);
  const assetManagerRef = useRef<AssetManager | null>(null);
  const manipulationManagerRef = useRef<ManipulationManager | null>(null);
  const avatarManagerRef = useRef<AvatarManager | null>(null);
  const environmentManagerRef = useRef<EnvironmentManager | null>(null);
  const networkServiceRef = useRef<NetworkService>(new NetworkService());
  const inventoryServiceRef = useRef<InventoryService>(new InventoryService());
  const undoRedoManagerRef = useRef<UndoRedoManager>(new UndoRedoManager());
  const vrHudRef = useRef<VRHUDManager | null>(null);
  const brushManagerRef = useRef<BrushManager | null>(null);

  // Live in-flight import placeholders (loaded-asset id -> group +
  // dispose callback). Ref-stored instead of state because consumers
  // are 3D-side only; React re-renders on placeholder churn would
  // tank the render loop. Entries are added when the local host
  // starts an import (handleImportFile / handleImportAssetFromConfig)
  // OR when a remote peer's 'pending' broadcast arrives (net.onPendingSpawn),
  // and removed by registerOnAssetAdded's id-match on asset landing,
  // OR by net.onPendingCancel / net.onRemove / handleDisconnect.
  const pendingAssetsRef = useRef<Map<string, { group: THREE.Group; dispose: () => void; oversized?: boolean }>>(new Map());

  // UV of the VR HUD's curved screen under the right controller's aim
  // ray. Updated every animate-frame while the HUD is showing in VR;
  // read by the trigger-press VR handler so the click lands on the card
  // the user is actually pointing at (mirrors the desktop center-ray
  // hover above).
  const currentVrHudUvRef = useRef<THREE.Vector2 | null>(null);
  // Per-frame scratch raycaster for the VR HUD hover so we don't
  // clobber the shared `sceneEngine.raycaster` used by click selection
  // and the center-ray HUD highlight.
  const vrHudRaycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  // Per-frame scratch for the VR radial menu aim/select loop. Hoisted
  // out of the loop body to avoid ~270 Vec3/Quat/Ray allocations
  // per second at 90 Hz; mirrors the existing vrHudRaycasterRef
  // pattern. Reads/writes happen every frame, so the captured
  // references are safe to mutate in place.
  const vrRadialAimOriginRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const vrRadialAimDirQuatRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const vrRadialAimDirRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, -1));
  const vrRadialAimRayRef = useRef<THREE.Ray>(new THREE.Ray());

  // UI State
  const [mode, setMode] = useState<ConnectionMode>('offline');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [isHost, setIsHost] = useState<boolean>(true);
  const [currentTransformMode, setCurrentTransformMode] = useState<TransformMode>('translate');
  const [selectedAsset, setSelectedAsset] = useState<LoadedAsset | null>(null);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'first-person'>('first-person');
  const [showLocomotionBanner, setShowLocomotionBanner] = useState<boolean>(true);
  const [locomotionMode, setLocomotionMode] = useState<'walk' | 'flight' | 'noclip'>('walk');
  const [showSceneInspector, setShowSceneInspector] = useState<boolean>(false);
  // Ref so the canvas click handler can read the current value without
  // being re-created every time showSceneInspector changes.
  const showSceneInspectorRef = useRef(false);
  showSceneInspectorRef.current = showSceneInspector;
  // Set true by Ctrl+Shift+V keydown so the next paste event is treated as
  // plain text (no URL / data-URI import handling). Cleared in handlePaste
  // on the following paste event, or by a keyup safety net.
  const plainPasteModeRef = useRef(false);

  // Refs that mirror state read by the (single-bound) animation-loop
  // callback. The useRef declarations live here; the `.current = state`
  // hooks that mirror the values are placed immediately after the
  // matching useState further down so the const state has already been
  // declared by the time we read it (TS2454 otherwise).
  const activeToolRef = useRef<ToolType | null>('dev');
  const cameraModeRef = useRef<'orbit' | 'first-person'>('first-person');
  // Mirror of `locomotionMode` state so the engine-init useEffect's
  // onPanelAction dispatcher (captured with `[]` deps) can read the
  // live value instead of the initial 'walk' it closed over. Same
  // pattern as activeToolRef / cameraModeRef above; kept in sync by
  // a small useEffect further down.
  const locomotionModeRef = useRef<'walk' | 'flight' | 'noclip'>('walk');
  const lastMouseNdcRef = useRef<THREE.Vector2>(new THREE.Vector2(0, 0));

  // ID of the asset currently under the screen-center raycast. Updated
  // by the animation loop (throttled to ~14 Hz) so the crosshair and HUD
  // reflect what the dev tool's secondary action would hit. Only
  // mutated when the hit ID actually changes, so React only re-renders
  // on transitions, not every frame.
  const [centerRayHitAssetId, setCenterRayHitAssetId] = useState<string | null>(null);
  const centerRayHitAssetIdRef = useRef<string | null>(null);
  // True when the locked crosshair is hovering over a spatial panel.
  // Drives a distinct crosshair visual (cyan hand icon instead of dot).
  const [isCrosshairOverPanel, setIsCrosshairOverPanel] = useState<boolean>(false);
  
  // Resonite Radial Context Menu & Grab modes
  // Ref mirror of showRadialMenu. React-state-reading event
  // handlers defined inside `[]`-deps useEffect closures
  // (notably the engine-init's onCanvasAuxMouseDown and the
  // radial menu's window-level capture-phase handler) would
  // otherwise read the value as it existed on first render
  // forever. Use this ref for any such reader to get the LIVE
  // state. (See handleKeyDown's `plainPasteModeRef` and
  // activeToolRef for the same pattern.)
  const showRadialMenuRef = useRef<boolean>(false);
  const [showRadialMenu, setShowRadialMenu] = useState<boolean>(false);
  // Mirrors manipulationManager.isGrabDragging so the radial context menu
  // can expose a 'held' tab with Destroy / Duplicate / Save Held actions
  // when the user is carrying an object (RMB-grab OR VR grip). Updated
  // by the engine-init useEffect's registerOnGrabBegin/End listeners
  // below. Distinct from isDragging (which fires for gizmo drags too,
  // and we only want true holding semantics for the held menu).
  const [isHeld, setIsHeld] = useState<boolean>(false);
  // Mirrors the type of the currently held asset so the radial context
  // menu can swap its held-tab slice labels (e.g. show "Download"
  // instead of "Duplicate" when the held item is a misc file). Cleared
  // on grab-end; null while nothing is held.
  const [heldAssetType, setHeldAssetType] = useState<AssetType | null>(null);
  const [radialMenuPos, setRadialMenuPos] = useState<{ x: number; y: number }>({ x: 500, y: 500 });
  // VR radial menu (canvas-textured mesh). `vrRadialOpen` tracks open
  // state; `vrRadialMenuRef` holds the lazily-constructed VRRadialMenuMesh
  // (the mesh is built on first B/Y press and re-used across cycles so its
  // texture / geometry aren't churned). `vrRadialActiveSideRef` records
  // which controller placed the mesh so the per-frame aim loop can poll
  // the correct XRTargetRaySpace. We use VRRadialMenuMesh's canvas
  // texture for VR — pure immersive WebXR can't rasterise the
  // React-DOM <svg>-based RadialContextMenu through HTMLMesh's
  // html2canvas path, so any radial menu mounted into SpatialPanelManager
  // came out blank. The desktop <RadialContextMenu> overlay path
  // (`setShowRadialMenu`) is unchanged.
  const [vrRadialOpen, setVrRadialOpen] = useState(false);
  const vrRadialMenuRef = useRef<VRRadialMenuMesh | null>(null);
  // Which controller the menu was placed near. Cached so the per-frame
  // aim loop can build its ray from the same controller that placed it
  // (rather than whichever one is being waved at any given moment).
  // `null` while the menu is closed.
  const vrRadialActiveSideRef = useRef<'left' | 'right' | null>(null);
  const [scalingEnabled, setScalingEnabled] = useState<boolean>(true);
  const [laserEnabled, setLaserEnabled] = useState<boolean>(true);
  const [grabMode, setGrabMode] = useState<'auto' | 'precision' | 'palm' | 'laser'>('auto');
  const [transformSpace, setTransformSpace] = useState<'local' | 'world'>('local');
  
  // Modals
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [shareModalTab, setShareModalTab] = useState<'multiplayer' | 'pairing'>('multiplayer');
  const [showInventoryModal, setShowInventoryModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [showImportDialog, setShowImportDialog] = useState<boolean>(false);
  const [importInitialFile, setImportInitialFile] = useState<File | null>(null);
  const [showWorldEnvModal, setShowWorldEnvModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showChatPanel, setShowChatPanel] = useState<boolean>(false);
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);
  // Rolling buffer of recent chat messages; mirrors VRHUDManager's
  // internal _recentMessages for the React-driven setDataContext push
  // (the manager keeps its own copy via appendIncomingChat so the canvas
  // redraws on every keystroke without paying the React render cost).
  // Capped to 30 -- matched to VRHUDManager.CHAT_MESSAGE_HISTORY.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  // Permissions & Dash Menu State
  const [localRole, setLocalRole] = useState<UserRole>('admin');
  const [defaultPermissionsConfig, setDefaultPermissionsConfig] = useState<DefaultPermissionsConfig>({
    anonymousDefaultRole: 'guest',
    registeredDefaultRole: 'builder',
    contactsDefaultRole: 'builder',
    hostRole: 'admin'
  });
  const [showDashMenu, setShowDashMenu] = useState<boolean>(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  // Mirror of inventoryItems state held in a ref so the VR panel-based
  // useEffect dependency array can read fresh data without forcing a
  // re-render every time  is called. Without this
  // the  state read in the deps array would need to be
  // re-pushed every render anyway, and the panel would lag a tick.
  const inventoryItemsRef = useRef<InventoryItem[]>([]);
  // Mirror of `selectedAsset` state held in a ref so App.tsx's
  // inspect.* action dispatcher (a useEffect-closure callback) can
  // read the LIVE currently-selected asset instead of the
  // engine-init-time value. Same pattern as `inventoryItemsRef`,
  // `showRadialMenuRef`, `locomotionModeRef` above. Synced by the
  // mirror useEffect further below.
  const selectedAssetRef = useRef<LoadedAsset | null>(null);
  const [showToolsPanel, setShowToolsPanel] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<ToolType | null>('dev');
  const [brushWidth, setBrushWidth] = useState<number>(0.05);

  // Stats & Settings state triggers for reactive UI
  const [stats, setStats] = useState({ fps: 60, drawCalls: 0, triangles: 0 });
  const [graphicsSettings, setGraphicsSettings] = useState<GraphicsSettings>({
    resolutionScale: 1.0,
    shadowQuality: 'high',
    antiAliasing: 'msaa',
    msaaSamples: 4,
    postProcessing: false,
    lodBias: 1.0,
    progressiveLOD: false,
    lodTargetDensity: 200_000,
    lodOverrideLevel: undefined
  });
  const [envSettings, setEnvSettings] = useState<EnvironmentSettings>({
    atmosphere: 'cyber-nebula',
    gridVisible: true,
    gridSize: 'standard-60',
    gridColor: 'cyan',
    ambientIntensity: 0.4,
    dirLightIntensity: 1.5,
  });

  // Mirror activeTool / cameraMode state into refs so the single-bound
  // animation-loop callback (registered in the engine-init effect
  // directly below) can read live values without re-binding. Doing
  // this in effects (rather than inline during render) avoids any
  // use-state-before-useRef ordering concern (TS2454 / TDZ).
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);
  // Sync the locomotionMode ref mirror so onPanelAction's radial:right
  // handler reads the current value (not the engine-init useEffect's
  // stale closure of the initial 'walk' state).
  useEffect(() => {
    locomotionModeRef.current = locomotionMode;
  }, [locomotionMode]);
  // Sync the menu-open ref mirror so []-deps-closure handlers
  // (onCanvasAuxMouseDown in particular) see the LIVE value
  // when toggling via MMB.
  useEffect(() => {
    showRadialMenuRef.current = showRadialMenu;
  }, [showRadialMenu]);
  // Sync selectedAssetRef mirror so closure-bound dispatchers (the
  // engine-init useEffect's onPanelAction that handles inspect.*)
  // see the LIVE selectedAsset rather than the engine-init-time null.
  useEffect(() => {
    selectedAssetRef.current = selectedAsset;
  }, [selectedAsset]);

  // Mirror refs read by VRRadialMenuMesh callbacks. The mesh stores
  // its callbacks at construction time, so any callback closure that
  // reads React state directly goes stale as soon as the user clicks
  // a slice (analogous to the desktop onPanelAction stale-closure
  // fix that introduced locomotionModeRef). Mirrors update synchronously
  // in a useEffect after each render commit, so the NEXT event tick
  // already sees fresh values — no per-frame lag.
  const grabModeRef = useRef<'auto' | 'precision' | 'palm' | 'laser'>('auto');
  const isHeldRef = useRef<boolean>(false);
  const heldAssetTypeRef = useRef<string | null>(null);
  const scalingEnabledRef = useRef<boolean>(true);
  const laserEnabledRef = useRef<boolean>(true);
  useEffect(() => { grabModeRef.current = grabMode; }, [grabMode]);
  useEffect(() => { isHeldRef.current = isHeld; }, [isHeld]);
  useEffect(() => {
    heldAssetTypeRef.current = heldAssetType === null ? null : String(heldAssetType);
  }, [heldAssetType]);
  useEffect(() => { scalingEnabledRef.current = scalingEnabled; }, [scalingEnabled]);
  useEffect(() => { laserEnabledRef.current = laserEnabled; }, [laserEnabled]);

  // Per-frame aim/select for VRRadialMenuMesh. Reads the active XR
  // controller (the one whose B/Y button placed the mesh) for its
  // current world pose, builds a Ray, and updates the mesh's
  // hover state. On trigger-press this frame, fires select() which
  // runs the callback for the highlighted slice (or the hub for tab
  // swap). Reads `vrRadialActiveSideRef.current` so the aim loop
  // always uses the SAME controller that placed the menu (otherwise
  // the user could be aiming with the *other* hand and selecting
  // slices they can't see). The effect runs only while vrRadialOpen
  // is true so the cost is one rAF tick while open and zero while closed.
  // Cleanup the lazily-constructed VRRadialMenuMesh on unmount.
  // Without this, a renderer's CanvasTexture + PlaneGeometry + BasicMaterial
  // stay referenced after the App has unmounted (they're not owned by
  // React state, so React's cleanup doesn't reach them). The empty-deps
  // effect runs the returned cleanup exactly once when the App unmounts.
  useEffect(() => {
    return () => {
      const m = vrRadialMenuRef.current;
      if (m) {
        if (m.group.parent) m.group.parent.remove(m.group);
        m.dispose();
        vrRadialMenuRef.current = null;
      }
    };
  }, []);

    useEffect(() => {
    if (!vrRadialOpen) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const mesh = vrRadialMenuRef.current;
      const se = sceneEngineRef.current;
      const side = vrRadialActiveSideRef.current;
      if (!mesh || mesh.disposed || !se || !se.renderer.xr.isPresenting || !mesh.isVisible || !side) return;
      const ctr = se.vrInput?.getController(side);
      if (!ctr) return;
      ctr.updateWorldMatrix(true, false);
      // Allocation-free: hoisted scratch refs (vrRadialAim*Ref) reused
      // across frames. .copy / .setFrom* mutate in place.
      vrRadialAimOriginRef.current.setFromMatrixPosition(ctr.matrixWorld);
      vrRadialAimDirQuatRef.current.setFromRotationMatrix(ctr.matrixWorld);
      vrRadialAimDirRef.current
        .set(0, 0, -1)
        .applyQuaternion(vrRadialAimDirQuatRef.current)
        .normalize();
      // Re-place the menu every frame so it follows the active
      // controller's current pose (origin + laser direction).
      // The previous flow only placed once on B/Y press, leaving
      // the menu world-anchored -- wrist motion then drifted the
      // aim ray off the panel and the user reported the buttons
      // as 'non-interactive' despite updateAim + select() running
      // correctly. placeNearController is now allocation-free
      // (uses scratch refs internally), so re-placing at 90 Hz
      // is GC-neutral. Must come BEFORE updateAim so the raycast
      // tests against the freshly-followed mesh position.
      mesh.placeNearController(vrRadialAimOriginRef.current, vrRadialAimDirRef.current);
      vrRadialAimRayRef.current.set(vrRadialAimOriginRef.current, vrRadialAimDirRef.current);
      mesh.updateAim(vrRadialAimRayRef.current);
      const ctrlState = side === 'left' ? se.vrInput?.left : se.vrInput?.right;
      if (ctrlState?.pressedThisFrame?.trigger) mesh.select();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [vrRadialOpen]);

  // Push React state into the lazy VRRadialMenuMesh so slice labels
  // recolour on toggle (e.g. SCALE goes from red to green when
  // scalingEnabled flips). The mesh stays the same instance across
  // re-renders, so its canvas texture re-rasterises only when the
  // tracked inputs actually change. Each tick = one setState call,
  // cheap.
  useEffect(() => {
    vrRadialMenuRef.current?.setState({
      locomotionMode,
      scalingEnabled,
      laserEnabled,
      grabMode,
      isHeld,
      heldAssetType: heldAssetType === null ? null : String(heldAssetType),
    });
  }, [locomotionMode, scalingEnabled, laserEnabled, grabMode, isHeld, heldAssetType]);

  // Initialize 3D Viewport & Engines
  useEffect(() => {
    if (!containerRef.current) return;
    
    const sceneEngine = new SceneEngine(containerRef.current);
    sceneEngineRef.current = sceneEngine;

    const assetManager = new AssetManager(sceneEngine.scene, sceneEngine.worldRoot);
    assetManagerRef.current = assetManager;

    // Pass `assetManager.assets` so the manager's RMB-grab raycast can
    // hit-detect on the same live Map App.tsx spawns into (the Map is
    // mutated in place — single reference is always current). The 5th
    // arg is what enables the Right-Mouse-Button grab feature called out
    // in Controls-Keybinds.txt.
    const manipulationManager = new ManipulationManager(
      sceneEngine.scene,
      sceneEngine.camera,
      sceneEngine.renderer.domElement,
      sceneEngine.controls,
      assetManager.assets
    );
    manipulationManagerRef.current = manipulationManager;
    // Wire VR input so the held-asset dolly can read the holding
    // controller's thumbstick Y. SceneEngine constructs
    // VRInputManager synchronously in its constructor (see
    // SceneEngine.setupXR), so this ref is already live by the
    // time the engine-init useEffect wires it. Null safety
    // guaranteed — the dolly path early-returns without input.
    manipulationManager.setVRInput(sceneEngine.vrInput);

    const avatarManager = new AvatarManager(sceneEngine.scene, sceneEngine.camera, sceneEngine.worldRoot);
    avatarManagerRef.current = avatarManager;

    const environmentManager = new EnvironmentManager(
      sceneEngine.scene,
      sceneEngine.worldRoot,  // <- NEW: grid lives under worldRoot so VR
                              //         inverse-treadmill translates it
                              //         together with the floor
                              //         (was previously parented to scene
                              //          which made the grid appear to
                              //          "rise with the player" on jump).
      sceneEngine.ambientLight,
      sceneEngine.dirLight
    );
    environmentManagerRef.current = environmentManager;

const vrHud = new VRHUDManager(
        sceneEngine.scene,
        sceneEngine.camera,
        (item) => {
          // System cards route to a 3D panel in pure immersive VR
          // (React DOM modals are invisible in immersive WebXR);
          // desktop falls through to the existing setShow*Modal flow.
          if (item.type === 'system') {
            if (sceneEngineRef.current?.renderer.xr.isPresenting) {
              vrHudRef.current?.openPanel(item.id);
            } else {
              switch (item.id) {
                case 'sys-session':
                  setShowDashMenu(true);
                  break;
                case 'sys-inventory':
                  setShowInventoryModal(true);
                  break;
                case 'sys-settings':
                  setShowSettingsModal(true);
                  break;
                case 'sys-env':
                  setShowWorldEnvModal(true);
                  break;
                case 'sys-share':
                  setShareModalTab('multiplayer');
                  setShowShareModal(true);
                  break;
                case 'sys-pair':
                  setShareModalTab('pairing');
                  setShowShareModal(true);
                  break;
                case 'sys-radial':
                  setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                  setShowRadialMenu(true);
                  break;
                case 'sys-chat':
                  // Open the React ChatPanel on desktop (already used by
                  // navbar); open the VR 3D chat panel on immersive VR.
                  if (sceneEngineRef.current?.renderer.xr.isPresenting) {
                    vrHudRef.current?.openPanel('sys-chat');
                  } else {
                    setUnreadChatCount(0);
                    setShowChatPanel(true);
                  }
                  break;
                case 'sys-inspector':
                  setShowSceneInspector(true);
                  break;
              }
            }
            return;
          }
          handleSpawnFromInventory(item);
        },
        () => {
          setShowDashMenu(false);
        },
        {
          // Per-panel-button dispatcher. The 3D panels fire these when
          // the user clicks a button on a panel in VR. Backbone of the
          // 'no React DOM in pure immersive VR' UX path.
          onPanelAction: (actionId: string) => {
            if (!actionId) return;
            const se = sceneEngineRef.current;
            const em = environmentManagerRef.current;
            if (actionId.startsWith('inv.spawn:')) {
              const itemId = actionId.substring('inv.spawn:'.length);
              inventoryServiceRef.current?.getItem(itemId).then((it) => {
                if (it) handleSpawnFromInventory(it);
              });
              return;
            }
            if (actionId.startsWith('settings.resScale:')) {
              const v = parseFloat(actionId.substring('settings.resScale:'.length));
              if (!Number.isNaN(v)) se?.updateSettings({ resolutionScale: v });
              return;
            }
            if (actionId.startsWith('settings.shadow:')) {
              const q = actionId.substring('settings.shadow:'.length) as 'off' | 'low' | 'medium' | 'high' | 'ultra';
              se?.updateSettings({ shadowQuality: q });
              return;
            }
            if (actionId.startsWith('settings.aa:')) {
              const aa = actionId.substring('settings.aa:'.length) as 'none' | 'fxaa' | 'msaa';
              se?.updateSettings({ antiAliasing: aa });
              return;
            }
            if (actionId === 'settings.progressiveLod:toggle') {
              const cur = se?.settings?.progressiveLOD ?? false;
              se?.updateSettings({ progressiveLOD: !cur });
              return;
            }
            if (actionId.startsWith('env.atmosphere:')) {
              const id = actionId.substring('env.atmosphere:'.length);
              em?.applySettings({ atmosphere: id as AtmospherePreset });
              return;
            }
            if (actionId === 'env.grid:toggle') {
              const cur = em?.settings?.gridVisible ?? true;
              em?.applySettings({ gridVisible: !cur });
              return;
            }
            if (actionId === 'share:joinRandom') {
              const room = `nexus-${Math.random().toString(36).substring(2, 7)}`;
              handleJoinRoom(room, 'online', false);
              return;
            }
            if (actionId === 'share:disconnect') {
              handleDisconnect();
              return;
            }
            if (actionId === 'pair:host') {
              const code = `PAIR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
              handleJoinRoom(code, 'paired', false);
              return;
            }
            // === VR 3D radial panel actions ===
            // Mirrors the desktop RadialContextMenu's onClick handler
            // for each slice. The 'radial:tab' action is handled
            // internally by VRHUDManager.runPanelAction and never
            // reaches here. Tab-dependent slices (right/bottom/left)
            // use the VR HUD's current radialTab to decide which
            // mutation to fire; this matches the desktop's two-tab
            // radial behavior (general vs grab).
            // NOTE: locomotionModeRef is read here (NOT the React
            // state `locomotionMode`) because this dispatcher is
            // captured in the engine-init useEffect with `[]` deps.
            // Reading the React state would see the initial 'walk'
            // forever; the ref mirror is kept in sync by a small
            // useEffect below. scalingEnabled / laserEnabled / grabMode
            // use functional setters so they're naturally fresh.
            if (actionId === 'radial:undo') {
              undoRedoManagerRef.current.undo();
              return;
            }
            if (actionId === 'radial:redo') {
              undoRedoManagerRef.current.redo();
              return;
            }
            if (actionId === 'radial:right') {
              const tab = vrHudRef.current?.radialTab ?? 'general';
              if (tab === 'general') {
                // Cycle walk -> flight -> noclip -> walk. Route through
                // handleSetLocomotionMode (not just the React setter)
                // so sceneEngine.locomotionMode is kept in sync, same
                // as the desktop's onSetLocomotionMode handler chain.
                // Read from the ref mirror to avoid the engine-init
                // useEffect's stale closure of `locomotionMode` state.
                const cur = locomotionModeRef.current;
                const next = cur === 'walk' ? 'flight' : cur === 'flight' ? 'noclip' : 'walk';
                handleSetLocomotionMode(next);
              } else {
                // Cycle auto -> precision -> palm -> laser -> auto.
                // grabMode is React-only (no scene state), so a plain
                // setGrabMode is correct.
                setGrabMode((m) =>
                  m === 'auto' ? 'precision' :
                  m === 'precision' ? 'palm' :
                  m === 'palm' ? 'laser' : 'auto'
                );
              }
              return;
            }
            if (actionId === 'radial:bottom') {
              const tab = vrHudRef.current?.radialTab ?? 'general';
              if (tab === 'general') {
                setScalingEnabled((v) => !v);
              } else {
                // Snap-grid toggle is a future feature; no-op for v1
                // so the slice isn't dead in the grab tab.
                console.log('[radial] snap-grid toggle (no-op in v1)');
              }
              return;
            }
            if (actionId === 'radial:left') {
              const tab = vrHudRef.current?.radialTab ?? 'general';
              if (tab === 'general') {
                setLaserEnabled((v) => !v);
              } else {
                // Collision toggle is owned by ManipulationManager.
                manipulationManagerRef.current?.toggleCollision();
              }
              return;
            }
            // === VR 3D chat send ===
            // The VR chat panel alphabet grid accumulates characters in
            // VRHUDManager._chatInputBuffer; the SEND button on that grid
            // bubbles 'chat.send:<text>' here. Forward to the network
            // and ask the manager to clear its buffer (the clear fires
            // a redraw so the buffer strip empties on the next frame).

            // === Inspector edits (sys-inspector panel) ===
            // Mirror of the desktop SceneInspectorWindow's
            // onUpdateAsset + handleUpdateMaterial handlers. Routes
            // 30+ `inspect.*` actions dispatched by the canvas-rendered
            // VR inspector.
            //
            // Each successful edit:
            //   1) Mutates selectedAsset.object3d (and material where
            //      applicable) directly via THREE Object3D / Material
            //      APIs. Three.js requires `material.needsUpdate` to
            //      be set after wireframe / flatShading toggles +
            //      emissiveIntensity changes.
            //   2) Bumps the React state via `setSelectedAsset({...sel})`
            //      so the existing setDataContext effect pushes the
            //      updated asset to VRHUDManager (and the desktop
            //      SceneInspectorWindow re-renders).
            //   3) Broadcasts via `networkService.broadcastAssetUpdate`
            //      so peers see the edit (no-op when offline).
            //   4) Refreshes the manipulation gizmo via
            //      `manipulationManager.selectAsset(sel)` so its
            //      handles snap to the new pose (otherwise the gizmo
            //      drifts away from the edited object).
            //   5) Force-redraws the VRHUDManager panel via
            //      `vrHud.redrawPanel()` so the displayed values
            //      reflect the new state on the immediately-following
            //      frame (instead of waiting for the next setDataContext
            //      round-trip).
            if (actionId.startsWith('inspect.')) {
              const sel = selectedAssetRef.current;
              if (sel?.object3d) {
                const o3d = sel.object3d;
                const mats: THREE.Material[] = [];
                o3d.traverse((c: THREE.Object3D) => {
                  const m = (c as THREE.Mesh).material;
                  if (m) {
                    if (Array.isArray(m)) mats.push(...m);
                    else mats.push(m as THREE.Material);
                  }
                });

                // apply post-edit housekeeping. Cheap; runs every time.
                const dirty = () => {
                  setSelectedAsset({ ...sel });
                  networkServiceRef.current?.broadcastAssetUpdate(sel);
                  manipulationManagerRef.current?.selectAsset?.(sel);
                  vrHudRef.current?.redrawPanel();
                };

                // ---- Toggles ----
                if (actionId === 'inspect.toggle:visible') {
                  o3d.visible = !o3d.visible;
                  dirty();
                  return;
                }
                if (actionId === 'inspect.toggle:active') {
                  const ud = o3d.userData as { active?: boolean };
                  ud.active = !(ud.active ?? true);
                  dirty();
                  return;
                }
                if (actionId === 'inspect.toggle:wireframe') {
                  for (const m of mats) {
                    (m as THREE.MeshStandardMaterial).wireframe = !(m as THREE.MeshStandardMaterial).wireframe;
                    m.needsUpdate = true;
                  }
                  dirty();
                  return;
                }
                if (actionId === 'inspect.toggle:flatShading') {
                  for (const m of mats) {
                    (m as THREE.MeshStandardMaterial).flatShading = !(m as THREE.MeshStandardMaterial).flatShading;
                    m.needsUpdate = true;
                  }
                  dirty();
                  return;
                }

                // ---- Transform steppers ----
                // IDs: 'inspect.transform:<pos|rot|scl>.<x|y|z><+|->'
                //   or  'inspect.transform:<pos|rot|scl>.<x|y|z>.reset'
                // The 0.1 step is in METRES for position / scale and in
                // RADIANS (pi/12 ≈ 15deg) for rotation, matching the
                // stepper copy in drawInspectorPanel.
                const STEP = 0.1;
                const ROT_STEP = Math.PI / 12;
                if (actionId.startsWith('inspect.transform:')) {
                  const tail = actionId.substring('inspect.transform:'.length);
                  if (tail === 'resetAll') {
                    o3d.position.set(0, 0, 0);
                    o3d.rotation.set(0, 0, 0);
                    o3d.scale.set(1, 1, 1);
                    dirty();
                    return;
                  }
                  if (tail === 'centerPivot') {
                    // Recenters child mesh geometries around 0,0,0 in
                    // o3d-local space and offsets o3d.position so the
                    // visible world pose is preserved.
                    const box = new THREE.Box3().setFromObject(o3d);
                    if (!box.isEmpty()) {
                      const center = new THREE.Vector3();
                      box.getCenter(center);
                      o3d.position.add(center);
                      o3d.children.forEach((c: THREE.Object3D) => {
                        const mesh = c as THREE.Mesh;
                        if (mesh.isMesh && mesh.geometry) {
                          mesh.geometry.translate(-center.x, -center.y, -center.z);
                        }
                      });
                    }
                    dirty();
                    return;
                  }
                  // per-axis pattern: 'pos.x+' | 'rot.y.reset' | ...
                  const m = /^([a-z]{3})\.([xyz])((\+|-)|\.reset)$/.exec(tail);
                  if (m) {
                    const kind = m[1] as 'pos' | 'rot' | 'scl';
                    const axis = m[2] as 'x' | 'y' | 'z';
                    const op = m[4];
                    const target: any =
                      kind === 'pos' ? o3d.position :
                      kind === 'rot' ? o3d.rotation : o3d.scale;
                    if (op === '.reset') {
                      target[axis] = kind === 'scl' ? 1 : 0;
                    } else {
                      const sign = op === '-' ? -1 : 1;
                      const delta = kind === 'rot' ? ROT_STEP : STEP;
                      target[axis] = (target[axis] as number) + sign * delta;
                    }
                    dirty();
                    return;
                  }
                }

                // ---- Material color (R / G / B) ----
                // IDs: inspect.material.color.<r|g|b>(+|-|reset)
                if (actionId.startsWith('inspect.material.color.')) {
                  const tail = actionId.substring('inspect.material.color.'.length);
                  const chan = tail[0] as 'r' | 'g' | 'b';
                  const op = tail.substring(1);
                  const delta = 5 / 255; // ~0.019
                  for (const m of mats) {
                    const c2 = m.color as THREE.Color;
                    if (op === 'reset') {
                      c2.setRGB(1, 1, 1);
                    } else {
                      const sign = op === '-' ? -1 : 1;
                      const cur = (c2 as any)[chan] as number;
                      const nv = Math.max(0, Math.min(1, cur + sign * delta));
                      (c2 as any)[chan] = nv;
                    }
                    m.needsUpdate = true;
                  }
                  dirty();
                  return;
                }

                // ---- Material scalar sliders ----
                // IDs: inspect.material.props:<prop>(+|.reset)
                //   where prop in roughness | metalness | opacity | emissive
                // 'emissive' maps to material.emissiveIntensity (0..5),
                // the others map to direct material properties (0..1).
                if (actionId.startsWith('inspect.material.props:')) {
                  const prop = actionId.substring('inspect.material.props:'.length);
                  const delta = 0.05;
                  // Parse op suffix
                  let p = prop; let op = '+';
                  if (prop.endsWith('.reset')) { p = prop.slice(0, -7); op = 'reset'; }
                  else { op = prop.slice(-1); p = prop.slice(0, -1); }
                  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
                  const clamp05 = (n: number) => Math.max(0, Math.min(5, n));
                  for (const m of mats) {
                    if (p === 'emissive') {
                      const mi = (m as any).emissiveIntensity as number ?? 1;
                      (m as any).emissiveIntensity = op === 'reset' ? 1 : clamp05(mi + (op === '-' ? -delta : delta));
                      m.needsUpdate = true;
                    } else if (p === 'roughness' || p === 'metalness' || p === 'opacity') {
                      const cur = (m as any)[p] as number ?? (p === 'opacity' ? 1 : 0);
                      (m as any)[p] = op === 'reset'
                        ? (p === 'opacity' ? 1 : 0.5)
                        : clamp01(cur + (op === '-' ? -delta : delta));
                      m.needsUpdate = true;
                    }
                  }
                  dirty();
                  return;
                }

                // ---- Slot actions ----
                if (actionId === 'inspect.destroy:selected') {
                  // handleDeleteSelected already does the right thing
                  // for the desktop inspector; reuse it. The inspector
                  // panel's `applyInspectorEdit` for destroy is
                  // routed through handleDeleteSelected so both VR and
                  // desktop pointed at the same selected asset take
                  // the same path (broadcast, undo/redo snapshot,
                  // selection-clear, ref disposal, etc.).
                  handleDeleteSelected();
                  return;
                }
                if (actionId === 'inspect.jumpTo:selected') {
                  // Teleport the camera to the asset's world position.
                  // No asset-state change -- just re-position the
                  // sceneEngine camera. We deliberately skip
                  // setSelectedAsset here because nothing on the
                  // selectedAsset changed (avoids spurious panel redraw).
                  const se = sceneEngineRef.current;
                  if (se) {
                    const worldPos = new THREE.Vector3();
                    o3d.getWorldPosition(worldPos);
                    se.camera.position.copy(worldPos);
                  }
                  return;
                }
                if (actionId === 'inspect.bringTo:camera') {
                  // Move the asset to the camera's world position.
                  // Use camera-local forward offset (-2m in camera Z)
                  // so the asset doesn't appear inside the camera.
                  const se = sceneEngineRef.current;
                  if (se) {
                    const camPos = new THREE.Vector3();
                    se.camera.getWorldPosition(camPos);
                    const camDir = new THREE.Vector3();
                    se.camera.getWorldDirection(camDir);
                    const TARGET_AHEAD = 2.0;
                    o3d.position.copy(camPos).addScaledVector(camDir, TARGET_AHEAD);
                    dirty();
                  }
                  return;
                }

                // ---- Hierarchy actions ----
                if (actionId === 'inspect.hierarchy:wrap') {
                  // Wrap o3d in a fresh empty THREE.Group, preserving
                  // o3d's world transform via Group.attach() (which
                  // copies the world matrix into the new parent).
                  const grp = new THREE.Group();
                  grp.name = o3d.name + ' Group';
                  const parent = o3d.parent;
                  if (parent) {
                    parent.add(grp);
                    grp.attach(o3d);
                  }
                  dirty();
                  return;
                }
                if (actionId === 'inspect.hierarchy:addChild') {
                  // Inject an empty THREE.Group as a direct child, so
                  // the user can drag children into it. The empty
                  // group is created at world origin; subsequent edits
                  // can move it via the transform stepper.
                  const grp = new THREE.Group();
                  grp.name = (o3d.name || 'Asset') + ' Child';
                  o3d.add(grp);
                  dirty();
                  return;
                }
                if (actionId === 'inspect.hierarchy:parentToWorld') {
                  // Reparent o3d to the scene's world root (the
                  // 'worldRoot' group that wraps VR-inverse-treadmill
                  // and locomotion translation). Using attach()
                  // preserves world transform.
                  const se = sceneEngineRef.current;
                  if (se?.worldRoot) {
                    se.worldRoot.attach(o3d);
                    dirty();
                  }
                  return;
                }

                // ---- Rename cycle ----
                if (actionId === 'inspect.rename:cycle') {
                  // Walk through 'A','B','C','D','E','F','9' suffixes
                  // applied to the existing base name. The desktop
                  // uses an actual text input; VR uses cycling because
                  // a 26-key alphabet grid would consume too much of
                  // the canvas panel (the chat grid already eats ~40%
                  // of the panel for the same reason).
                  const cycle = ['A', 'B', 'C', 'D', 'E', 'F', '9'] as const;
                  const baseName = (sel.name ?? o3d.name ?? 'Asset').trim();
                  const m2 = /^(.*?)\s*\(?([A-F9]?)\)?\s*$/.exec(baseName);
                  const base = m2 ? m2[1].trim() : baseName;
                  const curIdx = m2 && m2[2] ? cycle.indexOf(m2[2] as any) : -1;
                  const nextIdx = (curIdx + 1) % cycle.length;
                  const newName = `${base} (${cycle[nextIdx]})`;
                  sel.name = newName;
                  o3d.name = newName;
                  dirty();
                  return;
                }
              }
            }

            if (actionId.startsWith('chat.send:')) {
              const text = actionId.substring('chat.send:'.length);
              if (text.length > 0) {
                networkServiceRef.current.sendChatMessage(text);
                vrHudRef.current?.clearChatInput();
              }
              return;
            }
          }
        }
      );

    vrHudRef.current = vrHud;

    const brushManager = new BrushManager(sceneEngine.scene);
    brushManagerRef.current = brushManager;

    // Wire WebXR controller button presses to gameplay actions. The
    // handler closures capture refs + stable setters from useState; they
    // remain valid across re-renders. Reads `sceneEngineRef.current` on
    // each fire so a late-arriving XR session still routes events even
    // though the registration happened in `[]`-deps scope.
    if (sceneEngine.vrInput) {
      sceneEngine.vrInput.setHandlers({
        onPressed: (button, side) => {
          const se = sceneEngineRef.current;
          if (!se || !se.vrInput) return;
          const mm = manipulationManagerRef.current;
          const am = assetManagerRef.current;

          // A button (either hand): jump / ascend per locomotion mode —
          // mirrors the desktop Space-key handler in SceneEngine.
          if (button === 'a') {
            se.triggerVRJump();
            return;
          }
          // B button (right hand): toggle the Resonite radial context
          // menu. In VR we spawn it as a spatial panel near the right
          // controller; on desktop B/Y have the same 2D overlay toggle.
          if (button === 'b') {
            const se = sceneEngineRef.current;
            if (se && se.renderer.xr.isPresenting) {
              // VR path: lazy-create VRRadialMenuMesh on first open, then
              // toggle visibility. Canvas-textured radial — slices and slice
              // labels are drawn with Canvas2D, so they render correctly in
              // pure immersive WebXR. The previous approach tried to use
              // SpatialPanelManager + React portal + SVG <RadialContextMenu>;
              // SVG is invisible through HTMLMesh's html2canvas path, the
              // menu came out blank. Plus _buildHTMLMesh reparents the XR
              // controllers under the moving panel — now anchored to scene.
              setVrRadialOpen((prev) => {
                const next = !prev;
                const ctr = se.vrInput?.getController('right');
                if (next) {
                  if (vrRadialMenuRef.current === null) {
                    vrRadialMenuRef.current = new VRRadialMenuMesh(
                      buildVrRadialCallbacks(),
                      buildVrRadialInitialState()
                    );
                    se.scene.add(vrRadialMenuRef.current.group);
                  }
                  vrRadialActiveSideRef.current = 'right';
                  if (ctr) {
                    ctr.updateWorldMatrix(true, false);
                    const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);
                    const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);
                    const laserDir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
                    vrRadialMenuRef.current.placeNearController(origin, laserDir);
                  }
                  vrRadialMenuRef.current.setVisible(true);
                } else {
                  vrRadialMenuRef.current?.setVisible(false);
                  vrRadialActiveSideRef.current = null;
                }
                return next;
              });
            } else {
              // Desktop / non-VR fallback: 2D overlay
              setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
              setShowRadialMenu((prev) => !prev);
            }
            return;
          }
          // Y button (left hand): same as B, mirrors for left-handed users
          if (button === 'y') {
            const se = sceneEngineRef.current;
            if (se && se.renderer.xr.isPresenting) {
              // Same handler as B, but placed near the LEFT controller and
              // marked for left-side aim. See the B handler above for the
              // rationale (canvas texture to bypass SVG/HTMLMesh
              // invisibility, scene-root mesh to avoid the XR-controller
              // reparenting feedback loop).
              setVrRadialOpen((prev) => {
                const next = !prev;
                const ctr = se.vrInput?.getController('left');
                if (next) {
                  if (vrRadialMenuRef.current === null) {
                    vrRadialMenuRef.current = new VRRadialMenuMesh(
                      buildVrRadialCallbacks(),
                      buildVrRadialInitialState()
                    );
                    se.scene.add(vrRadialMenuRef.current.group);
                  }
                  vrRadialActiveSideRef.current = 'left';
                  if (ctr) {
                    ctr.updateWorldMatrix(true, false);
                    const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);
                    const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);
                    const laserDir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
                    vrRadialMenuRef.current.placeNearController(origin, laserDir);
                  }
                  vrRadialMenuRef.current.setVisible(true);
                } else {
                  vrRadialMenuRef.current?.setVisible(false);
                  vrRadialActiveSideRef.current = null;
                }
                return next;
              });
            } else {
              setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
              setShowRadialMenu((prev) => !prev);
            }
            return;
          }
          // X button (left hand): toggle the VR dash menu (curved HUD).
          // Per VRControls.txt: "X button - Open/Close Dash (Left
          // controller)". Previously the LEFT GRIP opened the dash,
          // but the spec says BOTH grips should grab and X opens the
          // dash — see FIX 1 above. Same toggle pattern as the desktop
          // Tab key handler.
          if (button === 'x') {
            inventoryServiceRef.current.getItems().then((items) => {
              vrHudRef.current?.setItems(items);
              vrHudRef.current?.toggle();
            });
            return;
          }
          // Grip buttons. Left grip opens the VR dash menu (curved HUD);
          // right grip grabs the asset under the right controller's aim.
          if (button === 'grip') {
            // Per VRControls.txt: BOTH grips grab. The dash is opened
            // by the X button (left controller) further down. Shared
            // raycast+grab helper used by both left and right grips
            // — keeps HUD-priority + parent-chain walk logic single-
            // sourced so the two sides can't drift.
            const tryVrGrab = (grabSide: 'left' | 'right') => {
              if (!mm || !am) return false;
              const ctr = se.vrInput?.getController(grabSide);
              const grip = se.vrInput?.getGrip(grabSide);
              if (!ctr || !grip) return false;
              ctr.updateWorldMatrix(true, false);
              const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);
              const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);
              const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
              se.raycaster.set(origin, dir);
              const targets: THREE.Object3D[] = [];
              const objToAsset = new Map<THREE.Object3D, LoadedAsset>();
              am.assets.forEach((a) => {
                targets.push(a.object3d);
                objToAsset.set(a.object3d, a);
              });
              // Include the VR HUD grab bars (dash + open panel) in the
              // same raycast pass so the user can physically carry them
              // with either grip. The grab bar has an invisible proxy
              // child (1.4m wide) for off-axis aim forgiveness; the
              // parent-walk below resolves a proxy hit up to the grab
              // bar mesh itself so the parent check is exact. HUD grab
              // is prioritized over asset grab because reaching for a
              // floating panel is the more common reflex than reaching
              // through the panel to grab an asset behind it.
              const hudForGrip = vrHudRef.current;
              if (hudForGrip && hudForGrip.isVisible) targets.push(hudForGrip.grabBarMesh);
              if (hudForGrip && hudForGrip.activePanel) targets.push(hudForGrip.panelGrabBarMesh);
              const hits = se.raycaster.intersectObjects(targets, true);
              if (hits.length === 0) return false;
              let hudCur: THREE.Object3D | null = hits[0].object;
              while (hudCur) {
                if (hudForGrip && hudCur === hudForGrip.grabBarMesh) {
                  hudForGrip.attachToGrip(grip);
                  return true;
                }
                if (hudForGrip && hudCur === hudForGrip.panelGrabBarMesh) {
                  hudForGrip.attachPanelToGrip(grip);
                  return true;
                }
                hudCur = hudCur.parent;
              }
              let cur: THREE.Object3D | null = hits[0].object;
              while (cur && !objToAsset.has(cur)) cur = cur.parent;
              if (cur) {
                const found = objToAsset.get(cur);
                if (found) {
                  mm.vrGrabWithController(found, grip, grabSide);
                  return true;
                }
              }
              return false;
            };
            if (side === 'left' || side === 'right') {
              tryVrGrab(side);
              return;
            }
          }
          // Trigger (right hand only — left triggers are reserved for
          // future activation; right is the canonical interaction
          // trigger per the OpenXR mapping).
          if (button === 'trigger') {
            // Both-sides trigger detection: if the trigger on
            // the OTHER hand is also currently held, the user
            // is doing a two-handed scale grab. Try to start
            // one on whichever asset BOTH lasers are pointing
            // at (must be the same asset, otherwise the user
            // is just doing two unrelated things at once).
            const otherSide: 'left' | 'right' = side === 'left' ? 'right' : 'left';
            const otherSideState = otherSide === 'left' ? se.vrInput?.left : se.vrInput?.right;
            const otherTriggerHeld = otherSideState?.buttons.trigger ?? false;
            if (otherTriggerHeld) {
              const ctrThis = se.vrInput?.getController(side);
              const ctrOther = se.vrInput?.getController(otherSide);
              if (ctrThis && ctrOther && am) {
                // Inlined raycast-at-controller (mirrors the
                // grip-handler's logic). Duplicating ~15 lines
                // is acceptable; if a third caller ever appears,
                // refactor to a shared helper.
                const raycastAt = (controller: THREE.Object3D): LoadedAsset | null => {
                  controller.updateWorldMatrix(true, false);
                  const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
                  const dirQuat = new THREE.Quaternion().setFromRotationMatrix(controller.matrixWorld);
                  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
                  se.raycaster.set(origin, dir);
                  const tgts: THREE.Object3D[] = [];
                  const o2a = new Map<THREE.Object3D, LoadedAsset>();
                  am.assets.forEach((a) => {
                    tgts.push(a.object3d);
                    o2a.set(a.object3d, a);
                  });
                  const hits = se.raycaster.intersectObjects(tgts, true);
                  if (hits.length === 0) return null;
                  let cur: THREE.Object3D | null = hits[0].object;
                  while (cur && !o2a.has(cur)) cur = cur.parent;
                  if (!cur) return null;
                  return o2a.get(cur) ?? null;
                };
                const hitThis = raycastAt(ctrThis);
                const hitOther = raycastAt(ctrOther);
                if (hitThis && hitOther && hitThis === hitOther) {
                  const gripL = se.vrInput.getGrip('left');
                  const gripR = se.vrInput.getGrip('right');
                  if (gripL && gripR) {
                    const posL = new THREE.Vector3().setFromMatrixPosition(gripL.matrixWorld);
                    const posR = new THREE.Vector3().setFromMatrixPosition(gripR.matrixWorld);
                    if (mm) mm.beginTwoHandedGrab(hitThis, posL, posR);
                    return;
                  }
                }
              }
            }
            // Single-handed right-trigger path: HUD click.
            // Runs even when the two-handed condition was
            // checked above (one-shot click is harmless if the
            // user is now in a two-handed grab instead — the
            // HUD click already fired before the second
            // trigger press). Left trigger without a co-held
            // right trigger is a no-op (left trigger was
            // previously reserved for future activation).
            if (side === 'right') {
              const hud = vrHudRef.current;
              if (hud && (hud.isVisible || hud.activePanel)) {
                const uv = currentVrHudUvRef.current;
                if (uv) hud.handleRayIntersection(uv);
              }
            }
          }
        },
        onReleased: (button, side) => {
          const mm = manipulationManagerRef.current;
          if (!mm) return;
          // Distinguish sides so a brief left-grip tap doesn't drop a
          // right-grip-held object. vrReleaseControllerGrab itself
          // no-ops when not mid-grab (`_isVRGrabbing === false`), so
          // double-routing both sides would be safe; doing it
          // side-aware also avoids spurious log lines in unknown grab
          // states.
          if (button === 'grip' && (side === 'left' || side === 'right')) {
            // Release the held asset on EITHER grip release — both
            // grips can now grab per VRControls.txt. vrReleaseControllerGrab
            // is side-agnostic (checks _isVRGrabbing), so calling it
            // on either side release is safe even if the other side
            // never grabbed. HUD detach below also covers both sides
            // because it checks currentGrip / panelCurrentGrip
            // regardless of which controller was carrying.
            mm.vrReleaseControllerGrab();
            const hud = vrHudRef.current;
            if (hud && hud.currentGrip) hud.detach();
            if (hud && hud.panelCurrentGrip) hud.detachPanel();
          }
          // Trigger release: end a two-handed scale grab in
          // flight, regardless of which side let go first.
          // endTwoHandedGrab is a no-op when no two-handed
          // grab is active, so this is safe to call from
          // either side. Releasing the second trigger after
          // the first is also a no-op (state already cleared).
          if (button === 'trigger') {
            mm.endTwoHandedGrab();
          }
        }
      });
    }

    const net = networkServiceRef.current;

    // Subscription accumulator. Every `registerOn*` / `net.on*` call
    // returns a cleanup that removes the listener from the owning
    // engine's internal Set; collected here so useEffect cleanup can
    // drop them all at once.
    //
    // Without this, React.StrictMode's dev double-mount (main.tsx wraps
    // <App> in <StrictMode>) runs engine-init effect after the sync
    // first-mount -> cleanup cycle. Mount 1's listeners stay attached
    // to the stable NetworkService's callback Sets AND close over
    // mount 2's fresh AssetManager/ManipulationManager, but mount 2
    // re-registers them -- every callback fires 2x per event. The
    // user-facing symptom: client imports a 3D model, host drags it
    // up, client tab freezes and ends up with giant duplicate meshes.
    // Each duplicate-listener broadcastSpawn sends 2 envelopes per
    // import; each envelope's base64 fileData forces a synchronous
    // atob() on the JS thread, freezing the renderer; each receiver's
    // importFile then races past `assets.has(id)` (Map is empty
    // pre-resolve) and does its own worldRoot.add(...) -> overlapping
    // duplicate meshes. Only the LAST entry persisted in the Map
    // receives subsequent `applyRemoteTransform` updates so the FIRST
    // visually stays put during host drag.
    const disposers: Array<() => void> = [];

    // Connect selection events
    disposers.push(manipulationManager.registerOnSelectionChange((asset) => {
      setSelectedAsset(asset);
    }));

    // Preserve the misc-file auto-inspect convenience that USED TO ride
    // on `selectAsset` from inside `beginGrab` — but routed here through
    // a dedicated grab-only listener so RMB-grab no longer mirrors the
    // dev tool's secondary action (R) in the gizmo-flash + selection-
    // chip UI. RMB still opens the misc preview; LMB/R-toggle selection
    // continues to do the same, but without the brief selection state-
    // flip in between.
    disposers.push(manipulationManager.registerOnGrabBegin((asset) => {
      // isHeld is true the moment any grab begins (RMB-grab, VR grip, or
      // two-handed scale). Drives the radial menu's 'held' tab.
      setIsHeld(true);
      setHeldAssetType(asset?.type ?? null);
    }));
    disposers.push(manipulationManager.registerOnGrabEnd(() => {
      setIsHeld(false);
      setHeldAssetType(null);
    }));

    // Connect transform change -> network broadcast.
    // NOTE: We *deliberately* do NOT touch `setSelectedAsset` here.
    // SceneInspectorWindow displays live position/rotation via an internal
    // requestAnimationFrame loop that imperatively syncs input.value from
    // `selectedAsset.object3d`, so React doesn't need a re-render every
    // drag delta. Earlier we spawned a new object reference here 60x/sec,
    // which forced the inspector's heavy useEffect (meshStats traverse +
    // 6 setStates) to repeat every frame and tanked framerate to ~20fps.
    disposers.push(manipulationManager.registerOnTransformChange((update) => {
      net.broadcastTransform(update);
    }));

    // --- Undo/Redo: capture transform snapshots around gizmo drags ---
    let preDragSnapshot: TransformSnapshot | null = null;
    let preDragAssetId: string | null = null;

    const captureSnapshot = (asset: LoadedAsset): TransformSnapshot => {
      const obj = asset.object3d;
      return {
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      };
    };

    const applyTransformSnapshot = (assetId: string, snap: TransformSnapshot) => {
      const asset = assetManager.assets.get(assetId);
      if (!asset) return;
      asset.object3d.position.set(...snap.position);
      asset.object3d.rotation.set(...snap.rotation);
      asset.object3d.scale.set(...snap.scale);
      net.broadcastAssetUpdate(asset);
      // If this asset is currently selected, force React re-render
      if (manipulationManager.selectedAsset?.id === assetId) {
        setSelectedAsset({ ...asset });
      }
    };

    disposers.push(manipulationManager.registerOnDragChange((dragging) => {
      // Capture the asset that's actually moving. For TC gizmo drags it
      // is `selectedAsset` (TC is attached to the gizmo of the selected
      // asset); for RMB-grabs it is `grabbedAsset`, since RMB-grab no
      // longer mutates selection state. If we read only `selectedAsset`,
      // RMB-grabs on non-selected assets would silently skip undo capture
      // because the "moved" comparison would be against the (unchanged)
      // selected asset's transform.
      const asset = manipulationManager.grabbedAsset ?? manipulationManager.selectedAsset;
      if (dragging && asset) {
        // Drag started: save snapshot
        preDragSnapshot = captureSnapshot(asset);
        preDragAssetId = asset.id;
      } else if (!dragging && preDragSnapshot && preDragAssetId) {
        // Drag ended: record undo action
        const afterAsset = assetManager.assets.get(preDragAssetId);
        if (afterAsset) {
          const afterSnap = captureSnapshot(afterAsset);
          const moved =
            preDragSnapshot.position[0] !== afterSnap.position[0] ||
            preDragSnapshot.position[1] !== afterSnap.position[1] ||
            preDragSnapshot.position[2] !== afterSnap.position[2] ||
            preDragSnapshot.rotation[0] !== afterSnap.rotation[0] ||
            preDragSnapshot.rotation[1] !== afterSnap.rotation[1] ||
            preDragSnapshot.rotation[2] !== afterSnap.rotation[2] ||
            preDragSnapshot.scale[0] !== afterSnap.scale[0] ||
            preDragSnapshot.scale[1] !== afterSnap.scale[1] ||
            preDragSnapshot.scale[2] !== afterSnap.scale[2];
          if (moved) {
            undoRedoManagerRef.current.recordTransform(
              preDragAssetId,
              `Transform ${afterAsset.name}`,
              preDragSnapshot,
              afterSnap,
              applyTransformSnapshot
            );
          }
        }
        preDragSnapshot = null;
        preDragAssetId = null;
      }
    }));

    // Connect asset additions -> save locally or broadcast
    disposers.push(assetManager.registerOnAssetAdded((asset) => {
      // Loading-placeholder consumption: if a placeholder with this
      // asset's id was registered (either by the LOCAL host on Import
      // click OR by a remote peer on receipt of the corresponding
      // 'pending' broadcast), remove it and dispose now that the real
      // asset has landed. Idempotent — any non-placeholder registration
      // is a no-op.
      const placeholder = pendingAssetsRef.current.get(asset.id);
      if (placeholder) {
        sceneEngine.worldRoot.remove(placeholder.group);
        placeholder.dispose();
        pendingAssetsRef.current.delete(asset.id);
      }
      if (net.mode !== 'offline') {
        // The `primitiveType` tag is sourced from `asset.object3d.userData`
        // — `AssetManager.spawnPrimitive` sets it there in the same edit
        // cycle so this distributed-spawn path has it. Without this, the
        // receiver's `if (data.type === 'primitive' && data.primitiveType)`
        // branch never fires and the asset is silently dropped on every
        // joining guest (the host's default cube + torus pre-broadcast
        // bug). File/url-spawned assets don't carry primitiveType so the
        // field is `undefined` for those — still safe, since the receiver
        // only consults primitiveType on the 'primitive'-type branch.
        const primitiveType = (asset.object3d.userData as Record<string, unknown>)?.primitiveType as
          | 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
          | undefined;
        const spawnData: AssetSpawnData = {
          id: asset.id,
          name: asset.name,
          type: asset.type,
          position: [asset.object3d.position.x, asset.object3d.position.y, asset.object3d.position.z],
          rotation: [asset.object3d.rotation.x, asset.object3d.rotation.y, asset.object3d.rotation.z],
          scale: [asset.object3d.scale.x, asset.object3d.scale.y, asset.object3d.scale.z],
          url: asset.url,
          primitiveType,
          fileData: asset.fileData,
          isCollidable: asset.isCollidable,
          // Mirror the host's userData.isPersistent on the spawn envelope
          // so a guest receiving this asset restores the right
          // persisting state from the first frame — without it, the
          // inspector checkbox defaults to true regardless of send.
          isPersistent: (asset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined
        };
        net.broadcastSpawn(spawnData);
      }
    }));

    // Network listeners
    disposers.push(net.onPeerJoin(() => setPeerCount(net.peers.size)));
    disposers.push(net.onPeerLeave((peerId) => {
      setPeerCount(net.peers.size);
      avatarManager.removePeerAvatar(peerId);
    }));
    disposers.push(net.onHostChange((_newHostId, selfHost) => {
      setIsHost(selfHost);
    }));

    net.onTransform((update) => {
      manipulationManager.applyRemoteTransform(update, assetManager.assets);
    });

    net.onAvatar((update) => {
      avatarManager.updatePeerAvatar(update);
    });

    net.onSpawn((data) => {
      // If asset is already loaded, skip
      if (assetManager.assets.has(data.id)) return;

      const pos = new THREE.Vector3(...data.position);
      // Oversized file broadcast: buildEnvelope's MAX_INLINED_FILE_BYTES
      // cap stripped the binary payload so the Quest doesn't OOM on a
      // 100MB+ base64 round-trip. Render a red "Too Large" placeholder
      // instead of trying to import — no fileData will ever land, so
      // this entry stays in pendingAssetsRef indefinitely. The
      // animation loop's `oversized` skip below keeps it static (no
      // pulse) so it reads as a permanent failure indicator rather
      // than a still-loading asset.
      if (data.fileDataOversized) {
        // A prior 'pending' broadcast may have already drawn a
        // "Loading" placeholder for this id (the host fires 'pending'
        // BEFORE awaiting the import, so peers can render a loading
        // indicator during the (potentially multi-second) file load).
        // Dispose it before swapping in the permanent red "Too Large"
        // indicator — otherwise the cyan mesh orphans in worldRoot
        // with no registerOnAssetAdded cleanup ever firing for it
        // (no real asset will ever be created for an oversized spawn).
        const prior = pendingAssetsRef.current.get(data.id);
        if (prior) {
          sceneEngine.worldRoot.remove(prior.group);
          prior.dispose();
          pendingAssetsRef.current.delete(data.id);
        }
        const { group, dispose } = createLoadingPlaceholder(
          data.name || 'Asset',
          'Network',
          pos,
          true  // isOversized — red palette, "Too Large" label
        );
        sceneEngine.worldRoot.add(group);
        pendingAssetsRef.current.set(data.id, { group, dispose, oversized: true });
        return;
      }
      if (data.type === 'primitive' && data.primitiveType) {
        const prim = assetManager.spawnPrimitive(data.primitiveType, pos);
        prim.object3d.rotation.set(...data.rotation);
        prim.object3d.scale.set(...data.scale);
        // Restore the sender's persistent flag onto userData so the
        // inspector tree's orange-dot indicator and the checkbox state
        // both reflect what the host had. Skipped when undefined for
        // backward compat with older senders.
        if (data.isPersistent !== undefined) {
          prim.object3d.userData.isPersistent = data.isPersistent;
        }
      } else if (data.fileData && data.name) {
        const blob = new Blob([data.fileData]);
        // Pass `data.id` as the AssetManager's customId so the local
        // placeholder (already drawn from this asset's 'pending'
        // broadcast via onPendingSpawn above) and the actual asset
        // share the SAME id. registerOnAssetAdded's id-match cleanup
        // (top of this engine-init effect) then removes the
        // placeholder the moment this asset resolves — clean
        // handoff, no separate tempId → assetId mapping required.
        const file = new File([blob], data.name);
        assetManager.importFile(file, pos, undefined, data.id).then((asset) => {
          if (asset) {
            asset.object3d.rotation.set(...data.rotation);
            asset.object3d.scale.set(...data.scale);
            // Mirror the persistent flag onto the just-imported mesh's
            // userData so the inspector tree + checkbox reflect the
            // host's intent from the first frame (same write block as
            // the primitive branch above; only the import vs spawn
            // timing differs).
            if (data.isPersistent !== undefined) {
              asset.object3d.userData.isPersistent = data.isPersistent;
            }
          }
        });
      }
    });

    disposers.push(net.onRemove((id) => {
      assetManager.removeAsset(id);
      if (manipulationManager.selectedAsset?.id === id) {
        manipulationManager.selectAsset(null);
      }
      // If a placeholder was registered for this id (e.g. an in-flight
      // import was cancelled before completion AND its 'pendingcancel'
      // didn't arrive because the host dropped), dispose it cleanly.
      const pending = pendingAssetsRef.current.get(id);
      if (pending) {
        sceneEngine.worldRoot.remove(pending.group);
        pending.dispose();
        pendingAssetsRef.current.delete(id);
      }
    }));

    // Loading-indicator placeholder subscriptions. A host announces
    // an in-flight import before awaiting the async load by
    // broadcasting 'pending'; we render a pulsing 3D mesh at the
    // import's future position so users have visual feedback while
    // waiting for the asset to sync across peers. The matching
    // 'spawn' (with the same id) triggers cleanup via registerOnAssetAdded's
    // above id-match; a failed import's 'pendingcancel' triggers
    // cleanup here on the cancel side.
    disposers.push(net.onPendingSpawn((data: PendingSpawnData) => {
      if (pendingAssetsRef.current.has(data.id)) return;
      const pos = new THREE.Vector3(...data.position);
      const { group, dispose } = createLoadingPlaceholder(
        data.name,
        data.requesterName,
        pos
      );
      sceneEngine.worldRoot.add(group);
      pendingAssetsRef.current.set(data.id, { group, dispose });
    }));

    disposers.push(net.onPendingCancel((id: string) => {
      const entry = pendingAssetsRef.current.get(id);
      if (!entry) return;
      sceneEngine.worldRoot.remove(entry.group);
      entry.dispose();
      pendingAssetsRef.current.delete(id);
    }));

    disposers.push(net.onChat((msg) => {
      // Desktop unread badge: only bump while the user is not looking
      // at the desktop ChatPanel.
      if (!showChatPanel) {
        setUnreadChatCount((prev) => prev + 1);
      }
      // Push to VRHUDManager so the VR Chat Panel (when open) reflects
      // the new message immediately. appendIncomingChat is idempotent
      // on duplicate ids and cheap for the closed-panel case (no redraw).
      vrHudRef.current?.appendIncomingChat(msg);
      // Keep a React-state copy so setDataContext can push it down to
      // any panel that wants it. Capped to last 30 to mirror the
      // manager's rolling buffer; dedupe by id.
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        return next.length > 30 ? next.slice(next.length - 30) : next;
      });
    }));

    disposers.push(net.onStream((stream, peerId) => {
      avatarManager.attachPeerAudio(peerId, stream);
    }));

    disposers.push(net.onRoleUpdate((data) => {
      if (data.targetPeerId === net.localPeerId) {
        setLocalRole(data.newRole);
      }
    }));

    disposers.push(net.onModerationAction((data) => {
      if (data.targetPeerId === net.localPeerId) {
        if (data.action === 'kick') {
          alert(`You have been temporarily kicked from the room: ${data.reason || 'No reason provided.'}`);
          net.disconnect();
          setMode('offline');
          setRoomId(null);
        } else if (data.action === 'ban') {
          alert(`You have been permanently banned from this session: ${data.reason || 'Banned by Admin.'}`);
          net.disconnect();
          setMode('offline');
          setRoomId(null);
        } else if (data.action === 'respawn') {
          sceneEngine.camera.position.set(0, 1.6, 3);
          sceneEngine.controls.target.set(0, 1, 0);
          sceneEngine.controls.update();
        }
      }
    }));

    disposers.push(manipulationManager.registerOnScaleSelf((factor) => {
      sceneEngine.camera.position.y = Math.max(0.4, sceneEngine.camera.position.y * factor);
      sceneEngine.controls.target.y = Math.max(0.2, sceneEngine.controls.target.y * factor);
      sceneEngine.controls.update();
    }));

    inventoryServiceRef.current.getItems().then((items) => setInventoryItems(items));

    disposers.push(net.onSyncReq((fromPeerId) => {
      if (net.isHost) {
        const assetsList: AssetSpawnData[] = [];
        assetManager.assets.forEach((a) => {
          // Mirror registerOnAssetAdded's broadcast above — the snapshot
          // for late-joining guests needs primitiveType so the receiving
          // onSyncResp handler can re-import the cube/torus/etc. without
          // dropping them silently.
          const primitiveType = (a.object3d.userData as Record<string, unknown>)?.primitiveType as
            | 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
            | undefined;
          assetsList.push({
            id: a.id,
            name: a.name,
            type: a.type,
            position: [a.object3d.position.x, a.object3d.position.y, a.object3d.position.z],
            rotation: [a.object3d.rotation.x, a.object3d.rotation.y, a.object3d.rotation.z],
            scale: [a.object3d.scale.x, a.object3d.scale.y, a.object3d.scale.z],
            url: a.url,
            primitiveType,
            fileData: a.fileData,
            isCollidable: a.isCollidable,
            isPersistent: (a.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined
          });
        });
        net.sendSceneSnapshot(fromPeerId, assetsList);
      }
    }));

    disposers.push(net.onSyncResp((snapshot) => {
      snapshot.assets.forEach((data) => {
        // Belt + braces: skip late-join snapshot items whose import
        // is already in-flight from a separate listener (mirrors the
        // onSpawn guard above). Without this, two near-simultaneous
        // delivery paths (e.g. a 'spawn' envelope immediately
        // followed by a sync-resp snapshot containing the same id)
        // could each race past `assets.has(id)` and start their own
        // importFile Promise for the same id.
        if (assetManager.isImporting(data.id)) return;
        if (!assetManager.assets.has(data.id)) {
          const pos = new THREE.Vector3(...data.position);
          // Mirror the onSpawn handler's oversized branch above:
          // the host's snapshot had its fileData stripped by
          // buildEnvelope's per-asset size cap, so a late-joining
          // guest renders a red "Too Large" placeholder instead of
          // attempting to import a binary that was never sent.
          if (data.fileDataOversized) {
            // Mirror the onSpawn handler's dispose-prior-entry
            // pattern above: a 'pending' broadcast may have already
            // drawn a "Loading" placeholder for this id (the host
            // fires 'pending' before the import resolves), so we
            // must dispose it before swapping in the permanent red
            // "Too Large" indicator. Without this the cyan mesh
            // orphans in worldRoot with no registerOnAssetAdded
            // cleanup ever firing.
            const prior = pendingAssetsRef.current.get(data.id);
            if (prior) {
              sceneEngine.worldRoot.remove(prior.group);
              prior.dispose();
              pendingAssetsRef.current.delete(data.id);
            }
            const { group, dispose } = createLoadingPlaceholder(
              data.name || 'Asset',
              'Network',
              pos,
              true  // isOversized — red palette, "Too Large" label
            );
            sceneEngine.worldRoot.add(group);
            pendingAssetsRef.current.set(data.id, { group, dispose, oversized: true });
            return;
          }
          if (data.type === 'primitive' && data.primitiveType) {
            const prim = assetManager.spawnPrimitive(data.primitiveType, pos);
            prim.object3d.rotation.set(...data.rotation);
            prim.object3d.scale.set(...data.scale);
            // Mirror the late-join snapshot's userData.isPersistent so
            // the guest's inspector reflects the host's persist bit
            // from the first render after sync.
            if (data.isPersistent !== undefined) {
              prim.object3d.userData.isPersistent = data.isPersistent;
            }
          } else if (data.fileData && data.name) {
            const blob = new Blob([data.fileData]);
            const file = new File([blob], data.name);
            assetManager.importFile(file, pos).then((asset) => {
              if (asset) {
                asset.object3d.rotation.set(...data.rotation);
                asset.object3d.scale.set(...data.scale);
                // Snapshot receive-side parity with the live 'spawn'
                // path above: write the persistent flag onto the
                // importer's userData immediately so the receiver's
                // inspector tree + checkbox reflect what the host
                // had configured.
                if (data.isPersistent !== undefined) {
                  asset.object3d.userData.isPersistent = data.isPersistent;
                }
              }
            });
          }
        }
      });
    }));

    // Animation Loop sync
    let lastBroadcast = 0;
    let lastCenterRay = 0;
    const unbindLoop = sceneEngine.registerUpdateCallback((_delta, elapsed) => {
      manipulationManager.update(_delta);

      // Pulse in-flight import placeholders so they read as "loading"
      // at a glance. Cheap: a few sin / multiplies per pending place,
      // and the empty-Map fast path short-circuits the loop entirely.
      const pendingMap = pendingAssetsRef.current;
      if (pendingMap.size > 0) {
        for (const [, entry] of pendingMap) {
          // Oversized ("Too Large") placeholders are static failure
          // indicators — pulsing them would suggest they're still
          // loading. Skipping the pulse makes the read unambiguous
          // and also avoids unnecessary transform work for entries
          // that will never resolve into a real asset.
          if (entry.oversized) continue;
          const pulse = 1 + 0.1 * Math.sin(elapsed * 4);
          entry.group.scale.setScalar(pulse);
          entry.group.rotation.y = elapsed * 1.5;
          entry.group.rotation.x = elapsed * 0.5;
        }
      }

      // Stats update
      if (Math.random() < 0.05) {
        setStats({ ...sceneEngine.stats });
      }

      // Broadcast avatar every ~60ms (approx 16 FPS network sync)
      if (elapsed - lastBroadcast > 0.06 && net.mode !== 'offline') {
        lastBroadcast = elapsed;
        const transform = avatarManager.getLocalTransform(
          sceneEngine.camera,
          sceneEngine.controller1,
          sceneEngine.controller2,
          false,
          net.isCompanion
        );
        net.broadcastAvatar(transform);
      }

      // Dev tool: throttle center-of-screen hover raycast to ~14 Hz.
      // Reads activeTool / cameraMode from refs so this single-bound
      // callback picks up live values without re-binding. O(1)
      // asset lookup via Map<THREE.Object3D, LoadedAsset>; mirrors
      // handleCenterRaySelect's parent-walk so a hit on a child mesh
      // still resolves to its owning LoadedAsset.
      if (
        activeToolRef.current === 'dev' &&
        cameraModeRef.current === 'first-person' &&
        !sceneEngine.renderer.xr.isPresenting &&
        assetManager.assets.size > 0 &&
        elapsed - lastCenterRay > 0.07
      ) {
        lastCenterRay = elapsed;
        sceneEngine.raycaster.setFromCamera(new THREE.Vector2(0, 0), sceneEngine.camera);
        const targets: THREE.Object3D[] = [];
        const objToAsset = new Map<THREE.Object3D, LoadedAsset>();
        assetManager.assets.forEach((a) => {
          targets.push(a.object3d);
          objToAsset.set(a.object3d, a);
        });
        const hits = sceneEngine.raycaster.intersectObjects(targets, true);
        let newHitId: string | null = null;
        if (hits.length > 0) {
          let cur: THREE.Object3D | null = hits[0].object;
          while (cur && !objToAsset.has(cur)) cur = cur.parent;
          if (cur) {
            const found = objToAsset.get(cur);
            if (found) newHitId = found.id;
          }
        }
        if (newHitId !== centerRayHitAssetIdRef.current) {
          centerRayHitAssetIdRef.current = newHitId;
          setCenterRayHitAssetId(newHitId);
        }
      }

      // VR HUD hover: aim the right controller at the curved screen to
      // capture the intersection UV. The trigger-press VR handler
      // reads `currentVrHudUvRef.current` to deliver a click on the
      // card the user is pointing at. The ref is cleared outside VR /
      // when the HUD is hidden so a stale UV from a previous session
      // can't accidentally fire a click on reload.
      // Include `activePanel` in the gate: a system panel can show
      // WITHOUT the dash being visible (the manager hides the dash on
      // panel-open). Without this clause, the hover raycast would bail
      // and trigger pulls on panel buttons / CLOSE would not route.
      if (sceneEngine.renderer.xr.isPresenting &&
          (vrHudRef.current?.isVisible || vrHudRef.current?.activePanel)) {
        const hud = vrHudRef.current;
        // Resolve the physical right-hand controller via
        // device-reported handedness (NOT controller2 index) so a
        // left-handed user's HUD aim ray follows the correct hand.
        const ctr = sceneEngine.vrInput?.getController('right');
        if (!ctr) {
          currentVrHudUvRef.current = null;
        } else {
          ctr.updateWorldMatrix(true, false);
        const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);
        const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();          const hudRay = vrHudRaycasterRef.current;
          hudRay.set(origin, dir);
          // Test BOTH the dash menu mesh AND the panel mesh via a single
          // intersectObjects pass. Whichever group is active contributes
          // its mesh to the test; handleRayIntersection routes UV->action
          // based on activePanel first then dash cards, so a single
          // per-frame raycast suffices for both surfaces.
          const hoverTargets: THREE.Object3D[] = [];
          if (hud.isVisible) hoverTargets.push(hud.curvedScreenMesh);
          if (hud.activePanel) hoverTargets.push(hud.panelMesh);
          const hudHits = hudRay.intersectObjects(hoverTargets, true);
          if (hudHits.length > 0 && hudHits[0].uv) {
            currentVrHudUvRef.current = hudHits[0].uv.clone();
          } else {
            currentVrHudUvRef.current = null;
          }
        }
      } else {
        currentVrHudUvRef.current = null;
      }
    });

    // Handle Canvas Click / Raycast
    const onCanvasClick = (e: MouseEvent) => {
      if (e.button !== 0) return;

      // While locked, if the crosshair is over a panel route the click there
      // instead of doing world raycasting.
      const spm = sceneEngine.spatialPanelManager;
      if (document.pointerLockElement && spm?.isOverPanel) {
        spm.handleLockedClick();
        return;
      }

      const rect = sceneEngine.renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      sceneEngine.raycaster.setFromCamera(new THREE.Vector2(x, y), sceneEngine.camera);
      const targets: THREE.Object3D[] = [];
      const objToAsset = new Map<THREE.Object3D, LoadedAsset>();
      assetManager.assets.forEach((asset) => {
        targets.push(asset.object3d);
        objToAsset.set(asset.object3d, asset);
      });

      const hits = sceneEngine.raycaster.intersectObjects(targets, true);
      if (hits.length > 0) {
        let cur: THREE.Object3D | null = hits[0].object;
        while (cur && !objToAsset.has(cur)) cur = cur.parent;
        if (cur && objToAsset.has(cur)) {
          // Misc files no longer auto-open an inspection modal on
          // canvas click; their context-menu entry points (Download /
          // Save to Inventory) are reachable from the radial menu when
          // the asset is held. Visual file info is baked into the
          // misc-file canvas texture in AssetManager.createMiscFileObject.
        }
      }
    };
    // Per Controls-Keybinds.txt: Right Mouse Button = Grab (NOT context
    // menu). The ManipulationManager pointerdown handler captures RMB
    // and either initiates a grab or no-ops. The contextmenu event still
    // fires here on right-mouse-down — we preventDefault to suppress the
    // browser's native menu but no longer auto-open the radial menu on
    // RMB (that override was the bug the user reported — it shadowed the
    // grab feature).
    const onCanvasContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    // Middle Mouse Button (button 1) opens the radial menu.
    // Mouse Button 4 (button 3 or button 4 in DOM events) triggers Secondary action (object selection).
    const onCanvasAuxMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        // MMB toggles the radial menu (was always-open-only).
        // Read the LIVE `showRadialMenuRef` mirror instead of
        // the closed-over React state -- this handler is
        // registered once inside the `[]`-deps engine-init
        // effect, so the directly-read `showRadialMenu`
        // would always see the initial `false`. The
        // RadialContextMenu's window-capture mousedown
        // handler fires FIRST when MMB is pressed over the
        // menu backdrop, so the menu closes itself before
        // this branch sees the click -- consistent UX.
        if (showRadialMenuRef.current) {
          setShowRadialMenu(false);
        } else {
          setRadialMenuPos({ x: e.clientX, y: e.clientY });
          setShowRadialMenu(true);
        }
      } else if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        if (activeToolRef.current === 'dev') {
          handleCenterRaySelect();
        }
      }
    };
    const onCanvasMouseMove = (e: MouseEvent) => {
      const rect = sceneEngine.renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      lastMouseNdcRef.current.set(x, y);
    };
    // Scroll wheel: when locked + over a panel, forward to the panel element.
    const onCanvasWheel = (e: WheelEvent) => {
      const spm = sceneEngine.spatialPanelManager;
      if (document.pointerLockElement && spm?.isOverPanel) {
        e.preventDefault();
        spm.handleLockedScroll(e.deltaY);
      }
    };
    const domElem = sceneEngine.renderer.domElement;
    domElem.addEventListener('click', onCanvasClick);
    domElem.addEventListener('contextmenu', onCanvasContextMenu);
    domElem.addEventListener('mousedown', onCanvasAuxMouseDown);
    domElem.addEventListener('mousemove', onCanvasMouseMove);
    domElem.addEventListener('wheel', onCanvasWheel, { passive: false });

    // Register hover-change callback so React can update the crosshair visual
    sceneEngine.spatialPanelManager?.setOnHoverChange((isOver) => {
      setIsCrosshairOverPanel(isOver);
    });

    // Check URL parameters for auto-joining room or pairing code
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const pairParam = params.get('pair');

    if (roomParam) {
      handleJoinRoom(roomParam, 'online', false);
    } else if (pairParam) {
      handleJoinRoom(pairParam, 'paired', true);
    } else {
      // Spawn welcome primitive blocks immediately in offline sandbox
      if (assetManager.assets.size === 0) {
        const cube = assetManager.spawnPrimitive('cube', new THREE.Vector3(0, 1.2, 0));
        cube.object3d.rotation.set(0.4, 0.6, 0);
        const torus = assetManager.spawnPrimitive('torus', new THREE.Vector3(2.0, 1.2, -2));
        torus.object3d.rotation.set(0.2, 1.0, 0);
      }
    }

    return () => {
      unbindLoop();
      domElem.removeEventListener('click', onCanvasClick);
      domElem.removeEventListener('contextmenu', onCanvasContextMenu);
      domElem.removeEventListener('mousedown', onCanvasAuxMouseDown);
      domElem.removeEventListener('mousemove', onCanvasMouseMove);
      domElem.removeEventListener('wheel', onCanvasWheel);
      // Dispose any remaining placeholder meshes (in-flight imports
      // we never finished, late-cancellation paths). Without this,
      // component remounts would accumulate GPU-leaked placeholders
      // since the mesh dispose path is opt-in per-placeholder.
      const pendingCleanup = pendingAssetsRef.current;
      for (const [, entry] of pendingCleanup) {
        sceneEngine.worldRoot.remove(entry.group);
        entry.dispose();
      }
      pendingCleanup.clear();
      // Drop every captured subscription FIRST so StrictMode dev
      // double-mount (or any HMR cycle) doesn't leave duplicate
      // listeners attached to NetworkService / AssetManager /
      // ManipulationManager Sets. Per-disposer try/catch so a single
      // closure referencing a torn-down engine doesn't abort the rest.
      for (const d of disposers) {
        try { d(); } catch { /* noop */ }
      }
      net.disconnect();
      manipulationManager.dispose();
      sceneEngine.dispose();
    };
  }, []);
  // Push fresh PanelContext to VRHUDManager whenever any state underlying
  // the active panel changes. setDataContext triggers a redraw ONLY if
  // activePanel !== null — no cost when no panel is showing. Runs after
  // the engine-init effect has mounted vrHudRef.current.
  useEffect(() => {
    const vrHud = vrHudRef.current;
    if (!vrHud) return;
    const se = sceneEngineRef.current;
    const em = environmentManagerRef.current;
    const net = networkServiceRef.current;
    // Session & Roles panel USERS list. NetworkService only tracks
    // peer IDs (Set<string>), not names/roles, so remote peers fall
    // back to a truncated peerId + 'guest' role. The local user gets
    // the real name + admin (when hosting). A full role system would
    // require per-peer role state tracked through NetworkService.
    const selfId = net?.localPeerId ?? 'self';
    const users: import('./engine/VRHUDManager').PanelUser[] = [
      {
        id: selfId,
        name: net?.localUserName ?? 'You',
        role: net?.isHost ? 'admin' : 'guest',
        isSelf: true,
        isHost: !!net?.isHost,
      },
    ];
    if (net?.peers) {
      for (const peerId of net.peers) {
        users.push({
          id: peerId,
          name: peerId.length > 12 ? peerId.slice(0, 4) + '…' + peerId.slice(-4) : peerId,
          role: 'guest',
          isSelf: false,
          isHost: false,
        });
      }
    }
    vrHud.setDataContext({
      inventoryItems: inventoryItemsRef.current,
      graphicsSettings: se?.settings ?? {
        resolutionScale: 1.0, shadowQuality: 'high', antiAliasing: 'msaa',
        msaaSamples: 4, postProcessing: false, lodBias: 1.0,
        progressiveLOD: false, lodTargetDensity: 200000, lodOverrideLevel: undefined
      },
      performanceStats: se?.stats ?? { fps: 60, drawCalls: 0, triangles: 0 },
      environmentSettings: em?.settings ?? {
        atmosphere: 'cyber-nebula', gridVisible: true, gridSize: 'standard-60',
        gridColor: 'cyan', ambientIntensity: 1.2, dirLightIntensity: 1.5
      },
      roomInfo: { mode, roomId, peerCount },
      users,
      isHeld,
      selectedAsset,
      sceneRoot: se?.scene ?? null,
      cameraState: {
        mode: (se?.cameraMode ?? 'first-person') as 'orbit' | 'first-person',
        slowMovement: se?.slowMovement ?? false,
        locomotionMode: (se?.locomotionMode ?? 'walk') as 'walk' | 'flight' | 'noclip'
      },
      // 3D radial panel reads these to color the SCALE / LASER / GRAB
      // slices. Pass live state so the slice colors update on toggle.
      scalingEnabled,
      laserEnabled,
      grabMode,
      // Rolling chat-message buffer (mirrors VRHUDManager's own
      // _recentMessages). Without this in the context, the VR
      // Chat Panel canvas would not redraw with new arrivals.
      chatMessages,
    });
  }, [
    inventoryItems,
    mode, roomId, peerCount,
    selectedAsset,
    sceneEngineRef.current?.settings?.resolutionScale,
    sceneEngineRef.current?.settings?.shadowQuality,
    sceneEngineRef.current?.settings?.antiAliasing,
    sceneEngineRef.current?.settings?.progressiveLOD,
    sceneEngineRef.current?.stats?.fps,
    sceneEngineRef.current?.slowMovement,
    sceneEngineRef.current?.locomotionMode,
    environmentManagerRef.current?.settings?.atmosphere,
    environmentManagerRef.current?.settings?.gridVisible,
    vrHudRef.current?.activePanel,
    // Radial panel slices re-paint on these state changes; without
    // them in the dep list, the panel would show stale scaling/laser/
    // grab colors until the next unrelated state change re-runs the
    // effect.
    scalingEnabled,
    laserEnabled,
    grabMode,
    chatMessages,
  ]);

  // One-time mount-load of inventory items so the VR inventory
  // panel (sys-inventory) has data even when the user never opens
  // the desktop dash or inventory modal. Without this the panel
  // shows "No items yet" in pure-VR sessions. The follow-up
  // useEffect below keeps the data fresh on desktop-modal opens.
  useEffect(() => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    inv.getItems().then((items) => {
      inventoryItemsRef.current = items.slice();
      setInventoryItems(items);
    }).catch(() => { /* swallow — IDB may not be ready */ });
  }, []);

  // Refresh inventory items when the user opens either the desktop
  // dash or the desktop inventory modal — keeps the VR panel view
  // fed fresh data WITHOUT relying on a state update path.
  useEffect(() => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    inv.getItems().then((items) => {
      inventoryItemsRef.current = items.slice();
      setInventoryItems(items);
    }).catch(() => { /* swallow — IDB may not be ready */ });
  }, [showDashMenu, showInventoryModal]);


  // Dev tool's secondary action (R key): center-of-screen raycast
  // select. Mirrors ManipulationManager.handleRaycastSelection's
  // parent-walk so a hit on a child mesh still resolves to its owning
  // LoadedAsset. UNLIKE the click-based path, a miss is a no-op so
  // the user's existing selection isn't bounced off when they pan
  // the world. Toggling behavior matches dev-tool "Single" selection
  // mode from Controls-Keybinds.txt: re-selecting an already-selected
  // asset unselects it.
  const handleCenterRaySelect = useCallback(() => {
    const se = sceneEngineRef.current;
    const am = assetManagerRef.current;
    const mm = manipulationManagerRef.current;
    if (!se || !am || !mm) return;

    const isLocked = document.pointerLockElement === se.renderer.domElement || cameraModeRef.current === 'first-person';
    const ndc = isLocked ? new THREE.Vector2(0, 0) : lastMouseNdcRef.current;
    se.raycaster.setFromCamera(ndc, se.camera);

    const targets: THREE.Object3D[] = [];
    const objToAsset = new Map<THREE.Object3D, LoadedAsset>();
    am.assets.forEach((asset) => {
      targets.push(asset.object3d);
      objToAsset.set(asset.object3d, asset);
    });

    const hits = se.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return; // Preserve current selection on miss.

    let cur: THREE.Object3D | null = hits[0].object;
    while (cur && !objToAsset.has(cur)) cur = cur.parent;
    if (!cur) return;
    const found = objToAsset.get(cur);
    if (!found) return;

    // Single-mode toggle (per Controls-Keybinds.txt): selecting an
    // already-selected asset deselects it. The registered
    // onSelectionChange callback in the engine-init effect already
    // fans out to setSelectedAsset + setInspectedMiscAsset on every
    // selection change — we deliberately do not mirror it here to
    // avoid a double setState that would still settle to the same
    // value but cost an extra render.
    if (mm.selectedAsset?.id === found.id) {
      mm.selectAsset(null);
    } else {
      mm.selectAsset(found);
    }
  }, []);

  // ===========================================================================
  // Keyboard shortcut handlers
  // ===========================================================================
  // Declared ABOVE the keyboard useEffect that captures them from closure so
  // TypeScript is happy (avoids TS2454 “used before being assigned” / TDZ on
  // these useCallback blocks). The keydown useEffect already depends on
  // selectedAsset, so re-binding whenever that changes costs nothing extra.
  // Ctrl+S — Save selected asset to inventory (per Controls-Keybinds.txt).
  // Mirrors the inventory-item shape built in handleImportFile so a future
  // spawn from inventory picks up the original MIME type / metadata.
  const handleSaveSelectedToInventory = useCallback(() => {
    if (!selectedAsset) return;
    const asset = selectedAsset;
    const item: InventoryItem = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      createdAt: Date.now(),
      fileData: asset.fileData,
      url: asset.url,
      metadata:
        asset.metadata ||
        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),
    };
    inventoryServiceRef.current.saveItem(item).then(() => {
      console.log(`[Inventory] Saved "${asset.name}" to inventory`);
    });
  }, [selectedAsset]);

  // Ctrl+D — Duplicate selected asset (per Controls-Keybinds.txt). Mirrors
  // the respawn path used by handleSpawnFromInventory so the duplicate is a
  // real, addressable world object (and the new id flows through to peer
  // clients via broadcastSpawn). Async because primitives are sync but
  // file/url re-imports take a tick — broadcast only fires AFTER the asset
  // is fully realized so we have its final id.
  const handleDuplicateSelected = useCallback(async () => {
    if (!selectedAsset) return;
    const asset = selectedAsset;
    const am = assetManagerRef.current;
    if (!am) return;

    // Offset duplicate so it doesn't perfectly overlap the original.
    const offset = new THREE.Vector3(
      0.4 + (Math.random() - 0.5) * 0.3,
      0,
      0.4 + (Math.random() - 0.5) * 0.3
    );
    const pos = new THREE.Vector3(
      asset.object3d.position.x,
      asset.object3d.position.y,
      asset.object3d.position.z
    ).add(offset);
    const primType = (asset.object3d.userData as Record<string, unknown>)
      ?.primitiveType as
      | 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
      | undefined;

    const afterImport = (newAsset: LoadedAsset) => {
      newAsset.object3d.rotation.set(
        asset.object3d.rotation.x,
        asset.object3d.rotation.y,
        asset.object3d.rotation.z
      );
      newAsset.object3d.scale.set(
        asset.object3d.scale.x,
        asset.object3d.scale.y,
        asset.object3d.scale.z
      );
      // Duplicate-while-holding: keep holding the DUPLICATE, not
      // the original. swapGrabbedAsset atomically ends the current
      // grab on `asset` and starts an equivalent grab on
      // `newAsset` (same VR-side when applicable, cursor-anchored
      // RMB-grab on desktop). No-op during a two-handed grab --
      // that path would need the live grip world positions to
      // re-establish the scale, which is intentionally out of
      // scope here. Guard is always-true for the held-tab
      // Duplicate verb (handleDuplicateHeld sets asset =
      // grabbedAsset by construction) and only fires for
      // handleDuplicateSelected when the selected asset happens
      // to also be currently grabbed.
      if (manipulationManagerRef.current?.grabbedAsset?.id === asset.id) {
        manipulationManagerRef.current?.swapGrabbedAsset(newAsset);
      } else {
        manipulationManagerRef.current?.selectAsset(newAsset);
      }
      recordSpawnUndo(newAsset);
      networkServiceRef.current.broadcastSpawn({
        id: newAsset.id,
        name: newAsset.name,
        type: newAsset.type as AssetSpawnData['type'],
        position: [
          newAsset.object3d.position.x,
          newAsset.object3d.position.y,
          newAsset.object3d.position.z,
        ],
        rotation: [
          newAsset.object3d.rotation.x,
          newAsset.object3d.rotation.y,
          newAsset.object3d.rotation.z,
        ],
        scale: [
          newAsset.object3d.scale.x,
          newAsset.object3d.scale.y,
          newAsset.object3d.scale.z,
        ],
        url: newAsset.url,
        fileData: newAsset.fileData,
        isCollidable: newAsset.isCollidable,
      });
    };

    if (asset.type === 'primitive' && primType) {
      const newAsset = am.spawnPrimitive(primType, pos);
      afterImport(newAsset);
      return;
    }

    if (asset.fileData && asset.name) {
      // Rebuild File from saved ArrayBuffer — pass MIME type so GLTF/FBX/etc.
      // loaders pick the right parser.
      const blob = new Blob([asset.fileData], {
        type: asset.metadata?.mimeType || 'application/octet-stream',
      });
      const file = new File([blob], asset.name);
      const newAsset = await am.importFile(file, pos);
      if (newAsset) afterImport(newAsset);
      return;
    }

    if (asset.url) {
      try {
        const newAsset = await am.importFromUrl(asset.url, pos);
        if (newAsset) afterImport(newAsset);
      } catch (err) {
        console.warn(`[Duplicate] Failed to re-import from URL ${asset.url}:`, err);
      }
    }
  }, [selectedAsset]);


    // Keyboard Navigation Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      
      if (e.key === 'Tab' || e.code === 'Tab') {
        e.preventDefault();
        if (sceneEngineRef.current?.renderer.xr.isPresenting) {
          inventoryServiceRef.current.getItems().then((items) => {
            vrHudRef.current?.setItems(items);
            vrHudRef.current?.toggle();
          });
          return;
        }
        setShowDashMenu((prev) => {
          if (!prev) {
            inventoryServiceRef.current.getItems().then((items) => setInventoryItems(items));
            if (document.pointerLockElement) {
              document.exitPointerLock?.();
            }
          }
          return !prev;
        });
        return;
      }

      // Dev tool's secondary action (R) — center-of-screen raycast
      // select. Gated on: dev tool active, first-person mode, NOT in
      // VR. Plain R only — Shift+E is rotate-around-Y-axis (managed
      // by ManipulationManager), so plain R is what gets the new
      // selection semantics; modifier combos fall through to the
      // handlers below. Placed BEFORE the orbit translate/rotate/scale
      // branches so a tool-equipped	R-press does NOT flip the gizmo
      // mode while in first-person, and short-circuits with `return`
      // so any later section of the handler doesn't double-react.
      if (
        activeTool === 'dev' &&
        !sceneEngineRef.current?.renderer.xr.isPresenting &&
        (e.key === 'r' || e.key === 'R') &&
        !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      ) {
        e.preventDefault();
        handleCenterRaySelect();
        return;
      }

      if (cameraMode !== 'first-person') {
        if (e.key === 'g' || e.key === 'w' || e.key === 'G' || e.key === 'W') {
          handleSetMode('translate');
        } else if (e.key === 'r' || e.key === 'e' || e.key === 'R' || e.key === 'E') {
          handleSetMode('rotate');
        } else if (e.key === 's' || e.key === 'S') {
          handleSetMode('scale');
        }
      }

      // T key — toggle the Resonite-style radial / pie context menu.
      // (Also reachable via the canvas right-click and the toolbar button.)
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setShowRadialMenu((prev) => !prev);
        return;
      } else if (e.key === 'o' || e.key === 'O') {
        // Toggle the Scene Inspector. Plain O only — modifier combos
        // (Ctrl+O for "Open File" in browsers, etc.) fall through to
        // the browser's default. Only opens when an asset is selected
        // so pressing O with nothing selected is a no-op rather than
        // throwing the inspector up empty.
        if (!e.ctrlKey && !e.metaKey && !e.altKey && selectedAsset) {
          e.preventDefault();
          setShowSceneInspector((prev) => !prev);
          return;
        }
      } else if (e.key === 'v' || e.key === 'V') {
        handleToggleCameraMode();
      } else if (e.key === 'f' || e.key === 'F') {
        handleFocusSelected();
      } else if (e.key === 'i' || e.key === 'I') {
        setShowInventoryModal((prev) => !prev);
      } else if (e.key === 'u' || e.key === 'U') {
        setImportInitialFile(null);
        setShowImportDialog((prev) => !prev);
      } else      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRedoManagerRef.current.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        undoRedoManagerRef.current.redo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && !e.shiftKey) {
        e.preventDefault();
        handleSaveSelectedToInventory();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D') && !e.shiftKey) {
        e.preventDefault();
        handleDuplicateSelected();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && e.shiftKey) {
        // Ctrl+Shift+V — "paste as plain text". Do NOT preventDefault:
        // the focused <input> (if any) still needs to receive the text from
        // the browser's default paste handler. The flag is read-and-cleared
        // in handlePaste which short-circuits our URL/data-URI import
        // branch so a stray URL on the clipboard doesn't get auto-imported.
        plainPasteModeRef.current = true;
      }
    };

    // Safety net: clear the plain-paste flag whenever ANY of Ctrl/Meta or
    // Shift is released. Without this, a stray Ctrl+Shift+V that doesn't
    // fire a paste event (e.g. focus moves mid-keystroke) could poison the
    // next Ctrl+V paste with the URL/data-URI import branch.
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) {
        plainPasteModeRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedAsset, cameraMode, activeTool, handleSaveSelectedToInventory, handleDuplicateSelected, handleCenterRaySelect]);

  // Global Drag-and-Drop and Paste (Ctrl+V) Listeners
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
        setImportInitialFile(e.dataTransfer.files[0]);
        setShowImportDialog(true);
      }
    };
    const handlePaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      // Inputs always hand off to the browser's default paste behavior.
      if (['INPUT', 'TEXTAREA'].includes(tag)) {
        if (plainPasteModeRef.current) plainPasteModeRef.current = false;
        return;
      }

      // Ctrl+Shift+V (no input focus): user explicitly wants plain text —
      // suppress the asset-import path. Browser default paste into <body>
      // is effectively a no-op anyway, so this is "do nothing unsafe with
      // the clipboard contents" — exactly the spec intent.
      if (plainPasteModeRef.current) {
        plainPasteModeRef.current = false;
        e.preventDefault();
        return;
      }

      if (e.clipboardData?.files && e.clipboardData.files[0]) {
        setImportInitialFile(e.clipboardData.files[0]);
        setShowImportDialog(true);
      } else if (e.clipboardData) {
        const text = e.clipboardData.getData('text');
        if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:'))) {
          setImportInitialFile(null);
          setShowImportDialog(true);
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  const handleJoinRoom = useCallback(async (targetRoomId: string, targetMode: ConnectionMode, isCompanion = false) => {
    const net = networkServiceRef.current;
    await net.initSession(targetRoomId, targetMode, isCompanion);
    
    setMode(targetMode);
    setRoomId(targetRoomId);
    setPeerCount(net.peers.size);
    setIsHost(net.isHost);

    // Update URL without reloading page
    const newUrl = targetMode === 'offline' 
      ? window.location.pathname 
      : `${window.location.pathname}?${targetMode === 'paired' ? 'pair' : 'room'}=${targetRoomId}`;
    window.history.replaceState({}, '', newUrl);

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });
  }, []);

  const handleDisconnect = useCallback(() => {
    // Dispose any pending placeholders — the network is going away
    // and we won't be receiving 'spawn' or 'pendingcancel' for them
    // anymore, so leaving placeholders installed would be incorrect.
    const pendingCleanup = pendingAssetsRef.current;
    for (const [, entry] of pendingCleanup) {
      sceneEngineRef.current?.worldRoot.remove(entry.group);
      entry.dispose();
    }
    pendingCleanup.clear();
    networkServiceRef.current.disconnect();
    setMode('offline');
    setRoomId(null);
    setPeerCount(0);
    setIsHost(true);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const handleSetMode = (m: TransformMode) => {
    setCurrentTransformMode(m);
    manipulationManagerRef.current?.setMode(m);
  };

  const handleToggleSpace = () => {
    const next = transformSpace === 'local' ? 'world' : 'local';
    setTransformSpace(next);
    manipulationManagerRef.current?.setSpace(next);
  };

  const handleToggleCollision = () => {
    manipulationManagerRef.current?.toggleCollision();
    // Force re-render of toolbar badge
    setSelectedAsset((prev) => prev ? { ...prev } : null);
  };

  // =========================================================================
  // HELD-TARGET HANDLERS (radial menu 'held' tab)
  // Mirror of the three selected-target handlers above (Save / Duplicate /
  // Delete) but operate on manipulationManager.grabbedAsset instead of
  // selectedAsset. RMB-grab explicitly does NOT mutate selection state
  // (per the ManipulationManager comment block in beginGrab), so the
  // SELECTED-target handlers do nothing for a held-but-not-selected asset.
  // These are the missing "act on the held object" entry points.
  // =========================================================================
  const handleSaveHeldToInventory = useCallback(() => {
    const mm = manipulationManagerRef.current;
    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;
    if (!held) return;
    const asset = held;
    const item: InventoryItem = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      createdAt: Date.now(),
      fileData: asset.fileData,
      url: asset.url,
      metadata:
        asset.metadata ||
        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),
    };
    inventoryServiceRef.current.saveItem(item).then(() => {
      console.log('[Inventory] Saved held "' + asset.name + '" to inventory');
    });
  }, []);

  // Download the held asset to the user's device. Currently only
  // meaningful for misc files (which carry raw fileData) — the radial
  // menu shows this action only when the held asset's type is
  // 'misc', so for other types this callback is never wired to a
  // slice. AssetManager.downloadAsset already no-ops on assets that
  // lack fileData / url, so this is safe to call defensively.
  const handleDownloadHeld = useCallback(() => {
    const mm = manipulationManagerRef.current;
    const am = assetManagerRef.current;
    if (!am) return;
    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;
    if (!held) return;
    am.downloadAsset(held);
  }, []);

  const handleDuplicateHeld = useCallback(async () => {
    // Fall back to the two-handed asset if no single-grip grab is in
    // flight. Two-handed mode doesn't set grabbedAsset but DOES fire
    // onGrabBegin (which we use to set isHeld), so without this
    // fallback the user would see the held tab in two-handed mode but
    // nothing would happen when they click Duplicate / Save / Destroy.
    const mm = manipulationManagerRef.current;
    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;
    if (!held) return;
    const asset = held;
    const am = assetManagerRef.current;
    if (!am) return;

    // Offset the duplicate so it doesn't perfectly overlap the held
    // original (the held one stays under the cursor; the duplicate pops
    // out a fraction so the user can see the copy). Same offset as the
    // selected-target version for consistency.
    const offset = new THREE.Vector3(
      0.4 + (Math.random() - 0.5) * 0.3,
      0,
      0.4 + (Math.random() - 0.5) * 0.3
    );
    // CRITICAL: read WORLD position, not local. A VR-grip-held asset
    // is parented to controllerGripSpace, so obj.position is the
    // LOCAL offset from the grip (e.g. (0,0,-2)). Reading local as
    // world would spawn the duplicate at the world origin instead of
    // at the user's hand. For RMB-grab (direct child of scene) local
    // == world, so the change is a no-op for that case. getWorldPosition
    // requires matrixWorld to be up to date, which the renderer
    // maintains each frame for visible meshes — held assets ARE
    // rendered, so the call is safe.
    const worldPos = new THREE.Vector3();
    asset.object3d.getWorldPosition(worldPos);
    const pos = worldPos.add(offset);
    const primType = (asset.object3d.userData as Record<string, unknown>)
      ?.primitiveType as
      | 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
      | undefined;

    const afterImport = (newAsset: LoadedAsset) => {
      newAsset.object3d.rotation.set(
        asset.object3d.rotation.x,
        asset.object3d.rotation.y,
        asset.object3d.rotation.z
      );
      newAsset.object3d.scale.set(
        asset.object3d.scale.x,
        asset.object3d.scale.y,
        asset.object3d.scale.z
      );
      // Duplicate-while-holding: keep holding the DUPLICATE, not
      // the original. swapGrabbedAsset atomically ends the current
      // grab on `asset` and starts an equivalent grab on
      // `newAsset` (same VR-side when applicable, cursor-anchored
      // RMB-grab on desktop). No-op during a two-handed grab --
      // that path would need the live grip world positions to
      // re-establish the scale, which is intentionally out of
      // scope here. Guard is always-true for the held-tab
      // Duplicate verb (handleDuplicateHeld sets asset =
      // grabbedAsset by construction) and only fires for
      // handleDuplicateSelected when the selected asset happens
      // to also be currently grabbed.
      if (manipulationManagerRef.current?.grabbedAsset?.id === asset.id) {
        manipulationManagerRef.current?.swapGrabbedAsset(newAsset);
      } else {
        manipulationManagerRef.current?.selectAsset(newAsset);
      }
      recordSpawnUndo(newAsset);
      networkServiceRef.current.broadcastSpawn({
        id: newAsset.id,
        name: newAsset.name,
        type: newAsset.type as AssetSpawnData['type'],
        position: [
          newAsset.object3d.position.x,
          newAsset.object3d.position.y,
          newAsset.object3d.position.z,
        ],
        rotation: [
          newAsset.object3d.rotation.x,
          newAsset.object3d.rotation.y,
          newAsset.object3d.rotation.z,
        ],
        scale: [
          newAsset.object3d.scale.x,
          newAsset.object3d.scale.y,
          newAsset.object3d.scale.z,
        ],
        url: newAsset.url,
        fileData: newAsset.fileData,
        isCollidable: newAsset.isCollidable,
      });
    };

    if (asset.type === 'primitive' && primType) {
      const newAsset = am.spawnPrimitive(primType, pos);
      afterImport(newAsset);
      return;
    }

    if (asset.fileData && asset.name) {
      const blob = new Blob([asset.fileData], {
        type: asset.metadata?.mimeType || 'application/octet-stream',
      });
      const file = new File([blob], asset.name);
      const newAsset = await am.importFile(file, pos);
      if (newAsset) afterImport(newAsset);
      return;
    }

    if (asset.url) {
      try {
        const newAsset = await am.importFromUrl(asset.url, pos);
        if (newAsset) afterImport(newAsset);
      } catch (err) {
        console.warn('[DuplicateHeld] Failed to re-import from URL ' + asset.url + ':', err);
      }
    }
  }, []);

  const handleDestroyHeld = useCallback(() => {
    // Fall back to the two-handed asset (see handleDuplicateHeld for
    // the same pattern + reason). Two-handed mode doesn't set
    // grabbedAsset, so without this fallback the user would see the
    // held tab in two-handed mode but Destroy would be a no-op.
    const mm = manipulationManagerRef.current;
    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;
    if (!held) return;
    const asset = held;
    const obj = asset.object3d;
    // CRITICAL: end the grab BEFORE removing the asset. Otherwise the
    // manipulation manager would briefly hold a dangling grabbedAsset
    // reference to a removed Object3D, and the per-frame update() path
    // would either crash or broadcast stale transforms for a non-existent
    // asset. endGrab handles single-grip (RMB + VR grip); endTwoHandedGrab
    // handles the two-handed case. We always call both — each is a
    // no-op when the corresponding state is inactive, so it's safe.
    mm?.endGrab();
    mm?.endTwoHandedGrab();
    // Use WORLD position for the undo snapshot. A VR-grip-held asset's
    // obj.position is the local grip offset, NOT the world position;
    // on undo the respawn would teleport to a wrong world spot. For
    // direct-child-of-scene (RMB-grab) local == world, no-op. For
    // two-handed mode the asset is still in the scene (not reparented),
    // so obj.position IS world.
    const worldPos = new THREE.Vector3();
    obj.getWorldPosition(worldPos);
    const snapshot: AssetSnapshot = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      position: [worldPos.x, worldPos.y, worldPos.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      url: asset.url,
      fileData: asset.fileData,
      primitiveType: (obj.userData as Record<string, unknown>)?.primitiveType as string | undefined,
      isCollidable: asset.isCollidable,
      isPersistent: (obj.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
    };
    const latestId = { value: asset.id };
    undoRedoManagerRef.current.push({
      label: 'Destroy ' + asset.name,
      undo: () => {
        respawnFromSnapshot(snapshot, latestId);
      },
      redo: () => {
        const am = assetManagerRef.current;
        if (!am) return;
        am.removeAsset(latestId.value);
        networkServiceRef.current.broadcastRemove(latestId.value);
        const mmOnRedo = manipulationManagerRef.current;
        if (mmOnRedo && mmOnRedo.selectedAsset?.id === latestId.value) {
          mmOnRedo.selectAsset(null);
          setSelectedAsset(null);
        }
      },
    });
    assetManagerRef.current?.removeAsset(asset.id);
    networkServiceRef.current.broadcastRemove(asset.id);
    // If the destroyed asset happened to be the selected one too, clear
    // the selection so the gizmo detaches. Most holds aren't selected,
    // so this is the uncommon path, but cheap to handle.
    const mmAfterDestroy = manipulationManagerRef.current;
    if (mmAfterDestroy && mmAfterDestroy.selectedAsset?.id === asset.id) {
      mmAfterDestroy.selectAsset(null);
      setSelectedAsset(null);
    }
  }, []);

  const handleDeleteSelected = () => {
    if (!selectedAsset) return;
    const asset = selectedAsset;
    const obj = asset.object3d;

    // Record undo BEFORE deleting. Use a mutable ID holder so that if
    // undo respawns a file-based asset (which gets a NEW id from importFile),
    // the redo closure picks up the new id instead of the stale original.
    const snapshot: AssetSnapshot = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      url: asset.url,
      fileData: asset.fileData,
      primitiveType: (obj.userData as Record<string, unknown>)?.primitiveType as string | undefined,
      isCollidable: asset.isCollidable,
      // Mirror `TransformUpdate.isPersistent` so an undo'd delete +
      // redo pairs the persistent flag back into the respawned asset,
      // including the re-broadcast envelope the respawn emits.
      isPersistent: (obj.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
    };
    const latestId = { value: asset.id };
    undoRedoManagerRef.current.push({
      label: `Delete ${asset.name}`,
      undo: () => {
        respawnFromSnapshot(snapshot, latestId);
      },
      redo: () => {
        const am = assetManagerRef.current;
        if (!am) return;
        am.removeAsset(latestId.value);
        networkServiceRef.current.broadcastRemove(latestId.value);
        if (manipulationManagerRef.current?.selectedAsset?.id === latestId.value) {
          manipulationManagerRef.current.selectAsset(null);
          setSelectedAsset(null);
        }
      },
    });

    assetManagerRef.current?.removeAsset(asset.id);
    networkServiceRef.current.broadcastRemove(asset.id);
    manipulationManagerRef.current?.selectAsset(null);
    setSelectedAsset(null);
  };

  const handleToggleCameraMode = () => {
    setCameraMode((prev) => {
      const next = prev === 'orbit' ? 'first-person' : 'orbit';
      sceneEngineRef.current?.setCameraMode(next);
      if (next === 'first-person') setShowLocomotionBanner(true);
      return next;
    });
  };

  const handleSetLocomotionMode = (mode: 'walk' | 'flight' | 'noclip') => {
    setLocomotionMode(mode);
    if (sceneEngineRef.current) {
      sceneEngineRef.current.locomotionMode = mode;
    }
  };

  // Build the callback table for VRRadialMenuMesh. Reading from state-mirror
  // refs (grabModeRef, isHeldRef, heldAssetTypeRef, etc.) so a slice click
  // 5 seconds after the menu opened still sees fresh state. The mesh stores
  // this object once at construction; the closures stay valid for the lifetime
  // of the mesh. Functional setters are stable in React so re-creating this
  // on every render would be wasteful — build once at mount via useCallback.
  const closeVrRadial = useCallback(() => {
    vrRadialMenuRef.current?.setVisible(false);
    vrRadialActiveSideRef.current = null;
    setVrRadialOpen(false);
  }, []);
  const buildVrRadialCallbacks = useCallback((): VRRadialMenuCallbacks => ({
    onUndo: () => { undoRedoManagerRef.current?.undo(); closeVrRadial(); },
    onRedo: () => { undoRedoManagerRef.current?.redo(); closeVrRadial(); },
    onToggleScaling: () => setScalingEnabled((v) => !v),
    onToggleLaser: () => setLaserEnabled((v) => !v),
    onNextLocomotion: () => {
      const cur = locomotionModeRef.current;
      const next: typeof cur = cur === 'walk' ? 'flight' : cur === 'flight' ? 'noclip' : 'walk';
      handleSetLocomotionMode(next);
    },
    onNextGrabMode: () => {
      const cur = grabModeRef.current;
      setGrabMode(cur === 'auto' ? 'precision' : cur === 'precision' ? 'palm' : cur === 'palm' ? 'laser' : 'auto');
    },
    onDestroy: handleDestroyHeld,
    onDuplicate: handleDuplicateHeld,
    onSaveHeld: handleSaveHeldToInventory,
    onDownloadHeld: () => { handleDownloadHeld?.(); },
    onClose: closeVrRadial,
    onNextTab: () => {
      const mesh = vrRadialMenuRef.current;
      if (!mesh) return;
      const cur = mesh.activeTab;
      const isHeld = isHeldRef.current;
      const next: 'general' | 'grab' | 'held' = isHeld
        ? (cur === 'general' ? 'grab' : cur === 'grab' ? 'held' : 'general')
        : (cur === 'general' ? 'grab' : 'general');
      mesh.setActiveTab(next);
    },
  }), [closeVrRadial, handleDestroyHeld, handleDuplicateHeld, handleSaveHeldToInventory, handleDownloadHeld]);
  const buildVrRadialInitialState = useCallback((): VRRadialMenuState => ({
    locomotionMode: locomotionModeRef.current,
    scalingEnabled: scalingEnabledRef.current,
    laserEnabled: laserEnabledRef.current,
    grabMode: grabModeRef.current,
    isHeld: isHeldRef.current,
    heldAssetType: heldAssetTypeRef.current,
    activeTab: 'general',
  }), []);

  const handleFocusSelected = () => {
    if (selectedAsset && sceneEngineRef.current) {
      sceneEngineRef.current.focusOnObject(selectedAsset.object3d);
      setCameraMode('orbit');
    }
  };

  const handleUpdateRole = (targetPeerId: string, newRole: UserRole) => {
    networkServiceRef.current.broadcastRoleUpdate(targetPeerId, newRole);
    // Trigger re-render
    setPeerCount((prev) => prev);
  };

  const handleModerateUser = (action: 'kick' | 'ban' | 'silence' | 'unsilence' | 'respawn' | 'jump', targetPeerId: string) => {
    const net = networkServiceRef.current;
    if (action === 'jump') {
      const targetAvatar = avatarManagerRef.current?.peers.get(targetPeerId);
      if (targetAvatar && sceneEngineRef.current) {
        const pos = targetAvatar.group.position;
        sceneEngineRef.current.camera.position.set(pos.x, pos.y + 1.6, pos.z + 2);
        sceneEngineRef.current.controls.target.copy(pos);
        sceneEngineRef.current.controls.update();
      }
      return;
    }
    if (action === 'respawn') {
      if (targetPeerId === net.localPeerId) {
        sceneEngineRef.current?.camera.position.set(0, 1.6, 3);
        sceneEngineRef.current?.controls.target.set(0, 1, 0);
        sceneEngineRef.current?.controls.update();
      } else {
        net.broadcastModeration('respawn', targetPeerId);
      }
      return;
    }
    net.broadcastModeration(action, targetPeerId);
    setPeerCount((prev) => prev);
  };

  // Helper: record an undo action for a newly spawned/imported asset
  const recordSpawnUndo = (asset: LoadedAsset) => {
    const obj = asset.object3d;
    const snapshot: AssetSnapshot = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      url: asset.url,
      fileData: asset.fileData,
      primitiveType: (obj.userData as Record<string, unknown>)?.primitiveType as string | undefined,
      isCollidable: asset.isCollidable,
      // Same write as `handleDeleteSelected` above so an undo's
      // respawn re-broadcasts the asset with the same persisting state
      // the user originally configured it with.
      isPersistent: (obj.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
    };
    const latestId = { value: asset.id };
    undoRedoManagerRef.current.push({
      label: `Spawn ${asset.name}`,
      undo: () => {
        const am = assetManagerRef.current;
        if (!am) return;
        am.removeAsset(latestId.value);
        networkServiceRef.current.broadcastRemove(latestId.value);
        if (manipulationManagerRef.current?.selectedAsset?.id === latestId.value) {
          manipulationManagerRef.current.selectAsset(null);
          setSelectedAsset(null);
        }
      },
      redo: () => {
        respawnFromSnapshot(snapshot, latestId);
      },
    });
  };

  // Helper: respawn an asset from an undo snapshot.
  // `latestId` is a mutable holder so that if the respawn creates a new
  // asset with a different ID (file-based imports), the redo closure
  // picks up the correct ID.
  const respawnFromSnapshot = (snap: AssetSnapshot, latestId?: { value: string }) => {
    const am = assetManagerRef.current;
    if (!am) return;
    const pos = new THREE.Vector3(...snap.position);
    let asset: LoadedAsset | null = null;
    if (snap.type === 'primitive' && snap.primitiveType) {
      asset = am.spawnPrimitive(snap.primitiveType as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane', pos);
    } else if (snap.fileData && snap.name) {
      const blob = new Blob([snap.fileData]);
      const file = new File([blob], snap.name);
      am.importFile(file, pos).then((a) => {
        if (a) {
          a.object3d.rotation.set(...snap.rotation);
          a.object3d.scale.set(...snap.scale);
          // File/url respawn parity with the primitive respawn
          // branch above: restore the persistent flag from the undo
          // snapshot onto the re-imported mesh's userData and include
          // the bit in the re-broadcast envelope so peers re-receiving
          // the respawned asset see the same flag.
          if (snap.isPersistent !== undefined) {
            a.object3d.userData.isPersistent = snap.isPersistent;
          }
          // Update the mutable ID holder so redo uses the new ID
          if (latestId) latestId.value = a.id;
          networkServiceRef.current.broadcastSpawn({
            id: a.id, name: a.name, type: a.type as AssetSpawnData['type'],
            position: snap.position, rotation: snap.rotation, scale: snap.scale,
            url: a.url, fileData: a.fileData, isCollidable: a.isCollidable,
            isPersistent: snap.isPersistent,
          });
        }
      });
      return;
    }
    if (asset) {
      asset.object3d.rotation.set(...snap.rotation);
      asset.object3d.scale.set(...snap.scale);
      // Restore the persistent flag from the undo snapshot onto the
      // freshly-spawned primitive's userData so the inspector / tree
      // indicator reflect the original user-configured state. Old
      // snapshots without the bit fall back to the spawn default
      // (AssetManager sets userData.isPersistent = true).
      if (snap.isPersistent !== undefined) {
        asset.object3d.userData.isPersistent = snap.isPersistent;
      }
      // Update the mutable ID holder if provided
      if (latestId) latestId.value = asset.id;
      networkServiceRef.current.broadcastSpawn({
        id: asset.id, name: asset.name, type: asset.type as AssetSpawnData['type'],
        position: snap.position, rotation: snap.rotation, scale: snap.scale,
        url: asset.url, fileData: asset.fileData, isCollidable: asset.isCollidable,
        isPersistent: snap.isPersistent,
      });
    } else {
      console.warn(`[UndoRedo] Could not respawn asset "${snap.name}" — no primitiveType, fileData, or url.`);
    }
  };

  const handleSpawnPrimitive = (type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane') => {
    if (!ROLE_PERMISSIONS[localRole]?.canSpawnItems && !ROLE_PERMISSIONS[localRole]?.canEditWorld) {
      alert('Your current role does not have permission to spawn items.');
      return;
    }
    const pos = new THREE.Vector3(
      (Math.random() - 0.5) * 3,
      1.5,
      -2 + (Math.random() - 0.5) * 2
    );
    const prim = assetManagerRef.current?.spawnPrimitive(type, pos);
    if (prim) {
      manipulationManagerRef.current?.selectAsset(prim);
      recordSpawnUndo(prim);
    }
  };

  const handleImportFile = async (file: File, saveToInventory: boolean, equipVrm: boolean) => {
    const assetManager = assetManagerRef.current;
    if (!assetManager) return;

    if (file.name.toLowerCase().endsWith('.vrm') && equipVrm) {
      // VRM-equip path doesn't spawn a world asset — no placeholder
      // needed; the avatar manager owns its own loading state.
      const vrm = await avatarManagerRef.current?.loadLocalVRM(file);
      if (vrm) {
        if (saveToInventory) {
          const buffer = await file.arrayBuffer();
          const item: InventoryItem = {
            id: `vrm-${Date.now()}`,
            name: file.name,
            type: 'vrm',
            createdAt: Date.now(),
            fileData: buffer,
            metadata: { fileSize: file.size, mimeType: file.type }
          };
          await inventoryServiceRef.current.saveItem(item);
        }
      }
      return;
    }

    const pos = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      1.5,
      -2.5 + (Math.random() - 0.5) * 1.5
    );

    // Mint a stable id BEFORE awaiting so peers + the local user see
    // a 'Loading' placeholder from the moment the click lands, and the
    // placeholder id matches the eventual asset id (consumed by
    // registerOnAssetAdded's id-match cleanup). Mirrors the same
    // pattern in handleImportAssetFromConfig — keeping both paths
    // aligned prevents drift if one is updated without the other.
    const placeholderId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const net = networkServiceRef.current;
    const displayName = file.name.length > 26 ? file.name.slice(0, 25) + '…' : file.name;
    if (net.mode !== 'offline') {
      net.broadcastPendingSpawn({
        id: placeholderId,
        type: guessAssetType(file.name),
        name: displayName,
        requesterId: net.localPeerId,
        requesterName: net.localUserName,
        position: [pos.x, pos.y, pos.z],
        fileSize: file.size,
      });
    }
    const localEntry = createLoadingPlaceholder(displayName, net.localUserName, pos);
    sceneEngineRef.current?.worldRoot.add(localEntry.group);
    pendingAssetsRef.current.set(placeholderId, localEntry);

    try {
      const asset = await assetManager.importFile(file, pos, undefined, placeholderId);
      if (asset) {
        manipulationManagerRef.current?.selectAsset(asset);
        recordSpawnUndo(asset);
        // NOTE: registerOnAssetAdded's id-match cleanup removes the
        // local placeholder automatically when this asset lands.
        if (saveToInventory) {
          const item: InventoryItem = {
            id: asset.id,
            name: asset.name,
            type: asset.type,
            createdAt: Date.now(),
            fileData: asset.fileData,
            url: asset.url,
            metadata: asset.metadata || { fileSize: file.size, mimeType: file.type }
          };
          await inventoryServiceRef.current.saveItem(item);
        }
      }
    } catch (err) {
      // Cleanup: remove local placeholder + broadcast peers so they
      // remove theirs, since the import rejected.
      sceneEngineRef.current?.worldRoot.remove(localEntry.group);
      localEntry.dispose();
      pendingAssetsRef.current.delete(placeholderId);
      if (net.mode !== 'offline') {
        net.broadcastPendingCancel(placeholderId);
      }
      console.warn('[Import] Failed:', err);
    }
  };

  const handleImportAssetFromConfig = async (config: ImportConfig) => {
    const assetManager = assetManagerRef.current;
    if (!assetManager) return;

    // VRM equip path — no world asset, so no placeholder; the avatar
    // manager has its own loading state and we don't broadcast.
    if (config.file && config.file.name.toLowerCase().endsWith('.vrm') && config.vrmAction === 'equip-avatar') {
      await avatarManagerRef.current?.loadLocalVRM(config.file);
      if (config.saveToInventory && inventoryServiceRef.current) {
        const buffer = await config.file.arrayBuffer();
        await inventoryServiceRef.current.saveItem({
          id: `vrm-${Date.now()}`,
          name: config.file.name,
          type: 'vrm',
          createdAt: Date.now(),
          fileData: buffer,
          metadata: { fileSize: config.file.size, mimeType: config.file.type }
        });
      }
      return;
    }

    const pos = new THREE.Vector3(0, 1.5, -2.5);
    if (sceneEngineRef.current) {
      const forward = new THREE.Vector3(0, 0, -2.5).applyQuaternion(sceneEngineRef.current.camera.quaternion);
      pos.copy(sceneEngineRef.current.camera.position).add(forward);
    }

    // Mint a stable id BEFORE the await (see comment in handleImportFile).
    const placeholderId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const net = networkServiceRef.current;
    const rawName = (config.file?.name ?? config.url?.split('/').pop() ?? 'Asset').split(/[/?]/).pop() ?? 'Asset';
    const displayName = rawName.length > 26 ? rawName.slice(0, 25) + '…' : rawName;
    const assetType: AssetType = guessAssetType((config.file?.name ?? config.url ?? ''));

    if (net.mode !== 'offline') {
      const pendingData: PendingSpawnData = {
        id: placeholderId,
        type: assetType,
        name: displayName,
        requesterId: net.localPeerId,
        requesterName: net.localUserName,
        position: [pos.x, pos.y, pos.z],
        fileSize: config.file?.size,
        url: config.url,
      };
      net.broadcastPendingSpawn(pendingData);
    }
    const localEntry = createLoadingPlaceholder(displayName, net.localUserName, pos);
    sceneEngineRef.current?.worldRoot.add(localEntry.group);
    pendingAssetsRef.current.set(placeholderId, localEntry);

    let asset: LoadedAsset | null = null;
    try {
      if (config.file) {
        asset = await assetManager.importFile(config.file, pos, config, placeholderId);
      } else if (config.url) {
        asset = await assetManager.importFromUrl(config.url, pos, config, placeholderId);
      }

      if (asset) {
        manipulationManagerRef.current?.selectAsset(asset);
        recordSpawnUndo(asset);
        // NOTE: registerOnAssetAdded's id-match cleanup removes the
        // local placeholder when this asset lands. No explicit local
        // remove needed.
        if (config.saveToInventory && inventoryServiceRef.current) {
          await inventoryServiceRef.current.saveItem({
            id: asset.id,
            name: asset.name,
            type: asset.type,
            createdAt: Date.now(),
            fileData: asset.fileData,
            url: asset.url,
            metadata: asset.metadata
          });
        }
      } else {
        // AssetManager returned null (e.g. URL import caught its own
        // error and returned null instead of throwing). Treat as a
        // failure and clean up via the same cancel path.
        throw new Error('AssetManager returned null');
      }
    } catch (err) {
      sceneEngineRef.current?.worldRoot.remove(localEntry.group);
      localEntry.dispose();
      pendingAssetsRef.current.delete(placeholderId);
      if (net.mode !== 'offline') {
        net.broadcastPendingCancel(placeholderId);
      }
      console.warn('[Import] Failed:', err);
    }
  };

  const handleSpawnFromInventory = async (item: InventoryItem) => {
    const assetManager = assetManagerRef.current;
    if (!assetManager) return;

    if (item.type === 'tool') {
      setActiveTool((item.toolType as ToolType) || 'dev');
      setShowToolsPanel(true);
      setShowInventoryModal(false);
      setShowDashMenu(false);
      return;
    }

    const pos = new THREE.Vector3((Math.random() - 0.5) * 2, 1.5, -2);
    
    if (item.type === 'primitive' && item.primitiveType) {
      const prim = assetManager.spawnPrimitive(item.primitiveType, pos);
      manipulationManagerRef.current?.selectAsset(prim);
      if (prim) recordSpawnUndo(prim);
    } else if (item.fileData) {
      const blob = new Blob([item.fileData], { type: item.metadata?.mimeType || 'application/octet-stream' });
      const file = new File([blob], item.name);
      const asset = await assetManager.importFile(file, pos);
      if (asset) {
        manipulationManagerRef.current?.selectAsset(asset);
        recordSpawnUndo(asset);
      }
    } else if (item.url) {
      // Remote URL item
      const response = await fetch(item.url);
      const blob = await response.blob();
      const file = new File([blob], item.name);
      const asset = await assetManager.importFile(file, pos);
      if (asset) {
        manipulationManagerRef.current?.selectAsset(asset);
        recordSpawnUndo(asset);
      }
    }
    setShowInventoryModal(false);
  };

  const handleEquipVrmFromInventory = async (item: InventoryItem) => {
    if (!item.fileData && !item.url) return;
    const blob = item.fileData ? new Blob([item.fileData]) : await (await fetch(item.url!)).blob();
    const file = new File([blob], item.name);
    await avatarManagerRef.current?.loadLocalVRM(file);
    setShowInventoryModal(false);
  };

  const handleUpdateGraphicsSettings = (newSettings: Partial<GraphicsSettings>) => {
    setGraphicsSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      sceneEngineRef.current?.updateSettings(updated);

      // Handle progressive LOD toggle
      if ('progressiveLOD' in newSettings) {
        const assetMgr = assetManagerRef.current;
        const renderer = sceneEngineRef.current?.renderer;
        if (assetMgr && renderer) {
          if (updated.progressiveLOD) {
            assetMgr.enableProgressiveLoading(renderer);
          } else {
            assetMgr.disableProgressiveLoading();
          }
        }
      }

      // Sync LODsManager settings when changed
      if ('lodTargetDensity' in newSettings || 'lodOverrideLevel' in newSettings) {
        const assetMgr = assetManagerRef.current;
        if (assetMgr) {
          assetMgr.getLODsManager().then((lm) => {
            if (lm) {
              if ('lodTargetDensity' in newSettings) lm.targetTriangleDensity = updated.lodTargetDensity;
              if ('lodOverrideLevel' in newSettings) lm.overrideLodLevel = updated.lodOverrideLevel;
            }
          });
        }
      }

      return updated;
    });
  };

  const handleUpdateEnvSettings = (newSettings: Partial<EnvironmentSettings>) => {
    setEnvSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      environmentManagerRef.current?.applySettings(updated);
      return updated;
    });
  };

  return (
    <div className="w-screen h-screen relative bg-[#07090e] select-none">
      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 z-0 w-full h-full" />

      {/* Center Crosshair — cyan when idle, amber when dev tool hovers
          a selectable asset, green when hovering an interactive panel. */}
      <div className="absolute inset-0 z-[5] pointer-events-none flex items-center justify-center">
        {(() => {
          const overPanel = isCrosshairOverPanel && cameraMode === 'first-person';
          const overAsset =
            !overPanel &&
            centerRayHitAssetId !== null &&
            activeTool === 'dev' &&
            cameraMode === 'first-person';

          const stroke = overPanel
            ? 'rgba(52,211,153,0.95)'   // green — panel hover
            : overAsset
            ? 'rgba(245,158,11,0.95)'   // amber — asset hover
            : 'rgba(0,240,255,0.7)';    // cyan  — idle

          const strokeOuter = overPanel
            ? 'rgba(52,211,153,0.55)'
            : overAsset
            ? 'rgba(245,158,11,0.65)'
            : 'rgba(0,240,255,0.5)';

          const fillDot = overPanel
            ? 'rgba(52,211,153,1)'
            : overAsset
            ? 'rgba(245,158,11,1)'
            : 'rgba(0,240,255,0.9)';

          const outerR = overPanel ? 5 : overAsset ? 3.6 : 3;
          // Gap: panel hover shows wider gap to feel more like a pointer
          const gapInner = overPanel ? 7 : 8;
          const gapOuter = overPanel ? 10 : 8;

          return (
            // pointerEvents="none" on the root SVG + Tailwind className
            // belt-and-braces: SVG child elements default to
            // pointer-events: visiblePainted, and a parent CSS rule of
            // pointer-events: none does NOT reliably cascade into SVG
            // children across browsers/renderers (Chromium and Firefox
            // have both shipped quirks here). When the inspector is
            // centered on the camera via "Bring To Me", the X/Y input
            // wrappers straddle the exact screen center, and the
            // crosshair dot/ring can absorb those clicks silently while
            // the offset Z input (further right) still works. Setting
            // the attribute directly on the SVG element forces every
            // painting descendant into the same pass-through state.
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" pointerEvents="none" className="pointer-events-none">
              {/* Outer ring — larger and coloured when over panel */}
              <circle cx="14" cy="14" r={outerR} stroke={strokeOuter} strokeWidth="1.5" fill="none" />
              {/* Crosshair lines — gap widens on panel hover to look like a hand cursor */}
              <line x1="14" y1="2"  x2="14" y2={gapInner}  stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="14" y1={28 - gapInner} x2="14" y2="26" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="2"  y1="14" x2={gapInner}  y2="14" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1={28 - gapOuter} y1="14" x2="26" y2="14" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              {/* Centre dot — square on panel hover to echo a pointer/cursor icon */}
              {overPanel
                ? <rect x="12.5" y="12.5" width="3" height="3" fill={fillDot} rx="0.5" />
                : <circle cx="14" cy="14" r="1" fill={fillDot} />
              }
              {/* Subtle pulse ring on panel hover */}
              {overPanel && (
                <circle cx="14" cy="14" r="7" stroke="rgba(52,211,153,0.25)" strokeWidth="1" fill="none" />
              )}
            </svg>
          );
        })()}
      </div>

      {/* Top Glass Navigation Bar */}
      <Navbar
        mode={mode}
        roomId={roomId}
        peerCount={peerCount}
        isHost={isHost}
        cameraMode={cameraMode}
        onToggleCameraMode={handleToggleCameraMode}
        onOpenWorldEnv={() => setShowWorldEnvModal(true)}
        onOpenShare={() => { setShareModalTab('multiplayer'); setShowShareModal(true); }}
        onOpenPairing={() => { setShareModalTab('pairing'); setShowShareModal(true); }}
        onOpenDashMenu={() => {
          inventoryServiceRef.current.getItems().then((items) => {
            setInventoryItems(items);
            if (sceneEngineRef.current?.renderer.xr.isPresenting) {
              vrHudRef.current?.setItems(items);
              vrHudRef.current?.toggle();
            } else {
              setShowDashMenu(true);
            }
          });
        }}
        onOpenSettings={() => setShowSettingsModal(true)}
        onToggleChat={() => { setShowChatPanel(!showChatPanel); setUnreadChatCount(0); }}
        onEnterVR={() => sceneEngineRef.current?.enterVR()}
        unreadChatCount={unreadChatCount}
      />

      {/* First-Person HUD stack — a single flex column anchors the
          locomotion banner AND the equipped-tool chip so they stack
          with a guaranteed `gap-2` clearance regardless of banner
          height (the banner's content can wrap on narrow viewports). */}
      {cameraMode === 'first-person' && showLocomotionBanner ? (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 pointer-events-none">
          <div className="glass-card px-6 py-2.5 flex items-center gap-3 border border-emerald-500/40 bg-emerald-950/60 shadow-[0_0_25px_rgba(16,185,129,0.4)] pointer-events-auto">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-semibold text-emerald-200 flex items-center gap-2">
              <span>Locomotion:</span>
              <div className="flex bg-slate-900/80 p-1 rounded-lg border border-slate-700 gap-1 pointer-events-auto">
                {(['walk', 'flight', 'noclip'] as const).map((lMode) => (
                  <button
                    key={lMode}
                    onClick={(e) => { e.stopPropagation(); handleSetLocomotionMode(lMode); }}
                    className={`px-2.5 py-1 rounded text-xs font-bold uppercase transition ${locomotionMode === lMode ? 'bg-emerald-500 text-slate-950 font-black shadow' : 'text-slate-300 hover:bg-slate-800'}`}
                  >
                    {lMode === 'walk' ? '🚶 Walk/Jump' : lMode === 'flight' ? '✈️ Flight' : '👻 Noclip'}
                  </button>
                ))}
              </div>
              <span>&bull;</span>
              <span className="flex items-center gap-1">Use <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-white border border-slate-600 text-xs font-mono">WASD</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-white border border-slate-600 text-xs font-mono">Space</kbd></span>
              <span>&bull;</span>
              <span>Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-white border border-slate-600 text-xs font-mono">ESC</kbd> to unlock cursor</span>
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setShowLocomotionBanner(false); }}
              title="Dismiss Locomotion Guide"
              className="ml-2 p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition border border-slate-700 hover:border-rose-500/40"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tool Equipped chip — visible while the dev tool is the
              active tool in first-person; hints at the look-and-press-R
              workflow (per Controls-Keybinds.txt dev-tool section).
              `whitespace-nowrap` keeps the chip a single row on narrow
              viewports so the flex-col stack doesn't reflow vertically. */}
          {activeTool === 'dev' && (
            <div className="glass-card px-4 py-1.5 flex items-center gap-2 border border-cyan-500/40 bg-cyan-950/60 shadow-[0_0_18px_rgba(0,240,255,0.3)] pointer-events-auto whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
                Tool Equipped: <span className="font-black uppercase text-cyan-100 tracking-wider">Dev</span>
                <span className="text-cyan-300/70">·</span>
                <span>Look at an object, then press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-white border border-slate-600 text-[10px] font-mono">R</kbd> to select</span>
              </span>
            </div>
          )}

          {/* Selection chip — when an asset is selected while in
              first-person, hint at the O-to-inspect workflow. */}
          {selectedAsset && (
            <div className="glass-card px-4 py-1.5 flex items-center gap-2 border border-amber-500/40 bg-amber-950/60 shadow-[0_0_18px_rgba(245,158,11,0.30)] pointer-events-auto whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-semibold text-amber-200 flex items-center gap-1.5">
                Selected: <span className="font-black uppercase text-amber-100 tracking-wider truncate max-w-[180px]">{selectedAsset.name || 'Object'}</span>
                <span className="text-amber-300/70">·</span>
                <span>Press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-white border border-slate-600 text-[10px] font-mono">O</kbd> to open inspector</span>
              </span>
            </div>
          )}
        </div>
      ) : selectedAsset && (
        /* Orbit-mode sibling for the selection chip so the user sees
           the O hint even when they're not in first-person — the
           inspector O-keybind works in either camera mode. */
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="glass-card px-4 py-1.5 flex items-center gap-2 border border-amber-500/40 bg-amber-950/60 shadow-[0_0_18px_rgba(245,158,11,0.30)] pointer-events-auto whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-semibold text-amber-200 flex items-center gap-1.5">
              Selected: <span className="font-black uppercase text-amber-100 tracking-wider truncate max-w-[180px]">{selectedAsset.name || 'Object'}</span>
              <span className="text-amber-300/70">·</span>
              <span>Press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-white border border-slate-600 text-[10px] font-mono">O</kbd> to open inspector</span>
            </span>
          </div>
        </div>
      )}

      {/* Floating Bottom Toolbar */}
      <Toolbar
        currentMode={currentTransformMode}
        onSetMode={handleSetMode}
        selectedAsset={selectedAsset}
        onToggleCollision={handleToggleCollision}
        onDeleteSelected={handleDeleteSelected}
        onFocusSelected={handleFocusSelected}
        onSpawnPrimitive={handleSpawnPrimitive}
        onOpenInventory={() => setShowInventoryModal(true)}
        onOpenImport={() => { setImportInitialFile(null); setShowImportDialog(true); }}
        onOpenTools={() => setShowToolsPanel(!showToolsPanel)}
        onOpenInspector={() => setShowSceneInspector(true)}
        onOpenRadialMenu={() => {
          setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          setShowRadialMenu(true);
        }}
        activeTool={showToolsPanel ? activeTool : null}
        transformSpace={transformSpace}
        onToggleSpace={handleToggleSpace}
      />

      {/* Resonite / World Tools Panel */}
      {showToolsPanel && (
        <WorldToolsPanel
          activeTool={activeTool}
          onSelectTool={(t) => {
            setActiveTool(t);
            if (t === 'brush') {
              brushManagerRef.current?.startStroke('#00f0ff', 0.05);
            }
          }}
          selectedAsset={selectedAsset}
          onSpawnPrimitive={handleSpawnPrimitive}
          onApplyMaterial={(color, roughness, metalness, wireframe, emissive, opacity, textureUrl) => {
            if (selectedAsset) {
              selectedAsset.object3d.traverse((child) => {
                if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
                  const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                  if (color) m.color.set(color);
                  if (roughness !== undefined) m.roughness = roughness;
                  if (metalness !== undefined) m.metalness = metalness;
                  if (wireframe !== undefined) m.wireframe = wireframe;
                  if (emissive) m.emissive.set(emissive);
                  if (opacity !== undefined) {
                    m.opacity = opacity;
                    m.transparent = opacity < 1.0;
                  }
                  if (textureUrl) {
                    if (textureUrl === 'none') {
                      m.map = null;
                      m.needsUpdate = true;
                    } else {
                      new THREE.TextureLoader().load(textureUrl, (tex) => {
                        tex.wrapS = THREE.RepeatWrapping;
                        tex.wrapT = THREE.RepeatWrapping;
                        tex.repeat.set(2, 2);
                        m.map = tex;
                        m.needsUpdate = true;
                      });
                    }
                  }
                  m.needsUpdate = true;
                }
              });
            }
          }}
          onSpawnLight={(type, color, intensity, distance) => {
            const pos = new THREE.Vector3(0, 2.5, -1.5);
            const lightAsset = assetManagerRef.current?.spawnPrimitive('sphere', pos);
            if (lightAsset) {
              lightAsset.name = `${type.toUpperCase()} Light`;
              const mesh = lightAsset.object3d.children[0] as THREE.Mesh;
              if (mesh && mesh.material) {
                (mesh.material as THREE.MeshStandardMaterial).color.set(color);
                (mesh.material as THREE.MeshStandardMaterial).emissive.set(color);
                (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.0;
              }
              const light = type === 'point'
                ? new THREE.PointLight(color, intensity, distance || 10)
                : new THREE.SpotLight(color, intensity, distance || 15);
              lightAsset.object3d.add(light);
              manipulationManagerRef.current?.selectAsset(lightAsset);
            }
          }}
          onToggleDrawing={() => {
            if (brushManagerRef.current) {
              const drawing = !brushManagerRef.current.isActive;
              brushManagerRef.current.isActive = drawing;
              if (drawing) {
                const pos = new THREE.Vector3(0, 1.5, -1.5);
                brushManagerRef.current.startStroke('#ff007f', 0.05);
                brushManagerRef.current.addPoint(pos);
                brushManagerRef.current.addPoint(pos.clone().add(new THREE.Vector3(0.5, 0.5, 0)));
                brushManagerRef.current.addPoint(pos.clone().add(new THREE.Vector3(1.0, 0, 0)));
              }
            }
          }}
          currentTransformMode={currentTransformMode}
          onSetTransformMode={setCurrentTransformMode}
          onToggleWireframe={() => {
            if (selectedAsset) {
              selectedAsset.object3d.traverse((child) => {
                if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
                  const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                  (m as THREE.MeshStandardMaterial).wireframe = !(m as THREE.MeshStandardMaterial).wireframe;
                }
              });
            }
          }}
          brushColor="#ff007f"
          onChangeBrushColor={(c) => {
            if (brushManagerRef.current) brushManagerRef.current.currentColor = c;
          }}
          brushWidth={brushWidth}
          onChangeBrushWidth={(w) => {
            setBrushWidth(w);
            if (brushManagerRef.current) brushManagerRef.current.currentWidth = w;
          }}
          isDrawingActive={false}
          onClearStrokes={() => brushManagerRef.current?.clearAll()}
          onClose={() => setShowToolsPanel(false)}
        />
      )}

      {/* Resonite Spatial Scene Inspector Window */}
      <SceneInspectorWindow
        isOpen={showSceneInspector}
        onClose={() => setShowSceneInspector(false)}
        selectedAsset={selectedAsset}
        onUpdateAsset={(updated) => {
          setSelectedAsset({ ...updated });
          networkServiceRef.current.broadcastAssetUpdate(updated);
        }}
        onDeleteAsset={handleDeleteSelected}
        onJumpToAsset={(asset) => {
          if (sceneEngineRef.current) {
            sceneEngineRef.current.camera.position.set(
              asset.object3d.position.x,
              asset.object3d.position.y + 0.5,
              asset.object3d.position.z + 2.5
            );
            sceneEngineRef.current.controls.target.copy(asset.object3d.position);
            sceneEngineRef.current.controls.update();
          }
        }}
        onBringAsset={(asset) => {
          if (sceneEngineRef.current) {
            const camPos = new THREE.Vector3();
            const camDir = new THREE.Vector3();
            sceneEngineRef.current.camera.getWorldPosition(camPos);
            sceneEngineRef.current.camera.getWorldDirection(camDir);
            camDir.y = 0;
            if (camDir.lengthSq() === 0) camDir.set(0, 0, -1);
            camDir.normalize();
            const newPos = camPos.clone().add(camDir.multiplyScalar(2.0));
            newPos.y = Math.max(0.5, camPos.y);
            asset.object3d.position.copy(newPos);
            setSelectedAsset({ ...asset });
            networkServiceRef.current.broadcastAssetUpdate(asset);
          }
        }}
        scene={sceneEngineRef.current?.scene}
        camera={sceneEngineRef.current?.camera}
        assetManager={assetManagerRef.current || undefined}
        spatialPanelManager={sceneEngineRef.current?.spatialPanelManager}
      />

      {/* Text & Voice Chat Sidebar */}
      <ChatPanel
        networkService={networkServiceRef.current}
        isOpen={showChatPanel}
        onClose={() => setShowChatPanel(false)}
        onReadMessages={() => setUnreadChatCount(0)}
      />

      {/* Share / Invite & Pairing Modal */}
      {showShareModal && (
        <ShareModal
          currentMode={mode}
          currentRoomId={roomId}
          onClose={() => setShowShareModal(false)}
          onJoinRoom={handleJoinRoom}
          onDisconnect={handleDisconnect}
          initialTab={shareModalTab}
        />
      )}

      {/* Inventory Modal */}
      {showInventoryModal && (
        <InventoryModal
          inventoryService={inventoryServiceRef.current}
          onClose={() => setShowInventoryModal(false)}
          onSpawnItem={handleSpawnFromInventory}
          onEquipVrm={handleEquipVrmFromInventory}
        />
      )}

      {/* File Import Modal (Legacy / Simple) */}
      {showImportModal && (
        <FileImportModal
          onImportFile={handleImportFile}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Interactive Asset Customization Dialog */}
      {showImportDialog && (
      <AssetImportDialog
          initialFile={importInitialFile}
          onImport={handleImportAssetFromConfig}
          onClose={() => setShowImportDialog(false)}
          scene={sceneEngineRef.current?.scene}
          camera={sceneEngineRef.current?.camera}
          assetManager={assetManagerRef.current || undefined}
          spatialPanelManager={sceneEngineRef.current?.spatialPanelManager}
        />
      )}

      {/* World Environment & Skybox Modal */}
      {showWorldEnvModal && (
        <WorldEnvironmentModal
          settings={envSettings}
          onUpdateSettings={handleUpdateEnvSettings}
          onClose={() => setShowWorldEnvModal(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          settings={graphicsSettings}
          stats={stats}
          onUpdateSettings={handleUpdateGraphicsSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {/* Misc File Inspection Modal */}
      {/* Tabbed Dash Menu Modal */}
      <DashMenu
        isOpen={showDashMenu}
        onClose={() => setShowDashMenu(false)}
        networkService={networkServiceRef.current}
        localRole={localRole}
        onUpdateRole={handleUpdateRole}
        onModerateUser={handleModerateUser}
        defaultConfig={defaultPermissionsConfig}
        onUpdateDefaultConfig={setDefaultPermissionsConfig}
        inventoryItems={inventoryItems}
        onSpawnItem={handleSpawnFromInventory}
        onEquipVrm={handleEquipVrmFromInventory}
        onOpenFullSettings={() => { setShowDashMenu(false); setShowSettingsModal(true); }}
      />

      {/* Resonite Radial Context Menu (Pie Menu) — desktop 2D overlay */}
      <RadialContextMenu
        isOpen={showRadialMenu}
        position={radialMenuPos}
        onClose={() => setShowRadialMenu(false)}
        locomotionMode={locomotionMode}
        onSetLocomotionMode={handleSetLocomotionMode}
        scalingEnabled={scalingEnabled}
        onToggleScaling={() => setScalingEnabled((prev) => !prev)}
        laserEnabled={laserEnabled}
        onToggleLaser={() => setLaserEnabled((prev) => !prev)}
        grabMode={grabMode}
        onSetGrabMode={setGrabMode}
        onUndo={() => undoRedoManagerRef.current.undo()}
        onRedo={() => undoRedoManagerRef.current.redo()}
        isHeld={isHeld}
        heldAssetType={heldAssetType}
        onDestroy={handleDestroyHeld}
        onDuplicate={handleDuplicateHeld}
        onSaveHeld={handleSaveHeldToInventory}
        onDownloadHeld={handleDownloadHeld}
      />

   </div>
  );
};
