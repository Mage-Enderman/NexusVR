import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import confetti from 'canvas-confetti';

import { SceneEngine } from './engine/SceneEngine.ts';
import type { GraphicsSettings } from './engine/SceneEngine.ts';
import { AssetManager } from './engine/AssetManager.ts';
import type { AssetType, LoadedAsset, ImportConfig } from './engine/AssetManager.ts';
import { ManipulationManager } from './engine/ManipulationManager.ts';
import type { TransformMode } from './engine/ManipulationManager.ts';
import { AvatarManager } from './engine/AvatarManager.ts';
import { NetworkService } from './services/NetworkService.ts';
import type { ConnectionMode, AssetSpawnData, ChatMessage, MaterialUpdate, InspectorUpdateData } from './services/NetworkService.ts';
import { VideoStreamingService } from './services/VideoStreamingService.ts';

import { InventoryService } from './services/InventoryService.ts';
import type { InventoryItem } from './services/InventoryService.ts';
import { UndoRedoManager } from './services/UndoRedoManager.ts';
import type { TransformSnapshot, AssetSnapshot } from './services/UndoRedoManager.ts';
import { toast } from './services/ToastService.ts';

import { Navbar } from './components/Navbar.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { CrosshairOverlay } from './components/CrosshairOverlay.tsx';
import { VideoControlsPopup } from './components/VideoControlsPopup.tsx';
import { ModalsHost } from './components/ModalsHost.tsx';
import { EnvironmentManager } from './engine/EnvironmentManager.ts';
import type { EnvironmentSettings } from './engine/EnvironmentManager.ts';
import type { UserRole, DefaultPermissionsConfig } from './types/permissions.ts';
import { NetworkStatsOverlay } from './components/NetworkStatsOverlay.tsx';
import { DashMenu } from './components/DashMenu.tsx';
import { loadSubtitleSettings, saveSubtitleSettings, type SubtitleSettings } from './utils/subtitleSettings.ts';
import { VRHUDManager } from './engine/VRHUDManager.ts';
import { BrushManager } from './engine/BrushManager.ts';
import type { ToolType } from './engine/ContextMenuManager.ts';
import { SceneInspectorWindow } from './components/SceneInspectorWindow.tsx';
import { SpatialPopUpWrapper } from './components/SpatialPopUpWrapper.tsx';
import { RadialContextMenu } from './components/RadialContextMenu.tsx';
import { ToastHost } from './components/ToastHost.tsx';
import { VRRadialMenuMesh } from './engine/VRRadialMenuMesh.ts';
import type { VRRadialMenuState, VRRadialMenuCallbacks } from './engine/VRRadialMenuMesh.ts';
import type { ContextMenuItemDef } from './engine/ContextMenuManager.ts';
import { createPanelActionHandler } from './handlers/createPanelActionHandler.ts';
import { createAssetImportHandlers } from './handlers/assetImportHandlers.ts';
import { registerNetworkEventHandlers } from './handlers/networkEventHandlers.ts';
import { createUndoRedoHandlers } from './handlers/undoRedoHandlers.ts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts';
import { useFileDropPaste } from './hooks/useFileDropPaste.ts';
import { isGrabbable, isScalable } from './components/grabbable/GrabbableComponent.ts';
import { X } from 'lucide-react';
import { CompanionTunnelService, type TunnelStatus, type DeviceInfo } from './services/CompanionTunnelService.ts';
import { CompanionPortal } from './components/CompanionPortal.tsx';

const NexusVRMain: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Engine references
  const sceneEngineRef = useRef<SceneEngine | null>(null);
  const assetManagerRef = useRef<AssetManager | null>(null);
  const manipulationManagerRef = useRef<ManipulationManager | null>(null);
  const avatarManagerRef = useRef<AvatarManager | null>(null);
  const environmentManagerRef = useRef<EnvironmentManager | null>(null);
  const networkServiceRef = useRef<NetworkService>(new NetworkService());
// Phase 3A: peer-side delivery for large videos via a binary DataChannel.
// Constructor wires net.onPeerLeave so peer teardown is automatic.
const videoStreamingServiceRef = useRef<VideoStreamingService>(
  new VideoStreamingService(networkServiceRef.current)
);
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
  const pendingAssetsRef = useRef<Map<string, { group: THREE.Group; dispose: () => void; setProgress?: (pct: number | null) => void; oversized?: boolean }>>(new Map());
  // Phase 3A: per-asset suppress-Set for the auto-broadcast race.
  // handleImportFile / handleImportAssetFromConfig add the asset's
  // placeholderId to this Set BEFORE awaiting AssetManager.importFile;
  // the registerOnAssetAdded callback's gate consults it and, if
  // present, deletes-and-returns without firing its own broadcast.
  // handleImportFile / handleImportAssetFromConfig do the manual
  // broadcast AFTER the await with the streamingHint attached. A
  // `finally` block in both handlers cleans up the entry on the
  // error path (where registerOnAssetAdded never fires).
  const streamingSuppressedAssetIdsRef = useRef<Set<string>>(new Set());
  // Pending video orientation / subtitle state for assets still mid-
  // transfer. `applyVideoState` silently no-ops while the asset isn't in
  // the AssetManager map yet, so a flip or subtitle attach broadcast during
  // a video's P2P transfer window would otherwise be dropped — the video
  // then renders upside down (or captionless) for that peer. onVideoState
  // stashes the latest payload here when the asset is missing; the P2P /
  // URL import completion paths apply and clear it once the asset lands.
  const pendingVideoStateRef = useRef<Map<string, { flipped?: boolean; subtitlesData?: string; subtitlesEnabled?: boolean }>>(new Map());

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
  const [selectionMode, setSelectionMode] = useState<'single' | 'multi'>('single');
  const selectionModeRef = useRef<'single' | 'multi'>('single');
  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);
  const [activeVideoAssetId, setActiveVideoAssetId] = useState<string | null>(null);
  const videoInactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dedicated bump counter for mute-toggle re-render. Replaces the
  // previous setPeerCount(prev => prev) hack that relied on React
  // skipping no-op state updates (unreliable in React 19).


  const resetVideoInactivityTimer = useCallback(() => {
    if (videoInactivityTimerRef.current) {
      clearTimeout(videoInactivityTimerRef.current);
    }
    videoInactivityTimerRef.current = setTimeout(() => {
      setActiveVideoAssetId(null);
    }, 6000);
  }, []);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'first-person'>('first-person');
  const [showNetworkStats, setShowNetworkStats] = useState(false);
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(loadSubtitleSettings());

  const handleUpdateSubtitleSettings = (partial: Partial<SubtitleSettings>) => {
    const next = { ...subtitleSettings, ...partial };
    setSubtitleSettings(next);
    saveSubtitleSettings(next);
    assetManagerRef.current?.setSubtitleSettings(next);
    for (const asset of assetManagerRef.current?.assets.values() || []) {
      if (asset.type === 'video' && asset.videoElement) {
        assetManagerRef.current?.enableSubtitleCanvasForVideo(asset.id);
      }
    }
  };
  const [showLocomotionBanner, setShowLocomotionBanner] = useState<boolean>(false);
  const [locomotionMode, setLocomotionMode] = useState<'walk' | 'flight' | 'noclip'>('walk');
  // Multiple independent inspector windows, each pinned to the asset
  // selected at spawn time. Instances are identified by a unique key
  // and carry a stable reference to the LoadedAsset they inspect.
  const [inspectorInstances, setInspectorInstances] = useState<Array<{
    id: string;
    pinnedAsset: LoadedAsset | null;
  }>>([]);
  const inspectorInstancesRef = useRef(inspectorInstances);
  inspectorInstancesRef.current = inspectorInstances;

  const openInspectorForAsset = useCallback((asset: LoadedAsset | null) => {
    const existing = asset
      ? inspectorInstancesRef.current.find(i => i.pinnedAsset?.id === asset.id)
      : inspectorInstancesRef.current.find(i => !i.pinnedAsset);
    if (existing) {
      const se = sceneEngineRef.current;
      if (se?.spatialPanelManager && se?.camera) {
        se.spatialPanelManager.bringToCamera(existing.id, se.camera);
        return;
      }
    }
    const instanceId = asset
      ? `inspector-${asset.id}-${Date.now()}`
      : `inspector-hierarchy-${Date.now()}`;
    setInspectorInstances(prev => [...prev, { id: instanceId, pinnedAsset: asset }]);
  }, []);

  const closeInspectorInstance = useCallback((instanceId: string) => {
    setInspectorInstances(prev => prev.filter(i => i.id !== instanceId));
  }, []);

  // Bug fix — host→peer inspector object sync (Issue 2). With
  // multi-instance inspectors we broadcast whenever any inspector
  // is open. The peer handler tracks the latest open inspector
  // so the mirrored view shows the most recently inspected asset.
  useEffect(() => {
    if (inspectorInstances.length === 0) return;
    const ns = networkServiceRef.current;
    if (!ns || ns.mode === 'offline') return;
    // Broadcast the most recently opened instance's asset
    const latest = inspectorInstances[inspectorInstances.length - 1];
    ns.broadcastPanelState({
      action: 'open',
      panelId: 'inspector',
      originatorPeerId: ns.localPeerId,
      originatorUserName: userName,
      originatorRole: localRole,
      targetAssetId: latest.pinnedAsset?.id ?? null,
      ts: Date.now(),
    });
  }, [inspectorInstances]);
  // Set true by Ctrl+Shift+V keydown so the next paste event is treated as
  // plain text (no URL / data-URI import handling). Cleared in handlePaste
  // on the following paste event, or by a keyup safety net.
  const plainPasteModeRef = useRef(false);

  // Refs that mirror state read by the (single-bound) animation-loop
  // callback. The useRef declarations live here; the `.current = state`
  // hooks that mirror the values are placed immediately after the
  // matching useState further down so the const state has already been
  // declared by the time we read it (TS2454 otherwise).
  const activeToolRef = useRef<ToolType | null>(null);
  const cameraModeRef = useRef<'orbit' | 'first-person'>('first-person');
  // Mirror of `locomotionMode` state so the engine-init useEffect's
  // onPanelAction dispatcher (captured with `[]` deps) can read the
  // live value instead of the initial 'walk' it closed over. Same
  // pattern as activeToolRef / cameraModeRef above; kept in sync by
  // a small useEffect further down.
  const locomotionModeRef = useRef<'walk' | 'flight' | 'noclip'>('walk');
  const allowedLocomotionsRef = useRef<Array<'walk' | 'flight' | 'noclip'>>(['walk', 'flight', 'noclip']);
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
  // Mirror of showChatPanel state for closures inside []-deps useEffect
  // callbacks (net.onChat) that need the LIVE value instead of the stale
  // initial-state capture. Same pattern as showRadialMenuRef above.
  const showChatPanelRef = useRef<boolean>(true);
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
  const [heldAssetCustomItems, setHeldAssetCustomItems] = useState<ContextMenuItemDef[] | undefined>(undefined);
  const [radialMenuPos, setRadialMenuPos] = useState<{ x: number; y: number }>({ x: 500, y: 500 });
  // VR radial menu (canvas-textured mesh). `vrRadialOpen` tracks open
  // state; `vrRadialMenuRef` holds the lazily-constructed VRRadialMenuMesh
  // (the mesh is built on first B/Y press and re-used across cycles so its
  // texture / geometry aren't churned). `vrRadialActiveSideRef` records
  // which controller placed the mesh so the per-frame aim loop can poll
  // the correct XRTargetRaySpace. We use VRRadialMenuMesh's canvas
  // texture for VR - pure immersive WebXR can't rasterise the
  // React-DOM <svg>-based RadialContextMenu through HTMLMesh's
  // html2canvas path, so any radial menu mounted into SpatialPanelManager
  // came out blank. The desktop <RadialContextMenu> overlay path
  // (`setShowRadialMenu`) is unchanged.
  const [vrRadialLeftOpen, setVrRadialLeftOpen] = useState(false);
  const [vrRadialRightOpen, setVrRadialRightOpen] = useState(false);
  const vrRadialMenuLeftRef = useRef<VRRadialMenuMesh | null>(null);
  const vrRadialMenuRightRef = useRef<VRRadialMenuMesh | null>(null);
  const heldSideRef = useRef<'left' | 'right' | null>(null);
  const heldAssetsBySideRef = useRef<{ left: LoadedAsset | null; right: LoadedAsset | null }>({ left: null, right: null });
  // Track which grip is currently holding a spatial panel (dash menu, inspector).
  // Separate from ManipulationManager's vrGrabWithController because panels are
  // directly parented to the grip, not routed through the full grab state machine.
  const spatialPanelGripRef = useRef<{
    side: 'left' | 'right';
    panelId: string;
    group: THREE.Group;
    originalParent: THREE.Object3D | null;
  } | null>(null);
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
  const [importInitialUrl, setImportInitialUrl] = useState<string>('');
  const [showWorldEnvModal, setShowWorldEnvModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showChatPanel, setShowChatPanel] = useState<boolean>(true);
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);
  const [userName, setUserName] = useState<string>(() => networkServiceRef.current.localUserName);
  // Rolling buffer of recent chat messages; mirrors VRHUDManager's
  // internal _recentMessages for the React-driven setDataContext push
  // (the manager keeps its own copy via appendIncomingChat so the canvas
  // redraws on every keystroke without paying the React render cost).
  // Capped to 30 -- matched to VRHUDManager.CHAT_MESSAGE_HISTORY.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  // Companion Device Import Tunnel State
  const [companionStatus, setCompanionStatus] = useState<TunnelStatus>('idle');
  const [companionDevice, setCompanionDevice] = useState<DeviceInfo | null>(null);
  const [companionPairCode, setCompanionPairCode] = useState<string>('');

  // Permissions & Dash Menu State
  const [localRole, setLocalRole] = useState<UserRole>('admin');
  const [defaultPermissionsConfig, setDefaultPermissionsConfig] = useState<DefaultPermissionsConfig>({
    anonymousDefaultRole: 'guest',
    registeredDefaultRole: 'builder',
    contactsDefaultRole: 'builder',
    hostRole: 'admin'
  });
  const [showDashMenu, setShowDashMenu] = useState<boolean>(false);
  // Mirrors renderer.xr.isPresenting so React re-renders on VR entry/exit.
  const [isVRPresenting, setIsVRPresenting] = useState<boolean>(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryFolders, setInventoryFolders] = useState<string[]>([]);
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
  const [activeTool, setActiveTool] = useState<ToolType | null>(null);
  const [uiRefreshKey, setUiRefreshKey] = useState<number>(0);

  const handleRefreshUI = useCallback(() => {
    console.log(`[SpatialUI] Manual UI refresh triggered (F9 / window.refreshUI()) - activePanels=${sceneEngineRef.current?.spatialPanelManager?.getPanelCount() ?? 0}`);
    sceneEngineRef.current?.spatialPanelManager?.refreshPanels();
    setUiRefreshKey((prev) => prev + 1);
    toast.info('UI Panels Refreshed (F9)');
  }, []);

  useEffect(() => {
    (window as any).refreshUI = handleRefreshUI;
    (window as any).__nexus_spm = sceneEngineRef.current?.spatialPanelManager;
    return () => {
      delete (window as any).refreshUI;
      delete (window as any).__nexus_spm;
    };
  }, [handleRefreshUI]);

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
    locomotion: {
      allowedLocomotions: ['walk', 'flight', 'noclip'],
      scalingEnabled: true,
    },
  });

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>('');

  useEffect(() => {
    if ((showDashMenu || showRadialMenu) && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const mics = devices.filter(d => d.kind === 'audioinput');
        setAudioDevices(mics);
      }).catch(err => console.warn('Failed to enumerate audio devices:', err));
    }
  }, [showDashMenu, showRadialMenu]);

  const handleSelectAudioDevice = async (deviceId: string) => {
    setSelectedAudioDeviceId(deviceId);
    await networkServiceRef.current.switchAudioInputDevice(deviceId);
  };

  // Escape closes the topmost open modal / overlay. Previously only DashMenu's
  // inline rename dialogs handled Escape; every other panel could only be
  // dismissed by clicking its X or the backdrop. Closes ONE panel per press
  // (topmost-first) so stacked panels unwind naturally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (showShareModal) { setShowShareModal(false); return; }
      if (showSettingsModal) { setShowSettingsModal(false); return; }
      if (showWorldEnvModal) { setShowWorldEnvModal(false); return; }
      if (showImportDialog) { setShowImportDialog(false); return; }
      if (showImportModal) { setShowImportModal(false); return; }
      if (showInventoryModal) { setShowInventoryModal(false); return; }
      if (showDashMenu) { setShowDashMenu(false); return; }
      if (showRadialMenu) { setShowRadialMenu(false); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showShareModal, showSettingsModal, showWorldEnvModal, showImportDialog, showImportModal, showInventoryModal, showDashMenu, showRadialMenu]);

  const isAnyModalOpen = Boolean(
    showShareModal ||
    showSettingsModal ||
    showWorldEnvModal ||
    showImportModal ||
    showInventoryModal ||
    showDashMenu
  );

  useEffect(() => {
    if (sceneEngineRef.current) {
      sceneEngineRef.current.canAcquirePointerLock = () => !isAnyModalOpen;
    }
    if (isAnyModalOpen && document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }, [isAnyModalOpen]);

  const handleToggleMute = useCallback(async () => {
    await networkServiceRef.current.toggleMute();
    const isMuted = networkServiceRef.current.isMuted;
    vrRadialMenuLeftRef.current?.setState({ isMuted });
    vrRadialMenuRightRef.current?.setState({ isMuted });
    const listener = avatarManagerRef.current?.audioListener;
    if (listener && listener.context.state === 'suspended') {
      listener.context.resume().catch(() => {});
    }
  }, []);


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
  useEffect(() => {
    allowedLocomotionsRef.current = envSettings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip'];
    const allowed = envSettings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip'];
    vrRadialMenuLeftRef.current?.setState({ allowedLocomotions: allowed });
    vrRadialMenuRightRef.current?.setState({ allowedLocomotions: allowed });
  }, [envSettings.locomotion?.allowedLocomotions]);
  // Clamp current locomotion when allowed list changes
  useEffect(() => {
    const allowed = envSettings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip'];
    if (!allowed.includes(locomotionMode)) {
      handleSetLocomotionMode(allowed[0] ?? 'walk');
    }
  }, [envSettings.locomotion?.allowedLocomotions, locomotionMode]);
  // Sync the menu-open ref mirror so []-deps-closure handlers
  // (onCanvasAuxMouseDown in particular) see the LIVE value
  // when toggling via MMB.
  useEffect(() => {
    showRadialMenuRef.current = showRadialMenu;
  }, [showRadialMenu]);
  useEffect(() => {
    showChatPanelRef.current = showChatPanel;
  }, [showChatPanel]);
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
  // already sees fresh values - no per-frame lag.
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
      const mL = vrRadialMenuLeftRef.current;
      if (mL) {
        if (mL.group.parent) mL.group.parent.remove(mL.group);
        mL.dispose();
        vrRadialMenuLeftRef.current = null;
      }
      const mR = vrRadialMenuRightRef.current;
      if (mR) {
        if (mR.group.parent) mR.group.parent.remove(mR.group);
        mR.dispose();
        vrRadialMenuRightRef.current = null;
      }
    };
  }, []);

    useEffect(() => {
    if (!vrRadialLeftOpen && !vrRadialRightOpen) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const se = sceneEngineRef.current;
      if (!se || !se.renderer.xr.isPresenting) return;
      const ctrRight = se.vrInput?.getController('right');
      const ctrLeft = se.vrInput?.getController('left');

      const checkAimOnMesh = (mesh: VRRadialMenuMesh) => {
        if (!mesh || mesh.disposed || !mesh.isVisible) return false;
        if (ctrRight) {
          ctrRight.updateWorldMatrix(true, false);
          vrRadialAimOriginRef.current.setFromMatrixPosition(ctrRight.matrixWorld);
          vrRadialAimDirQuatRef.current.setFromRotationMatrix(ctrRight.matrixWorld);
          vrRadialAimDirRef.current.set(0, 0, -1).applyQuaternion(vrRadialAimDirQuatRef.current).normalize();
          vrRadialAimRayRef.current.set(vrRadialAimOriginRef.current, vrRadialAimDirRef.current);
          if (mesh.updateAim(vrRadialAimRayRef.current)) return true;
        }
        if (ctrLeft) {
          ctrLeft.updateWorldMatrix(true, false);
          vrRadialAimOriginRef.current.setFromMatrixPosition(ctrLeft.matrixWorld);
          vrRadialAimDirQuatRef.current.setFromRotationMatrix(ctrLeft.matrixWorld);
          vrRadialAimDirRef.current.set(0, 0, -1).applyQuaternion(vrRadialAimDirQuatRef.current).normalize();
          vrRadialAimRayRef.current.set(vrRadialAimOriginRef.current, vrRadialAimDirRef.current);
          return mesh.updateAim(vrRadialAimRayRef.current);
        }
        return false;
      };

      if (vrRadialMenuLeftRef.current) checkAimOnMesh(vrRadialMenuLeftRef.current);
      if (vrRadialMenuRightRef.current) checkAimOnMesh(vrRadialMenuRightRef.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [vrRadialLeftOpen, vrRadialRightOpen]);

  // Push React state into the lazy VRRadialMenuMesh so slice labels
  // recolour on toggle (e.g. SCALE goes from red to green when
  // scalingEnabled flips). The mesh stays the same instance across
  // re-renders, so its canvas texture re-rasterises only when the
  // tracked inputs actually change. Each tick = one setState call,
  // cheap.
  useEffect(() => {
    const updateMeshState = (mesh: VRRadialMenuMesh | null, menuSide: 'left' | 'right') => {
      if (!mesh) return;
      const sideIsHolding = isHeld && (heldSideRef.current === menuSide || heldSideRef.current === null);
      mesh.setState({
        locomotionMode,
        scalingEnabled,
        laserEnabled,
        grabMode,
        isHeld: sideIsHolding,
        isMuted: networkServiceRef.current.isMuted,
        heldAssetType: sideIsHolding && heldAssetType !== null ? String(heldAssetType) : null,
        heldAssetCustomItems: sideIsHolding ? heldAssetCustomItems : undefined,
      });
      if (sideIsHolding) {
        mesh.setActiveTab('held');
      } else if (mesh.activeTab === 'held') {
        mesh.setActiveTab('general');
      }
    };
    updateMeshState(vrRadialMenuLeftRef.current, 'left');
    updateMeshState(vrRadialMenuRightRef.current, 'right');
  }, [locomotionMode, scalingEnabled, laserEnabled, grabMode, isHeld, heldAssetType]);

  // Initialize 3D Viewport & Engines
  useEffect(() => {
    if (!containerRef.current) return;
    
    const sceneEngine = new SceneEngine(containerRef.current);
    sceneEngineRef.current = sceneEngine;

    const assetManager = new AssetManager(sceneEngine.scene, sceneEngine.worldRoot, undefined, videoStreamingServiceRef.current, sceneEngine.camera);
    assetManagerRef.current = assetManager;

    // Pass `assetManager.assets` so the manager's RMB-grab raycast can
    // hit-detect on the same live Map App.tsx spawns into (the Map is
    // mutated in place - single reference is always current). The 5th
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
    manipulationManager.worldRoot = sceneEngine.worldRoot;
    networkServiceRef.current.worldRoot = sceneEngine.worldRoot;
    // Wire VR input so the held-asset dolly can read the holding
    // controller's thumbstick Y. SceneEngine constructs
    // VRInputManager synchronously in its constructor (see
    // SceneEngine.setupXR), so this ref is already live by the
    // time the engine-init useEffect wires it. Null safety
    // guaranteed - the dolly path early-returns without input.
    manipulationManager.setVRInput(sceneEngine.vrInput);
    sceneEngine.isVRHandGrabbing = (side) => manipulationManager.isVRHandGrabbing(side);
    // Lets SceneEngine.onMouseMoveForLook know when mouse movement is being
    // consumed by E-rotate, so the camera view stays still while the user
    // rotates an object (E + RMB-grab, or E + LMB on a selection).
    sceneEngine.isERotateActive = (buttons) => manipulationManager.isERotateMouseActive(buttons);

    const avatarManager = new AvatarManager(sceneEngine.scene, sceneEngine.camera, sceneEngine.worldRoot);
    avatarManager.onLocalVrmLoaded = (_vrm, dims) => {
      sceneEngine.setAvatarEyeHeight(dims.eyeHeight);
    };
    avatarManager.onLocalVrmBufferLoaded = (buffer) => {
      if (networkServiceRef.current && networkServiceRef.current.mode !== 'offline') {
        networkServiceRef.current.broadcastAvatarVRM(buffer);
      }
    };
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
      sceneEngine.dirLight,
      sceneEngine.renderer
    );
    environmentManagerRef.current = environmentManager;
    sceneEngine.environmentManager = environmentManager;

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
                  openInspectorForAsset(selectedAsset);
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
          // Extracted to handlers/createPanelActionHandler.ts - see that
          // file for the full per-action-family behavior notes (undo/redo
          // semantics, the dirty() post-edit housekeeping, transform
          // stepper units, material slot cycling, etc).
          onPanelAction: createPanelActionHandler({
            sceneEngineRef,
            environmentManagerRef,
            manipulationManagerRef,
            assetManagerRef,
            vrHudRef,
            undoRedoManagerRef,
            networkServiceRef,
            inventoryServiceRef,
            locomotionModeRef,
            allowedLocomotionsRef,
            selectedAssetRef,
            setGrabMode,
            setScalingEnabled,
            setLaserEnabled,
            setSelectedAsset,
            handleSetLocomotionMode,
            handleJoinRoom,
            handleDisconnect,
            handleSpawnFromInventory,
            handleDeleteSelected,
            handleVideoAction,
            handleVideoClose,
            handleAudioAction,
            handleAudioClose,
          }),
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

          // A button (either hand): jump / ascend per locomotion mode -
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
              // toggle visibility. Canvas-textured radial - slices and slice
              // labels are drawn with Canvas2D, so they render correctly in
              // pure immersive WebXR. The previous approach tried to use
              // SpatialPanelManager + React portal + SVG <RadialContextMenu>;
              // SVG is invisible through HTMLMesh's html2canvas path, the
              // menu came out blank. Plus _buildHTMLMesh reparents the XR
              // controllers under the moving panel - now anchored to scene.
              setVrRadialRightOpen((prev) => {
                const next = !prev;
                const ctr = se.vrInput?.getController('right');
                if (next) {
                  if (vrRadialMenuRightRef.current === null) {
                    vrRadialMenuRightRef.current = new VRRadialMenuMesh(
                      buildVrRadialCallbacks('right'),
                      buildVrRadialInitialState('right')
                    );
                    se.scene.add(vrRadialMenuRightRef.current.group);
                  }
                  if (ctr) {
                    ctr.updateWorldMatrix(true, false);
                    const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);
                    const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);
                    const laserDir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
                    vrRadialMenuRightRef.current.placeNearController(origin, laserDir);
                  }
                  const rightHolding = heldSideRef.current === 'right' || (isHeldRef.current && heldSideRef.current === null);
                  vrRadialMenuRightRef.current.setState({
                    locomotionMode: locomotionModeRef.current,
                    scalingEnabled: scalingEnabledRef.current,
                    laserEnabled: laserEnabledRef.current,
                    grabMode: grabModeRef.current,
                    isHeld: rightHolding,
                    heldAssetType: rightHolding ? heldAssetTypeRef.current : null,
                  });
                  vrRadialMenuRightRef.current.setActiveTab(
                    rightHolding ? 'held' : 'general'
                  );
                  vrRadialMenuRightRef.current.setVisible(true);
                } else {
                  vrRadialMenuRightRef.current?.setVisible(false);
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
              setVrRadialLeftOpen((prev) => {
                const next = !prev;
                const ctrLeft = se.vrInput?.getController('left');
                if (next) {
                  if (vrRadialMenuLeftRef.current === null) {
                    vrRadialMenuLeftRef.current = new VRRadialMenuMesh(
                      buildVrRadialCallbacks('left'),
                      buildVrRadialInitialState('left')
                    );
                    se.scene.add(vrRadialMenuLeftRef.current.group);
                  }
                  if (ctrLeft) {
                    ctrLeft.updateWorldMatrix(true, false);
                    const origin = new THREE.Vector3().setFromMatrixPosition(ctrLeft.matrixWorld);
                    const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctrLeft.matrixWorld);
                    const laserDir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
                    vrRadialMenuLeftRef.current.placeNearController(origin, laserDir);
                  }
                  const leftHolding = heldSideRef.current === 'left' || (isHeldRef.current && heldSideRef.current === null);
                  vrRadialMenuLeftRef.current.setState({
                    locomotionMode: locomotionModeRef.current,
                    scalingEnabled: scalingEnabledRef.current,
                    laserEnabled: laserEnabledRef.current,
                    grabMode: grabModeRef.current,
                    isHeld: leftHolding,
                    heldAssetType: leftHolding ? heldAssetTypeRef.current : null,
                  });
                  vrRadialMenuLeftRef.current.setActiveTab(
                    leftHolding ? 'held' : 'general'
                  );
                  vrRadialMenuLeftRef.current.setVisible(true);
                } else {
                  vrRadialMenuLeftRef.current?.setVisible(false);
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
          // dash - see FIX 1 above. Same toggle pattern as the desktop
          // Tab key handler.
          if (button === 'x') {
            // In VR, open the real React DashMenu inside a SpatialPopUpWrapper
            // so it looks identical to the desktop dash menu.
            if (se.renderer.xr.isPresenting) {
              setShowDashMenu((prev) => !prev);
            } else {
              inventoryServiceRef.current.getItems().then((items) => {
                vrHudRef.current?.setItems(items);
                vrHudRef.current?.toggle();
              });
            }
            return;
          }
          // Grip buttons. Left grip opens the VR dash menu (curved HUD);
          // right grip grabs the asset under the right controller's aim.
          if (button === 'grip') {
            // Per VRControls.txt: BOTH grips grab. The dash is opened
            // by the X button (left controller) further down. Shared
            // raycast+grab helper used by both left and right grips
            // - keeps HUD-priority + parent-chain walk logic single-
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
              // Spatial panel grabbing: add all active HTMLMesh instances to the
              // raycast targets so the user can grab the dash menu, inspector, and
              // any other spatial panel by its visible HTMLMesh surface. Build a
              // fast lookup map: HTMLMesh -> { panelId, group } for the parent-walk
              // below so we don't loop panels on every hit resolution.
              const spm = se.spatialPanelManager;
              const htmlMeshToPanel = new Map<THREE.Object3D, { panelId: string; group: THREE.Group }>();
              if (spm) {
                const allMeshes = spm.getAllHTMLMeshes();
                allMeshes.forEach((m) => {
                  targets.push(m);
                  const info = spm.getPanelInfoForObject(m);
                  if (info) htmlMeshToPanel.set(m, info);
                });
              }
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
              // Spatial panel grab: walk up from the hit object to find if it
              // belongs to a spatial panel's HTMLMesh (or a child thereof).  When
              // detected, directly parent the panel's GROUP to the controller grip
              // — bypassing ManipulationManager's full grab state machine which
              // carries rotation-lock / dolly / two-handed-scale semantics that
              // don't apply to UI panels.
              // Uses `grip.attach()` (not `add()`) so the panel's world transform
              // is preserved when reparenting — same as VRHUDManager's attachToGrip.
              // Without this, the panel jumps to the grip's origin on grab.
              let spCur: THREE.Object3D | null = hits[0].object;
              while (spCur) {
                const panelInfo = htmlMeshToPanel.get(spCur);
                if (panelInfo) {
                  spatialPanelGripRef.current = {
                    side: grabSide,
                    panelId: panelInfo.panelId,
                    group: panelInfo.group,
                    originalParent: panelInfo.group.parent,
                  };
                  grip.attach(panelInfo.group);
                  return true;
                }
                spCur = spCur.parent;
              }
              let cur: THREE.Object3D | null = hits[0].object;
              while (cur && !objToAsset.has(cur)) cur = cur.parent;
              if (cur) {
                const found = objToAsset.get(cur);
                if (found) {
                  // Grabbable component gate — objects without an enabled
                  // Grabbable component cannot be grabbed in VR.
                  if (!isGrabbable(found.object3d)) {
                    console.log(`[VR Grab] Blocked: ${found.name} has no enabled Grabbable component`);
                    return false;
                  }
                  mm.vrGrabWithController(found, grip, grabSide, ctr);
                  return true;
                }
              } else {
                const otherSide = grabSide === 'left' ? 'right' : 'left';
                const otherAsset = mm.getHandGrabAsset(otherSide);
                if (otherAsset) {
                  const gripPos = new THREE.Vector3().setFromMatrixPosition(grip.matrixWorld);
                  const assetPos = new THREE.Vector3();
                  otherAsset.object3d.getWorldPosition(assetPos);
                  if (gripPos.distanceTo(assetPos) < 0.75) {
                    mm.vrGrabWithController(otherAsset, grip, grabSide, ctr);
                    return true;
                  }
                }
              }
              return false;
            };
            if (side === 'left' || side === 'right') {
              tryVrGrab(side);
              return;
            }
          }
          // Trigger - handles VR radial menu select (both sides),
          // two-handed scale grab detection, and HUD click (right side).
          if (button === 'trigger') {
            if (side === 'left' || side === 'right') {
              if (mm && mm.getHandGrabAsset(side)) {
                if (mm.handleVRTriggerPress(side)) {
                  return;
                }
              }
            }
            // PRIORITY 1: VR radial menu select.
            // This MUST happen in onPressed (the XR-frame-synchronous
            // edge callback) rather than in the aim rAF loop.
            // Reason: VRInputManager.update() sets pressedThisFrame for
            // exactly ONE XR frame. The aim rAF loop is a SEPARATE
            // requestAnimationFrame that runs independently of the XR
            // frame loop - by the time the rAF tick executes, the XR
            // loop has already advanced and cleared pressedThisFrame on
            // its next frame, so the trigger press is always missed.
            // Handling it here - which fires synchronously inside the
            // same XR frame that detected the edge - guarantees the
            // select() call is never dropped.
            const leftMesh = vrRadialMenuLeftRef.current;
            const rightMesh = vrRadialMenuRightRef.current;
            if ((leftMesh && leftMesh.isVisible && !leftMesh.disposed) ||
                (rightMesh && rightMesh.isVisible && !rightMesh.disposed)) {
              // PRIORITY 1 must re-aim BEFORE select().
              const se1 = sceneEngineRef.current;
              if (se1?.vrInput) {
                const ctr1 = se1.vrInput.getController(side);
                if (ctr1) {
                  ctr1.updateWorldMatrix(true, false);
                  vrRadialAimOriginRef.current.setFromMatrixPosition(ctr1.matrixWorld);
                  vrRadialAimDirQuatRef.current.setFromRotationMatrix(ctr1.matrixWorld);
                  vrRadialAimDirRef.current
                    .set(0, 0, -1)
                    .applyQuaternion(vrRadialAimDirQuatRef.current)
                    .normalize();
                  vrRadialAimRayRef.current.set(
                    vrRadialAimOriginRef.current,
                    vrRadialAimDirRef.current
                  );
                  if (leftMesh && leftMesh.isVisible && !leftMesh.disposed && leftMesh.updateAim(vrRadialAimRayRef.current)) {
                    leftMesh.select();
                    return;
                  }
                  if (rightMesh && rightMesh.isVisible && !rightMesh.disposed && rightMesh.updateAim(vrRadialAimRayRef.current)) {
                    rightMesh.select();
                    return;
                  }
                }
              }
            }

            // PRIORITY 2: Two-handed scale grab.
            // If the trigger on the OTHER hand is also currently held,
            // the user is attempting a two-handed scale grab.
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
                  // Scalability gate — objects with Grabbable.scalable=false
                  // cannot be two-hand scaled.
                  if (!isScalable(hitThis.object3d)) {
                    console.log(`[VR Two-Hand Scale] Blocked: ${hitThis.name} has Grabbable.scalable=false`);
                    return;
                  }
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
            // PRIORITY 3: HUD click (right hand).
            if (side === 'right') {
              const hud = vrHudRef.current;
              if (hud && (hud.isVisible || hud.activePanel)) {
                const uv = currentVrHudUvRef.current;
                if (uv) {
                  hud.handleRayIntersection(uv);
                  return;
                }
              }
            }
            // PRIORITY 3.5: Spatial UI Panel (HTMLMesh) click in VR (Video controls, dialogs).
            // Direct raycast against active HTMLMesh panels so trigger clicks reliably
            // dispatch DOM mousedown / mouseup / click events to React buttons & sliders.
            const uiCtrl = se.vrInput?.getController(side);
            if (uiCtrl && se.spatialPanelManager) {
              const panelMeshes = se.spatialPanelManager.getAllHTMLMeshes();
              if (panelMeshes.length > 0) {
                uiCtrl.updateWorldMatrix(true, false);
                const origin = new THREE.Vector3().setFromMatrixPosition(uiCtrl.matrixWorld);
                const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(
                  new THREE.Quaternion().setFromRotationMatrix(uiCtrl.matrixWorld)
                ).normalize();
                se.raycaster.set(origin, dir);
                const hits = se.raycaster.intersectObjects(panelMeshes, true);
                if (hits.length > 0 && hits[0].uv) {
                  se.spatialPanelManager.dispatchDOMClickAtUV(hits[0].object, hits[0].uv);
                  return;
                }
              }
            }
            // PRIORITY 4: Click / select 3D asset or video in VR scene.
            // Walks the raycast hit's parent chain to recover the original
            // LoadedAsset via AssetManager's id->asset Map (mirrors the
            // grip-handler's `objToAsset` lookup pattern). The previous
            // iteration called `am.getAssetByObject3D(top)` which does not
            // exist on AssetManager - every VR trigger pulled on an asset
            // would throw a TypeError mid-handler, abort the rest of PRIORITY
            // 4, and leave React's selection state undefined.
            // `amPrio4` so this `const` doesn't shadow the outer `am` and re-trigger TS2448/TS2454 at the Priority 2 two-handed-scale read ~1474 (sibling branches in the same `if (button === 'trigger')`).
            const amPrio4 = assetManagerRef.current;
            const assetCtrl = side === 'right' ? se.vrInput.getController('right') : se.vrInput.getController('left');
            if (amPrio4 && assetCtrl) {
              const origin = new THREE.Vector3();
              const direction = new THREE.Vector3(0, 0, -1);
              assetCtrl.getWorldPosition(origin);
              direction.transformDirection(assetCtrl.matrixWorld).normalize();
              se.raycaster.set(origin, direction);
              const assetMeshes: THREE.Object3D[] = [];
              const objToAsset = new Map<THREE.Object3D, LoadedAsset>();
              amPrio4.assets.forEach((a) => {
                assetMeshes.push(a.object3d);
                objToAsset.set(a.object3d, a);
              });
              const hits = se.raycaster.intersectObjects(assetMeshes, true);
              if (hits.length > 0) {
                // If pointing at a spatial UI panel (HTMLMesh), let InteractiveGroup handle the button click.
                // Do not toggle the video UI menu or clear selection.
                let isHittingUI = false;
                let curr: THREE.Object3D | null = hits[0].object;
                while (curr) {
                  if (
                    curr.constructor?.name === 'HTMLMesh' ||
                    curr.type === 'HTMLMesh' ||
                    (curr as any).isHTMLMesh ||
                    curr.constructor?.name === 'InteractiveGroup'
                  ) {
                    isHittingUI = true;
                    break;
                  }
                  curr = curr.parent;
                }
                if (isHittingUI) {
                  return;
                }

                let top: THREE.Object3D | null = hits[0].object;
                while (top && !objToAsset.has(top)) top = top.parent;
                const hitAsset = top ? objToAsset.get(top) ?? null : null;
                if (hitAsset) {
                  if (hitAsset.type === 'video') {
                    setActiveVideoAssetId((prev) => prev === hitAsset.id ? null : hitAsset.id);
                  }
                  return;
                }
                // Hitting non-asset environment geometry (floor, walls) clears selection & closes video overlay
                manipulationManagerRef.current?.selectAsset(null);
                setActiveVideoAssetId(null);
                return;
              }
              // Pulling trigger in empty space clears any lingering selection & closes video overlay
              manipulationManagerRef.current?.selectAsset(null);
              setActiveVideoAssetId(null);
            }
          }
        },
        onReleased: (button, side) => {
          const mm = manipulationManagerRef.current;
          const se = sceneEngineRef.current;
          if (!mm) return;
          if (mm.isTwoHandedGrabbing) {
            mm.endTwoHandedGrab();
            return;
          }
          // Distinguish sides so a brief left-grip tap doesn't drop a
          // right-grip-held object. vrReleaseControllerGrab itself
          // no-ops when not mid-grab (`_isVRGrabbing === false`), so
          // double-routing both sides would be safe; doing it
          // side-aware also avoids spurious log lines in unknown grab
          // states.
          if (button === 'grip' && (side === 'left' || side === 'right')) {
            mm.vrReleaseControllerGrab(side);
            const hud = vrHudRef.current;
            if (hud && hud.currentGrip) hud.detach();
            if (hud && hud.panelCurrentGrip) hud.detachPanel();
            // Release spatial panel grab: restore the panel group to the scene
            // at its current world position so it stays where the user left it.
            const spGrip = spatialPanelGripRef.current;
            if (spGrip && spGrip.side === side) {
              const grip = se?.vrInput?.getGrip(side);
              if (grip && spGrip.group.parent === grip) {
                // Capture world pose before un-parenting so the panel stays
                // exactly where the user released it.
                const wp = new THREE.Vector3();
                const wq = new THREE.Quaternion();
                spGrip.group.getWorldPosition(wp);
                spGrip.group.getWorldQuaternion(wq);
                grip.remove(spGrip.group);
                if (spGrip.originalParent) {
                  spGrip.originalParent.add(spGrip.group);
                } else {
                  se?.scene?.add(spGrip.group);
                }
                spGrip.group.position.copy(wp);
                spGrip.group.quaternion.copy(wq);
              }
              spatialPanelGripRef.current = null;
            }
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
    // Resume the WebAudio context on the first user gesture; browsers
    // suspend it until a user interaction, which would silence peer voice.
    const resumeAudioContext = () => {
      avatarManager.audioListener.context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resumeAudioContext, { once: true });
    disposers.push(() => window.removeEventListener('pointerdown', resumeAudioContext));

    // Keep React `isVRPresenting` in sync with the WebXR session so the
    // DashMenu rendering can switch between desktop overlay and 3D spatial
    // panel without needing a state-toggle to re-read the ref.
    const onXRSessionStart = () => setIsVRPresenting(true);
    const onXRSessionEnd = () => setIsVRPresenting(false);
    sceneEngine.renderer.xr.addEventListener('sessionstart', onXRSessionStart);
    sceneEngine.renderer.xr.addEventListener('sessionend', onXRSessionEnd);
    // Catch the case where the page is reloaded while already in an active
    // XR session — sessionstart won't fire again, so seed state from the
    // renderer's live flag.
    if (sceneEngine.renderer.xr.isPresenting) setIsVRPresenting(true);
    disposers.push(() => {
      sceneEngine.renderer.xr.removeEventListener('sessionstart', onXRSessionStart);
      sceneEngine.renderer.xr.removeEventListener('sessionend', onXRSessionEnd);
    });

    // Connect selection events
    disposers.push(manipulationManager.registerOnSelectionChange((asset) => {
      setSelectedAsset(asset);
      if (asset?.type === 'video') {
        setActiveVideoAssetId(asset.id);
        resetVideoInactivityTimer();
      }
    }));

    // Preserve the misc-file auto-inspect convenience that USED TO ride
    // on `selectAsset` from inside `beginGrab` - but routed here through
    // a dedicated grab-only listener so RMB-grab no longer mirrors the
    // dev tool's secondary action (R) in the gizmo-flash + selection-
    // chip UI. RMB still opens the misc preview; LMB/R-toggle selection
    // continues to do the same, but without the brief selection state-
    // flip in between.
    disposers.push(manipulationManager.registerOnGrabBegin((asset, side) => {
      if (side === 'left' || side === 'right') {
        heldAssetsBySideRef.current[side] = asset ?? null;
      } else {
        heldAssetsBySideRef.current.left = asset ?? null;
        heldAssetsBySideRef.current.right = asset ?? null;
      }
      isHeldRef.current = heldAssetsBySideRef.current.left !== null || heldAssetsBySideRef.current.right !== null;
      heldAssetTypeRef.current = asset?.type ?? null;
      heldSideRef.current = side ?? null;
      setIsHeld(isHeldRef.current);
      setHeldAssetType(asset?.type ?? null);
      setHeldAssetCustomItems(asset?.contextMenuItems);
      const updateHoldingMenu = (mesh: VRRadialMenuMesh | null, heldAsset: LoadedAsset | null) => {
        if (!mesh || !heldAsset) return;
        mesh.setState({
          isHeld: true,
          heldAssetType: heldAsset.type ? String(heldAsset.type) : null,
          heldAssetCustomItems: heldAsset.contextMenuItems,
        });
        mesh.setActiveTab('held');
      };
      if (side === 'left') {
        updateHoldingMenu(vrRadialMenuLeftRef.current, asset ?? null);
      } else if (side === 'right') {
        updateHoldingMenu(vrRadialMenuRightRef.current, asset ?? null);
      } else {
        updateHoldingMenu(vrRadialMenuLeftRef.current, asset ?? null);
        updateHoldingMenu(vrRadialMenuRightRef.current, asset ?? null);
      }
    }));
    disposers.push(manipulationManager.registerOnGrabEnd((side) => {
      if (side === 'left' || side === 'right') {
        heldAssetsBySideRef.current[side] = null;
      } else {
        heldAssetsBySideRef.current.left = null;
        heldAssetsBySideRef.current.right = null;
      }
      const anyHeld = heldAssetsBySideRef.current.left !== null || heldAssetsBySideRef.current.right !== null;
      isHeldRef.current = anyHeld;
      if (!anyHeld) {
        heldAssetTypeRef.current = null;
        heldSideRef.current = null;
        setIsHeld(false);
        setHeldAssetType(null);
        setHeldAssetCustomItems(undefined);
      }
      const updateReleasedMenu = (mesh: VRRadialMenuMesh | null) => {
        if (!mesh) return;
        mesh.setState({ isHeld: false, heldAssetType: null, heldAssetCustomItems: undefined });
        if (mesh.activeTab === 'held') {
          mesh.setActiveTab('general');
        }
      };
      if (side === 'left') {
        updateReleasedMenu(vrRadialMenuLeftRef.current);
      } else if (side === 'right') {
        updateReleasedMenu(vrRadialMenuRightRef.current);
      } else {
        updateReleasedMenu(vrRadialMenuLeftRef.current);
        updateReleasedMenu(vrRadialMenuRightRef.current);
      }
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
    const { captureSnapshot, applyTransformSnapshot } = createUndoRedoHandlers({
      undoRedoManagerRef,
      assetManagerRef,
      networkServiceRef,
      manipulationManagerRef,
      setSelectedAsset,
    });

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
      // asset has landed. Idempotent - any non-placeholder registration
      // is a no-op.
      const placeholder = pendingAssetsRef.current.get(asset.id);
      if (placeholder) {
        sceneEngine.worldRoot.remove(placeholder.group);
        placeholder.dispose();
        pendingAssetsRef.current.delete(asset.id);
      }
      if (net.mode !== 'offline') {
        if (streamingSuppressedAssetIdsRef.current.has(asset.id)) {
          streamingSuppressedAssetIdsRef.current.delete(asset.id);
          return;
        }
        // The `primitiveType` tag is sourced from `asset.object3d.userData`
        // - `AssetManager.spawnPrimitive` sets it there in the same edit
        // cycle so this distributed-spawn path has it. Without this, the
        // receiver's `if (data.type === 'primitive' && data.primitiveType)`
        // branch never fires and the asset is silently dropped on every
        // joining guest (the host's default cube + torus pre-broadcast
        // bug). File/url-spawned assets don't carry primitiveType so the
        // field is `undefined` for those - still safe, since the receiver
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
          // persisting state from the first frame - without it, the
          // inspector checkbox defaults to true regardless of send.
          isPersistent: (asset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
          materialState: (asset.object3d.userData as Record<string, unknown>)?.materialState as MaterialUpdate | undefined,
          videoAspectRatio: (asset.object3d.userData as Record<string, unknown>)?.videoAspectRatio as '16:9' | '9:16' | '1:1' | 'auto' | undefined,
          // Ride the compact video-state snapshot on the echo spawn too —
          // a peer that receives a video via THIS re-broadcast (instead of
          // the original importer's spawn) otherwise loses the sender's
          // flip orientation and renders the video upside down.
          videoState: asset.type === 'video' ? (() => {
            const vs = asset.object3d.userData?.videoState as Record<string, unknown> | undefined;
            return vs ? {
              playing: Boolean(vs.playing),
              currentTime: typeof vs.currentTime === 'number' ? vs.currentTime : 0,
              globalVolume: typeof vs.globalVolume === 'number' ? vs.globalVolume : 0.8,
              flipped: vs.flipped !== false,
            } : undefined;
          })() : undefined,
          grabbable: (asset.object3d.userData as Record<string, unknown>)?.grabbable as Record<string, unknown> | undefined,
          collider: (asset.object3d.userData as Record<string, unknown>)?.collider as Record<string, unknown> | undefined,
          importAsRawFile: Boolean(asset.object3d.userData?.isRaw || asset.type === 'misc'),
        };
        net.broadcastSpawn(spawnData);
      }

      // Auto-open the inspector when a freshly-imported video lands.

      // Rebuild collision registry so new assets with colliders are detected
      sceneEngine.rebuildCollisionRegistry();
    }));

    // Network listeners & remote state synchronization
    disposers.push(
      ...registerNetworkEventHandlers({
        net,
        sceneEngine,
        assetManager,
        manipulationManager,
        avatarManager,
        avatarManagerRef,
        videoStreamingServiceRef,
        vrHudRef,
        pendingAssetsRef,
        streamingSuppressedAssetIdsRef,
        pendingVideoStateRef,
        selectedAssetRef,
        showChatPanelRef,
        setPeerCount,
        setIsHost,
        setSelectedAsset,
        setUnreadChatCount,
        setChatMessages,
        setLocalRole,
        setMode,
        setRoomId,
      })
    );

    disposers.push(manipulationManager.registerOnScaleSelf((factor) => {
      sceneEngine.camera.position.y = Math.max(0.4, sceneEngine.camera.position.y * factor);
      sceneEngine.controls.target.y = Math.max(0.2, sceneEngine.controls.target.y * factor);
      sceneEngine.controls.update();
    }));

    inventoryServiceRef.current.getItems().then((items) => setInventoryItems(items));

    // Animation Loop sync
    let lastBroadcast = 0;
    let lastCenterRay = 0;
    // Post-render: sync the Web Audio listener with the final camera/HMD
    // pose AFTER renderer.render() has applied the WebXR camera matrix.
    // This is the authoritative spatial-audio sync; the per-frame update
    // callback above is a fallback for non-VR/desktop mode.
    const unbindPostRender = sceneEngine.registerPostRenderCallback(() => {
      avatarManager.updateAudioListener();
    });

    const unbindLoop = sceneEngine.registerUpdateCallback((_delta, elapsed) => {
      manipulationManager.update(_delta);
      assetManager.update(_delta, elapsed);

      const transform = avatarManager.getLocalTransform(
        sceneEngine.camera,
        sceneEngine.controller1,
        sceneEngine.controller2,
        false,
        net.isCompanion,
        sceneEngine.userScale
      );
      transform.locomotion = {
        moveSpeed: sceneEngine.getMoveSpeed(),
        moveDirection: sceneEngine.getMoveDirection(),
        isCrouching: sceneEngine.isCrouched(),
        isGrounded: sceneEngine.getGrounded(),
        verticalVelocity: sceneEngine.getVerticalVelocity(),
        yawVelocity: sceneEngine.yawVelocity,
        locomotionMode: sceneEngine.locomotionMode,
      };

      avatarManager.update(_delta, transform);

      // Pulse in-flight import placeholders so they read as "loading"
      // at a glance. Cheap: a few sin / multiplies per pending place,
      // and the empty-Map fast path short-circuits the loop entirely.
      const pendingMap = pendingAssetsRef.current;
      if (pendingMap.size > 0) {
        for (const [, entry] of pendingMap) {
          // Oversized ("Too Large") placeholders are static failure
          // indicators - pulsing them would suggest they're still
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

      // Broadcast avatar every ~33ms (approx 30 FPS network sync)
      if (elapsed - lastBroadcast > 0.033 && net.mode !== 'offline') {
        lastBroadcast = elapsed;
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

      // Check if click hits a spatial panel (crosshair center if locked, mouse coords if unlocked)
      const spm = sceneEngine.spatialPanelManager;
      const isPointerLocked = document.pointerLockElement !== null;
      if (spm) {
        const clickX = isPointerLocked ? window.innerWidth / 2 : e.clientX;
        const clickY = isPointerLocked ? window.innerHeight / 2 : e.clientY;
        spm.updateLockedHover(clickX, clickY);
        if (spm.isOverPanel) {
          spm.handleLockedClick(clickX, clickY);
          return;
        }
      }

      const rect = sceneEngine.renderer.domElement.getBoundingClientRect();
      const isLockedCanvas = document.pointerLockElement === sceneEngine.renderer.domElement || cameraModeRef.current === 'first-person';
      const ndc = isLockedCanvas ? new THREE.Vector2(0, 0) : new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      sceneEngine.raycaster.setFromCamera(ndc, sceneEngine.camera);

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
          const found = objToAsset.get(cur);
          if (found && found.type === 'video') {
            setActiveVideoAssetId((prev) => (prev === found.id ? null : found.id));
            resetVideoInactivityTimer();
          }
        }
      }
    };
    // Per Controls-Keybinds.txt: Right Mouse Button = Grab (NOT context
    // menu). The ManipulationManager pointerdown handler captures RMB
    // and either initiates a grab or no-ops. The contextmenu event still
    // fires here on right-mouse-down - we preventDefault to suppress the
    // browser's native menu but no longer auto-open the radial menu on
    // RMB (that override was the bug the user reported - it shadowed the
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
          const isPointerLocked = document.pointerLockElement !== null;
          if (isPointerLocked || cameraModeRef.current === 'first-person') {
            setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          } else {
            setRadialMenuPos({ x: e.clientX, y: e.clientY });
          }
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
    // Scroll wheel: when Ctrl is held, self-scale the player up/down.
    // When locked/crosshair + pointing at a panel, scroll the panel directly.
    const onCanvasWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY < 0 ? 1.05 : 0.95;
        const newScale = Math.min(5.0, Math.max(0.2, sceneEngine.userScale * factor));
        sceneEngine.setUserScale(newScale);
        return;
      }
      const spm = sceneEngine.spatialPanelManager;
      const isLocked = document.pointerLockElement !== null || cameraModeRef.current === 'first-person';
      if (isLocked && spm) {
        spm.updateLockedHover(window.innerWidth / 2, window.innerHeight / 2);
        if (spm.isOverPanel && spm.handleLockedScroll(e.deltaY)) {
          e.preventDefault();
          e.stopPropagation();
        }
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

    // Check URL parameters for auto-joining room
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');

    if (roomParam) {
      handleJoinRoom(roomParam, 'online', false);
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
      unbindPostRender();
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

  // Companion Device Import Tunnel Listener
  useEffect(() => {
    const tunnel = CompanionTunnelService.getInstance();
    tunnel.startHost().then((code) => {
      setCompanionPairCode(code);
    }).catch((err) => console.warn('[App] Tunnel host start error:', err));

    const unbindStatus = tunnel.onStatusChange((st, dev) => {
      setCompanionStatus(st);
      setCompanionPairCode(tunnel.pairCode);
      setCompanionDevice(dev || null);
    });

    const unbindFile = tunnel.onFileReceived((file: File) => {
      setImportInitialFile(file);
      setShowImportDialog(true);
      toast.success(`Received "${file.name}" from companion device!`);
    });

    const unbindUrl = tunnel.onUrlReceived((url: string) => {
      setImportInitialUrl(url);
      setShowImportDialog(true);
      toast.success('Received link from companion device!');
    });

    return () => {
      unbindStatus();
      unbindFile();
      unbindUrl();
    };
  }, []);

  // Push fresh PanelContext to VRHUDManager whenever any state underlying
  // the active panel changes. setDataContext triggers a redraw ONLY if
  // activePanel !== null - no cost when no panel is showing. Runs after
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
        name: userName || net?.localUserName || 'You',
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
        gridColor: 'cyan', ambientIntensity: 1.2, dirLightIntensity: 1.5,
        locomotion: { allowedLocomotions: ['walk', 'flight', 'noclip'], scalingEnabled: true },
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
      // Companion tunnel state for VR HUD display
      companionInfo: {
        status: companionStatus,
        pairCode: companionPairCode,
        deviceName: companionDevice?.name,
      },
    });
  }, [
    inventoryItems,
    mode, roomId, peerCount,
    selectedAsset,
    companionStatus,
    companionPairCode,
    companionDevice,
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
    userName,
    localRole,
    chatMessages,
  ]);

  // One-time mount-load of inventory items so the VR inventory
  // panel (sys-inventory) has data even when the user never opens
  // the desktop dash or inventory modal. Without this the panel
  // shows "No items yet" in pure-VR sessions. The follow-up
  // useEffect below keeps the data fresh on desktop-modal opens.
  const refreshInventoryData = useCallback(() => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    inv.getItems().then((items) => {
      inventoryItemsRef.current = items.slice();
      setInventoryItems(items);
    }).catch(() => {});
    inv.getFolders().then((folders) => {
      setInventoryFolders(folders);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    refreshInventoryData();
  }, [refreshInventoryData]);

  useEffect(() => {
    refreshInventoryData();
  }, [showDashMenu, showInventoryModal, refreshInventoryData]);

  const handleDeleteInventoryItem = useCallback(async (id: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    await inv.removeItem(id);
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleRenameInventoryItem = useCallback(async (id: string, newName: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv || !newName.trim()) return;
    await inv.renameItem(id, newName.trim());
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleCreateInventoryFolder = useCallback(async (folderName: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv || !folderName.trim()) return;
    await inv.createFolder(folderName.trim());
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleMoveInventoryItem = useCallback(async (id: string, folder?: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    await inv.moveItemToFolder(id, folder);
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleRenameInventoryFolder = useCallback(async (oldName: string, newName: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv || !newName.trim()) return;
    await inv.renameFolder(oldName, newName.trim());
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleDeleteInventoryFolder = useCallback(async (folderName: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    await inv.deleteFolder(folderName);
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleMoveInventoryFolder = useCallback(async (folderName: string, targetParent?: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    await inv.moveFolder(folderName, targetParent);
    refreshInventoryData();
  }, [refreshInventoryData]);


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
    // selection change - we deliberately do not mirror it here to
    // avoid a double setState that would still settle to the same
    // value but cost an extra render.
    if (mm.selectedAsset?.id === found.id) {
      mm.selectAsset(null);
    } else {
      mm.selectAsset(found);
    }
    if (found.type === 'video') {
      setActiveVideoAssetId(found.id);
      resetVideoInactivityTimer();
    }
  }, []);

  // Global Drag-and-Drop and Paste (Ctrl+V) Listeners (extracted to useFileDropPaste hook)
  useFileDropPaste({
    plainPasteModeRef,
    setImportInitialFile,
    setImportInitialUrl,
    setShowImportDialog,
  });

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
      : `${window.location.pathname}?room=${targetRoomId}`;
    window.history.replaceState({}, '', newUrl);

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });
  }, []);

  const handleDisconnect = useCallback(() => {
    // Dispose any pending placeholders - the network is going away
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
  const getHeldAssetForSide = useCallback((side?: 'left' | 'right'): LoadedAsset | null => {
    const mm = manipulationManagerRef.current;
    if (side === 'left' && heldAssetsBySideRef.current.left) return heldAssetsBySideRef.current.left;
    if (side === 'right' && heldAssetsBySideRef.current.right) return heldAssetsBySideRef.current.right;
    return mm?.grabbedAsset ?? heldAssetsBySideRef.current.right ?? heldAssetsBySideRef.current.left ?? (mm as any)?._twoHandedAsset ?? null;
  }, []);

  const handleSaveHeldToInventory = useCallback((side?: 'left' | 'right') => {
    const held = getHeldAssetForSide(side);
    if (!held) return;
    const asset = held;
    const item: InventoryItem = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      createdAt: Date.now(),
      fileData: asset.fileData,
      url: asset.url,
      primitiveType: (asset.object3d.userData as Record<string, unknown>)?.primitiveType as any,
      materialState: (asset.object3d.userData as Record<string, unknown>)?.materialState as MaterialUpdate | undefined,
      metadata:
        asset.metadata ||
        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),
    };
    inventoryServiceRef.current.saveItem(item).then(() => {
      console.log('[Inventory] Saved held "' + asset.name + '" to inventory');
    });
  }, [getHeldAssetForSide]);

  const handleDownloadHeld = useCallback((side?: 'left' | 'right') => {
    const am = assetManagerRef.current;
    if (!am) return;
    const held = getHeldAssetForSide(side);
    if (!held) return;
    am.downloadAsset(held);
  }, [getHeldAssetForSide]);

  // ─── Undo / Redo & Snapshot Handlers (extracted to undoRedoHandlers) ───
  const {
    recordSpawnUndo,
    respawnFromSnapshot,
  } = createUndoRedoHandlers({
    undoRedoManagerRef,
    assetManagerRef,
    networkServiceRef,
    manipulationManagerRef,
    setSelectedAsset,
  });

  const handleDuplicateHeld = useCallback(async (side?: 'left' | 'right') => {
    const held = getHeldAssetForSide(side);
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
    // maintains each frame for visible meshes - held assets ARE
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
      const matState = (asset.object3d.userData as Record<string, unknown>)?.materialState as any;
      if (matState) {
        AssetManager.applyMaterialUpdate(newAsset, matState);
        const mats = Array.isArray(matState)
          ? matState
          : typeof matState === 'object' && !('materialIndex' in matState) && !('color' in matState) && !('map' in matState) && !('roughness' in matState) && !('metalness' in matState) && !('emissive' in matState)
          ? Object.values(matState)
          : [matState];
        mats.forEach((m: any) => {
          networkServiceRef.current.broadcastMaterialUpdate({ ...m, assetId: newAsset.id });
        });
      }
      recordSpawnUndo(newAsset);

      const origVs = (asset.object3d.userData as Record<string, unknown>)?.videoState as any;
      const hostedFile = networkServiceRef.current.getHostedFile(newAsset.id);
      const isVideo = newAsset.type === 'video';
      const fileSize = hostedFile instanceof File || hostedFile instanceof Blob
        ? hostedFile.size
        : hostedFile instanceof ArrayBuffer
        ? hostedFile.byteLength
        : (asset.object3d.userData as any)?.fileSize;

      networkServiceRef.current.broadcastSpawn({
        id: newAsset.id,
        name: newAsset.name,
        type: newAsset.type as AssetSpawnData['type'],
        primitiveType: primType,
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
        isPersistent: (asset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
        materialState: (asset.object3d.userData as Record<string, unknown>)?.materialState as any,
        videoAspectRatio: (asset.object3d.userData as Record<string, unknown>)?.videoAspectRatio as any,
        subtitlesData: asset.subtitlesData || origVs?.subtitlesData,
        subtitlesEnabled: origVs?.subtitlesEnabled,
        videoState: isVideo ? {
          playing: Boolean(origVs?.playing),
          currentTime: typeof origVs?.currentTime === 'number' ? origVs.currentTime : (asset.videoElement?.currentTime || 0),
          globalVolume: typeof origVs?.globalVolume === 'number' ? origVs.globalVolume : 0.8,
          flipped: origVs?.flipped !== false,
        } : undefined,
        fileSize,
        importerPeerId: networkServiceRef.current.localPeerId,
      });
    };

    if (asset.type === 'primitive' && primType) {
      const newId = `prim-${primType}-${Date.now()}`;
      streamingSuppressedAssetIdsRef.current.add(newId);
      const newAsset = am.spawnPrimitive(primType, pos, newId);
      afterImport(newAsset);
      return;
    }

    if (asset.type === 'video') {
      const net = networkServiceRef.current;
      const vss = videoStreamingServiceRef?.current;
      let hosted = net?.getHostedFile(asset.id);
      if (!hosted && (asset.url?.startsWith('blob:') || asset.videoElement?.src?.startsWith('blob:'))) {
        try {
          const res = await fetch(asset.url || asset.videoElement!.src);
          if (res.ok) {
            hosted = await res.blob();
          }
        } catch {
          /* ignore */
        }
      }
      const videoSource = hosted instanceof ArrayBuffer ? new Blob([hosted]) : hosted || asset.url || asset.videoElement?.src;
      if (videoSource) {
        const newId = `video-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        streamingSuppressedAssetIdsRef.current.add(newId);
        if (hosted) {
          net?.registerHostedFile(newId, hosted);
          if (vss && (hosted instanceof File || hosted instanceof Blob)) {
            vss.registerHostFile(hosted, newId, (hosted as any).type || 'video/mp4');
          }
        }
        const origVs = (asset.object3d.userData as Record<string, unknown>)?.videoState as any;
        const config: Partial<ImportConfig> = {
          videoAspectRatio: (asset.object3d.userData as Record<string, unknown>)?.videoAspectRatio as any || 'auto',
          subtitleText: asset.subtitlesData || origVs?.subtitlesData,
          videoSyncMode: asset.metadata?.videoSyncMode || origVs?.syncMode || 'persistent',
        };
        const newAsset = await am.spawnVideo(videoSource, asset.name, pos, config, newId);
        if (newAsset) {
          if (origVs) {
            am.applyVideoState(newAsset.id, {
              flipped: origVs.flipped,
              currentTime: origVs.currentTime,
              playing: origVs.playing,
              globalVolume: origVs.globalVolume,
              subtitlesEnabled: origVs.subtitlesEnabled,
            });
          }
          afterImport(newAsset);
        }
        return;
      }
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

  const handleDestroyHeld = useCallback((side?: 'left' | 'right') => {
    const mm = manipulationManagerRef.current;
    const held = getHeldAssetForSide(side) ?? selectedAssetRef.current;
    if (!held) return;
    const asset = held;
    const obj = asset.object3d;
    if (side === 'left' || side === 'right') {
      mm?.vrReleaseControllerGrab(side);
    } else {
      mm?.endGrab();
    }
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

  /**
   * Single funnel for video control intents; wraps the local apply
   * call and the network broadcast so the React UI doesn't need to
   * know which fields are shared vs local-only.
   *   - play / pause / seek / step  -> broadcast (everyone syncs)
   *   - volume                      -> broadcast ONLY in 'global' mode
   *   - volumeMode / mute           -> local-only UI preference
   */
  // Throttle map: assetId -> last seek broadcast timestamp (ms).
  // Scrubbing fires ~60Hz pointermove broadcasts otherwise. A 50 ms
  // ceiling allows 20 seeks/sec which is perceptually continuous, and
  // is well under any reasonable WebRTC bandwidth budget for a single
  // `<number>` envelope. Other peers receive continuous throttled seeks
  // and an unconditional final seek on `pointerup` (forced-flushed via
  // flushVideoSeekThrottle below at the call sites that need it).
  const videoSeekThrottleRef = useRef<Map<string, number>>(new Map());
  const SEEK_THROTTLE_MS = 50;

  const broadcastVideoSeek = (assetId: string, playing: boolean, currentTime: number, globalVolume: number): void => {
    const net = networkServiceRef.current;
    if (!net) return;
    const now = Date.now();
    const last = videoSeekThrottleRef.current.get(assetId) ?? 0;
    if (now - last < SEEK_THROTTLE_MS) return;
    videoSeekThrottleRef.current.set(assetId, now);
    net.broadcastVideoState({ assetId, playing, currentTime, globalVolume });
  };

  // Plain arrows (not useCallback) so the dep array never needs to
  // reference any sibling identifier declared later in the function
  // body. The closure body only executes on call, so even though
  // handleDeleteSelected is declared textually AFTER these arrows
  // below, every user-driven invoke happens AFTER the React render
  // has finished so handleDeleteSelected is well-defined.
  // VideoControls isn't React.memo'd, so handler-identity churn
  // between renders doesn't cause regression.
  const handleVideoAction = (assetId: string, kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute' | 'syncMode' | 'subtitlesToggle', payload?: number | 'global' | 'local' | 'persistent' | 'watch-party') => {
    const am = assetManagerRef.current;
    const net = networkServiceRef.current;
    if (!am) return;
    const state = am.getVideoState(assetId);
    if (!state) return;
    // Clamp helper: bound `s` into [0, max(0, duration - 0.05)]. Mirrors
    // applyVideoState's internal clamp so the broadcast value matches
    // what the local engine will land on after apply. Without this,
    // step/skip spam clicks would emit wildly-OOB values onto the wire
    // for receivers that haven't yet finished importing the file.
    const clampSeek = (s: number): number => {
      const dur = state.duration || 0;
      return Math.max(0, Math.min(Math.max(0, dur - 0.05), s));
    };
    switch (kind) {
      case 'subtitlesToggle':
        {
          const currentEnabled = state.subtitlesEnabled !== false;
          const nextEnabled = !currentEnabled;
          am.applyVideoState(assetId, { subtitlesEnabled: nextEnabled });
          net?.broadcastVideoState({
            assetId,
            playing: state.playing,
            currentTime: state.currentTime,
            globalVolume: state.globalVolume,
            subtitlesEnabled: nextEnabled,
            subtitlesData: state.subtitlesData
          });
        }
        break;
      case 'syncMode':
        if (payload === 'persistent' || payload === 'watch-party') {
          am.applyVideoState(assetId, { syncMode: payload });
          const asset = am.getAsset(assetId);
          if (asset && asset.metadata) asset.metadata.videoSyncMode = payload;
          if (payload === 'watch-party' && asset && asset.videoElement && net) {
            for (const peerId of net.peers) {
              videoStreamingServiceRef.current.startLiveStreamToPeer(assetId, asset.videoElement, peerId);
            }
          }
          net?.notifySystemChat(`Video "${asset?.name || assetId}" switched to ${payload === 'watch-party' ? 'Watch Party Stream (Live WebRTC)' : 'Persistent Chunk Stream'} mode.`);
        }
        break;
      case 'play':
        am.applyVideoState(assetId, { playing: true });
        net?.broadcastVideoState({ assetId, playing: true, currentTime: state.currentTime, globalVolume: state.globalVolume });
        break;
      case 'pause':
        am.applyVideoState(assetId, { playing: false });
        net?.broadcastVideoState({ assetId, playing: false, currentTime: state.currentTime, globalVolume: state.globalVolume });
        break;
      case 'seek':
        if (typeof payload === 'number') {
          const clamped = clampSeek(payload);
          am.applyVideoState(assetId, { currentTime: clamped });
          broadcastVideoSeek(assetId, state.playing, clamped, state.globalVolume);
        }
        break;
      case 'step':
        if (typeof payload === 'number') {
          const next = clampSeek(state.currentTime + payload);
          am.applyVideoState(assetId, { currentTime: next });
          // Step buttons are discrete (1 click = 1 broadcast) so we
          // bypass the throttle and send unconditionally. The cltampSeek
          // call above means the wire value is always within bounds.
          net?.broadcastVideoState({ assetId, playing: state.playing, currentTime: next, globalVolume: state.globalVolume });
        }
        break;
      case 'volume':
        if (typeof payload === 'number') {
          if (state.volumeMode === 'global') {
            am.applyVideoState(assetId, { globalVolume: payload, muted: false });
            net?.broadcastVideoState({ assetId, playing: state.playing, currentTime: state.currentTime, globalVolume: payload });
          } else {
            am.applyVideoState(assetId, { localVolume: payload, muted: false });
          }
        }
        break;
      case 'volumeMode':
        if (payload === 'global' || payload === 'local') {
          am.applyVideoState(assetId, { volumeMode: payload });
        }
        break;
      case 'mute':
        am.applyVideoState(assetId, { muted: !state.muted });
        break;
    }
    // Reset the throttle on play/pause so the NEXT scrub starts fresh,
    // but DO NOT re-broadcast here -- the play/pause arm already
    // emitted a broadcast with the full payload. Sending a second
    // identical envelope just doubles wire traffic for no benefit.
    // (Original implementation also flushed, which was a duplicate.)
    if (kind === 'pause' || kind === 'play') {
      videoSeekThrottleRef.current.set(assetId, Date.now());
    }
    const sel = selectedAssetRef.current;
    if (sel && sel.id === assetId) setSelectedAsset({ ...sel });
    vrHudRef.current?.redrawPanel();
  };

  /**
   * Close = remove from world. Reuses the deletion pipeline so
   * broadcast + undo/redo + selection-clear fire consistently across
   * VR and desktop close paths.
   */
  const handleVideoClose = (assetId: string): void => {
    if (selectedAssetRef.current?.id === assetId) {
      handleDeleteSelected();
      return;
    }
    const am = assetManagerRef.current;
    if (!am) return;
    am.removeAsset(assetId);
    networkServiceRef.current?.broadcastRemove(assetId);
  };

  const handleAudioAction = (assetId: string, kind: 'play' | 'pause' | 'stop' | 'seek' | 'volume' | 'volumeMode' | 'mute' | 'loop' | 'speed', payload?: number | 'global' | 'local') => {
    const am = assetManagerRef.current;
    const net = networkServiceRef.current;
    if (!am) return;
    const state = am.getAudioState(assetId);
    if (!state) return;

    switch (kind) {
      case 'play':
        am.applyAudioState(assetId, { playing: true });
        net?.broadcastAudioState({ assetId, playing: true, currentTime: state.currentTime, globalVolume: state.globalVolume });
        break;
      case 'pause':
      case 'stop':
        am.applyAudioState(assetId, { playing: false });
        net?.broadcastAudioState({ assetId, playing: false, currentTime: state.currentTime, globalVolume: state.globalVolume });
        break;
      case 'seek':
        if (typeof payload === 'number') {
          const clamped = Math.max(0, Math.min(Math.max(0, state.duration - 0.05), payload));
          am.applyAudioState(assetId, { currentTime: clamped });
          net?.broadcastAudioState({ assetId, playing: state.playing, currentTime: clamped, globalVolume: state.globalVolume });
        }
        break;
      case 'volume':
        if (typeof payload === 'number') {
          if (state.volumeMode === 'global') {
            am.applyAudioState(assetId, { globalVolume: payload, muted: false });
            net?.broadcastAudioState({ assetId, playing: state.playing, currentTime: state.currentTime, globalVolume: payload });
          } else {
            am.applyAudioState(assetId, { localVolume: payload, muted: false });
          }
        }
        break;
      case 'volumeMode':
        if (payload === 'global' || payload === 'local') {
          am.applyAudioState(assetId, { volumeMode: payload });
        }
        break;
      case 'mute':
        am.applyAudioState(assetId, { muted: !state.muted });
        break;
      case 'loop':
        {
          const nextLoop = !state.loop;
          am.applyAudioState(assetId, { loop: nextLoop });
          net?.broadcastAudioState({ assetId, playing: state.playing, currentTime: state.currentTime, loop: nextLoop });
        }
        break;
      case 'speed':
        if (typeof payload === 'number') {
          const clamped = Math.max(0.5, Math.min(2.0, Math.round(payload * 10) / 10));
          am.applyAudioState(assetId, { playbackRate: clamped });
          net?.broadcastAudioState({ assetId, playing: state.playing, currentTime: state.currentTime, playbackRate: clamped });
        }
        break;
    }
    const sel = selectedAssetRef.current;
    if (sel && sel.id === assetId) setSelectedAsset({ ...sel });
    vrHudRef.current?.redrawPanel();
  };

  const handleAudioClose = (assetId: string): void => {
    if (selectedAssetRef.current?.id === assetId) {
      handleDeleteSelected();
      return;
    }
    const am = assetManagerRef.current;
    if (!am) return;
    am.removeAsset(assetId);
    networkServiceRef.current?.broadcastRemove(assetId);
  };

    const handleDeleteSelected = (targetAsset?: LoadedAsset) => {
    const asset = targetAsset || selectedAsset;
    if (!asset) return;
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
    // Close any inspector instances pinned to the deleted asset
    setInspectorInstances(prev => prev.filter(i => i.pinnedAsset?.id !== asset.id));
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
    const allowed = envSettings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip'];
    const finalMode = allowed.includes(mode) ? mode : (allowed[0] ?? 'walk');
    setLocomotionMode(finalMode);
    if (sceneEngineRef.current) {
      sceneEngineRef.current.locomotionMode = finalMode;
    }
  };

  // Build the callback table for VRRadialMenuMesh. Reading from state-mirror
  // refs (grabModeRef, isHeldRef, heldAssetTypeRef, etc.) so a slice click
  // 5 seconds after the menu opened still sees fresh state. The mesh stores
  // this object once at construction; the closures stay valid for the lifetime
  // of the mesh. Functional setters are stable in React so re-creating this
  // on every render would be wasteful - build once at mount via useCallback.
  const [lightNoShadows, setLightNoShadows] = useState<boolean>(false);
  const lightNoShadowsRef = useRef<boolean>(false);
  useEffect(() => { lightNoShadowsRef.current = lightNoShadows; }, [lightNoShadows]);

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => (prev === 'single' ? 'multi' : 'single'));
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedAsset(null);
    manipulationManagerRef.current?.selectAsset(null);
  }, []);

  const handleToggleWireframe = useCallback(() => {
    if (selectedAsset) {
      let isWire = false;
      selectedAsset.object3d.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
          const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          m.wireframe = !m.wireframe;
          m.needsUpdate = true;
          isWire = m.wireframe;
        }
      });
      networkServiceRef.current.broadcastMaterialUpdate({
        assetId: selectedAsset.id,
        wireframe: isWire,
      });
    }
  }, [selectedAsset]);

  const handleSampleMaterial = useCallback(() => {
    if (selectedAsset) {
      selectedAsset.object3d.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
          const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (m.color) {
            console.log(`[Material] Sampled color #${m.color.getHexString()}`);
          }
        }
      });
    }
  }, [selectedAsset]);

  const handleApplyMaterialColor = useCallback((color: string) => {
    if (selectedAsset) {
      selectedAsset.object3d.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
          const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          m.color.set(color);
          m.needsUpdate = true;
        }
      });
      networkServiceRef.current.broadcastMaterialUpdate({
        assetId: selectedAsset.id,
        color,
      });
    }
  }, [selectedAsset]);

  const handleToggleDrawing = useCallback(() => {
    if (brushManagerRef.current) {
      const drawing = !brushManagerRef.current.isActive;
      brushManagerRef.current.isActive = drawing;
      if (drawing) {
        brushManagerRef.current.startStroke('#ff007f', 0.05);
      }
    }
  }, []);

  const handleClearStrokes = useCallback(() => {
    brushManagerRef.current?.clearAll();
  }, []);

  const handleChangeBrushColor = useCallback((c: string) => {
    if (brushManagerRef.current) brushManagerRef.current.currentColor = c;
  }, []);

  const handleSpawnPrimitiveRef = useRef<((type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane') => void) | null>(null);

  // ─── Asset import / spawn handlers (extracted to assetImportHandlers) ───
  const {
    handleSpawnPrimitive,
    handleImportFile,
    handleImportAssetFromConfig,
    handleSpawnFromInventory,
    handleEquipVrmFromInventory,
    spawnLightGizmo,
  } = createAssetImportHandlers({
    sceneEngineRef,
    assetManagerRef,
    manipulationManagerRef,
    avatarManagerRef,
    networkServiceRef,
    videoStreamingServiceRef,
    inventoryServiceRef,
    pendingAssetsRef,
    streamingSuppressedAssetIdsRef,
    setActiveVideoAssetId,
    setActiveTool,
    setShowInventoryModal,
    setShowDashMenu,
    resetVideoInactivityTimer,
    recordSpawnUndo,
    localRole,
    lightNoShadowsRef,
  });
  useEffect(() => { handleSpawnPrimitiveRef.current = handleSpawnPrimitive; });

  const closeVrRadial = useCallback((menuSide?: 'left' | 'right') => {
    if (!menuSide || menuSide === 'left') {
      vrRadialMenuLeftRef.current?.setVisible(false);
      setVrRadialLeftOpen(false);
    }
    if (!menuSide || menuSide === 'right') {
      vrRadialMenuRightRef.current?.setVisible(false);
      setVrRadialRightOpen(false);
    }
  }, []);
  const buildVrRadialCallbacks = useCallback((menuSide: 'left' | 'right'): VRRadialMenuCallbacks => ({
    onUndo: () => { undoRedoManagerRef.current?.undo(); closeVrRadial(menuSide); },
    onRedo: () => { undoRedoManagerRef.current?.redo(); closeVrRadial(menuSide); },
    onToggleScaling: () => setScalingEnabled((v) => !v),
    onToggleLaser: () => setLaserEnabled((v) => !v),
    onNextLocomotion: () => {
      const cur = locomotionModeRef.current;
      const allowed = envSettings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip'];
      const idx = allowed.indexOf(cur);
      const next = allowed[(idx + 1) % allowed.length] ?? 'walk';
      handleSetLocomotionMode(next);
    },
    onNextGrabMode: () => {
      const cur = grabModeRef.current;
      setGrabMode(cur === 'auto' ? 'precision' : cur === 'precision' ? 'palm' : cur === 'palm' ? 'laser' : 'auto');
    },
    onDestroy: () => handleDestroyHeld(menuSide),
    onDuplicate: () => handleDuplicateHeld(menuSide),
    onSaveHeld: () => handleSaveHeldToInventory(menuSide),
    onDownloadHeld: () => { handleDownloadHeld?.(menuSide); },
    onToggleMute: () => handleToggleMute(),
    onClose: () => closeVrRadial(menuSide),
    onNextTab: () => {
      const mesh = menuSide === 'left' ? vrRadialMenuLeftRef.current : vrRadialMenuRightRef.current;
      if (!mesh) return;
      const cur = mesh.activeTab;
      const sideIsHolding = heldAssetsBySideRef.current[menuSide] !== null || heldSideRef.current === menuSide || (isHeldRef.current && heldSideRef.current === null);
      const next: 'general' | 'grab' | 'held' | 'light' = sideIsHolding
        ? (cur === 'general' ? 'grab' : cur === 'grab' ? 'held' : 'general')
        : (cur === 'general' ? 'grab' : 'general');
      mesh.setActiveTab(next);
    },
    onSpawnPointLight: () => { spawnLightGizmo('point', '#f59e0b', 2, 25); closeVrRadial(menuSide); },
    onSpawnSpotLight: () => { spawnLightGizmo('spot', '#00f0ff', 2, 25); closeVrRadial(menuSide); },
    onSpawnSunLight: () => { spawnLightGizmo('sun', '#ffffff', 2, 25); closeVrRadial(menuSide); },
    onToggleNoShadows: () => setLightNoShadows((prev) => !prev),
    onChangeLightColor: () => {},
    onUnequipTool: () => {
      setActiveTool(null);
      closeVrRadial(menuSide);
    },
    onOpenInspector: () => { openInspectorForAsset(selectedAsset); closeVrRadial(menuSide); },
    onToggleSelectionMode: () => { handleToggleSelectionMode(); },
    onDeselectAll: () => { handleDeselectAll(); closeVrRadial(menuSide); },
    onSetGizmoMode: (mode: 'translate' | 'rotate' | 'scale') => { manipulationManagerRef.current?.setMode(mode); closeVrRadial(menuSide); },
    onToggleGizmoSpace: () => {
      const cur = manipulationManagerRef.current?.getSpace() || 'local';
      manipulationManagerRef.current?.setSpace(cur === 'local' ? 'world' : 'local');
    },
    onSpawnPrimitive: (type) => { handleSpawnPrimitiveRef.current?.(type); closeVrRadial(menuSide); },
    onSetLocomotionMode: (mode) => { handleSetLocomotionMode(mode); },
    onToggleWireframe: handleToggleWireframe,
    onSampleMaterial: handleSampleMaterial,
    onApplyMaterialColor: handleApplyMaterialColor,
    onToggleDrawing: handleToggleDrawing,
    onClearStrokes: handleClearStrokes,
    brushColor: '#ff007f',
    onChangeBrushColor: handleChangeBrushColor,
  }), [closeVrRadial, handleDestroyHeld, handleDuplicateHeld, handleSaveHeldToInventory, handleDownloadHeld, handleToggleMute, spawnLightGizmo, handleToggleSelectionMode, handleDeselectAll, handleSetLocomotionMode, handleToggleWireframe, handleSampleMaterial, handleApplyMaterialColor, handleToggleDrawing, handleClearStrokes, handleChangeBrushColor]);
  const buildVrRadialInitialState = useCallback((menuSide: 'left' | 'right'): VRRadialMenuState => {
    const sideHeldAsset = heldAssetsBySideRef.current[menuSide];
    const sideIsHolding = sideHeldAsset !== null || heldSideRef.current === menuSide || (isHeldRef.current && heldSideRef.current === null);
    return {
      locomotionMode: locomotionModeRef.current,
      scalingEnabled: scalingEnabledRef.current,
      laserEnabled: laserEnabledRef.current,
      grabMode: grabModeRef.current,
      isHeld: sideIsHolding,
      isMuted: networkServiceRef.current.isMuted,
      heldAssetType: sideHeldAsset?.type ? String(sideHeldAsset.type) : sideIsHolding ? heldAssetTypeRef.current : null,
      activeTab: activeToolRef.current === 'light' ? 'light' : activeToolRef.current === 'dev' ? 'dev' : activeToolRef.current === 'material' ? 'material' : activeToolRef.current === 'shape' ? 'shape' : activeToolRef.current === 'brush' ? 'brush' : sideIsHolding ? 'held' : 'general',
      activeTool: activeToolRef.current,
      noShadows: lightNoShadowsRef.current,
      selectionMode: selectionModeRef.current,
      gizmoMode: manipulationManagerRef.current?.getMode() || 'translate',
      gizmoSpace: manipulationManagerRef.current?.getSpace() || 'local',
      allowedLocomotions: envSettings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip'],
    };
  }, [envSettings.locomotion?.allowedLocomotions]);

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
      if (sceneEngineRef.current) {
        const targetAvatar = avatarManagerRef.current?.peers.get(targetPeerId);
        const worldPos = new THREE.Vector3(0, 1.6, 0);
        if (targetAvatar) {
          const headObj = targetAvatar.headMesh || targetAvatar.vrm?.scene || targetAvatar.group;
          headObj.getWorldPosition(worldPos);
        }
        sceneEngineRef.current.camera.position.set(worldPos.x, worldPos.y, worldPos.z + 1.8);
        sceneEngineRef.current.controls.target.set(worldPos.x, worldPos.y, worldPos.z);
        sceneEngineRef.current.controls.update();
      }
      return;
    }
    if (action === 'respawn') {
      if (targetPeerId === net.localPeerId) {
        sceneEngineRef.current?.respawn();
      } else {
        net.broadcastModeration('respawn', targetPeerId);
      }
      return;
    }
    net.broadcastModeration(action, targetPeerId);
    setPeerCount((prev) => prev);
  };

  // Self-respawn: teleport the local player back to the spawn point.
  const handleRespawnSelf = useCallback(() => {
    sceneEngineRef.current?.respawn();
  }, []);

  // ===========================================================================
  // Keyboard shortcuts (extracted to useKeyboardShortcuts hook)
  // ===========================================================================
  useKeyboardShortcuts({
    selectedAsset,
    cameraMode,
    activeTool,
    setShowDashMenu,
    setShowChatPanel,
    setUnreadChatCount,
    setActiveTool,
    setRadialMenuPos,
    setShowRadialMenu,
    setShowInventoryModal,
    setImportInitialFile,
    setShowImportDialog,
    setInventoryItems,
    sceneEngineRef,
    inventoryServiceRef,
    vrHudRef,
    undoRedoManagerRef,
    assetManagerRef,
    manipulationManagerRef,
    networkServiceRef,
    videoStreamingServiceRef,
    streamingSuppressedAssetIdsRef,
    plainPasteModeRef,
    onSetMode: handleSetMode,
    onFocusSelected: handleFocusSelected,
    onDeleteSelected: handleDeleteSelected,
    onCenterRaySelect: handleCenterRaySelect,
    onOpenInspector: openInspectorForAsset,
    onRecordSpawnUndo: recordSpawnUndo,
    onRefreshUI: handleRefreshUI,
  });

  const handleUpdateUserName = (name: string) => {
    networkServiceRef.current.setLocalUserName(name);
    setUserName(networkServiceRef.current.localUserName);
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
    <div className="w-screen h-screen relative bg-[#07090e] select-none overflow-hidden">
      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 z-0 w-full h-full" />

      {/* Center Crosshair Overlay */}
      <CrosshairOverlay
        showRadialMenu={showRadialMenu}
        isCrosshairOverPanel={isCrosshairOverPanel}
        cameraMode={cameraMode}
        centerRayHitAssetId={centerRayHitAssetId}
        activeTool={activeTool}
      />

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
        companionConnected={companionStatus === 'connected'}
        companionDeviceName={companionDevice?.name}
      />

      {/* First-Person HUD stack - a single flex column anchors the
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

          {/* Tool Equipped chip - visible while the dev tool is the
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

          {/* Selection chip - when an asset is selected while in
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
           the O hint even when they're not in first-person - the
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
        onOpenTools={() => setActiveTool((prev) => (prev === 'dev' ? null : 'dev'))}
        onOpenInspector={() => openInspectorForAsset(selectedAsset)}
        onOpenRadialMenu={() => {
          setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          setShowRadialMenu(true);
        }}
        activeTool={activeTool}
        transformSpace={transformSpace}
        onToggleSpace={handleToggleSpace}
      />

      {/* Resonite Spatial Scene Inspector Windows (multi-instance, each pinned to its asset) */}
      {inspectorInstances.map(instance => {
        const asset = instance.pinnedAsset;
        return (
          <SceneInspectorWindow
            key={instance.id}
            isOpen={true}
            onClose={() => closeInspectorInstance(instance.id)}
            instanceId={instance.id}
            selectedAsset={asset}
            onSelectAsset={(a) => {
              // Update this instance's pinned asset and also sync
              // global selection so the gizmo follows.
              setInspectorInstances(prev => prev.map(i =>
                i.id === instance.id ? { ...i, pinnedAsset: a } : i
              ));
              setSelectedAsset(a);
            }}
            onUpdateAsset={(updated) => {
              // Update this instance's reference without changing
              // the global selection — the inspector is pinned.
              setInspectorInstances(prev => prev.map(i =>
                i.id === instance.id ? { ...i, pinnedAsset: updated } : i
              ));
              networkServiceRef.current.broadcastAssetUpdate(updated);
            }}
            onBroadcastMaterial={(update) => {
              networkServiceRef.current.broadcastMaterialUpdate(update);
            }}
            onBroadcastInspectorUpdate={(update: InspectorUpdateData) => {
              networkServiceRef.current.broadcastInspectorUpdate(update);
            }}
            onBroadcastAssetUpdate={(asset) => {
              networkServiceRef.current.broadcastAssetUpdate(asset);
            }}
            worldRoot={sceneEngineRef.current?.worldRoot ?? null}
            onDeleteAsset={() => handleDeleteSelected(asset ?? undefined)}
            onJumpToAsset={(jumpAsset) => {
              if (sceneEngineRef.current) {
                sceneEngineRef.current.camera.position.set(
                  jumpAsset.object3d.position.x,
                  jumpAsset.object3d.position.y + 0.5,
                  jumpAsset.object3d.position.z + 2.5
                );
                sceneEngineRef.current.controls.target.copy(jumpAsset.object3d.position);
                sceneEngineRef.current.controls.update();
              }
            }}
            onBringAsset={(bringAsset) => {
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
                bringAsset.object3d.position.copy(newPos);
                setInspectorInstances(prev => prev.map(i =>
                  i.id === instance.id ? { ...i, pinnedAsset: { ...bringAsset } } : i
                ));
                networkServiceRef.current.broadcastAssetUpdate(bringAsset);
              }
            }}
            scene={sceneEngineRef.current?.scene}
            camera={sceneEngineRef.current?.camera}
            assetManager={assetManagerRef.current || undefined}
            spatialPanelManager={sceneEngineRef.current?.spatialPanelManager}
            videoActions={(asset && asset.type === 'video') ? {
              onPlay: () => handleVideoAction(asset.id, 'play'),
              onPause: () => handleVideoAction(asset.id, 'pause'),
              onSeek: (t) => handleVideoAction(asset.id, 'seek', t),
              onStep: (d) => handleVideoAction(asset.id, 'step', d),
              onVolumeChange: (v) => handleVideoAction(asset.id, 'volume', v),
              onVolumeModeToggle: (m) => handleVideoAction(asset.id, 'volumeMode', m),
              onMuteToggle: () => handleVideoAction(asset.id, 'mute'),
              onSubtitlesToggle: () => handleVideoAction(asset.id, 'subtitlesToggle'),
              onAddSubtitles: async (file: File) => {
                try {
                  const text = await file.text();
                  const am = assetManagerRef.current;
                  const net = networkServiceRef.current;
                  if (am) {
                    am.applyVideoState(asset.id, {
                      subtitlesData: text,
                      subtitlesEnabled: true,
                    });
                    const state = am.getVideoState(asset.id);
                    net?.broadcastVideoState({
                      assetId: asset.id,
                      playing: state?.playing ?? false,
                      currentTime: state?.currentTime ?? 0,
                      globalVolume: state?.globalVolume ?? 0.8,
                      subtitlesData: text,
                      subtitlesEnabled: true,
                    });
                  }
                } catch (err) {
                  console.warn('[VideoControls] Failed to read subtitle file:', err);
                }
              },
              onClose: () => handleVideoClose(asset.id)
            } : null}
            onRebuildCollisionRegistry={() => sceneEngineRef.current?.rebuildCollisionRegistry()}
            locomotionPermissions={envSettings.locomotion}
            onUpdateLocomotionPermissions={(perms) => {
              setEnvSettings(prev => ({ ...prev, locomotion: perms }));
            }}
          />
        );
      })}

      {/* In-World / In-Object Video Playback Controls Popup */}
      <VideoControlsPopup
        activeVideoAssetId={activeVideoAssetId}
        assetManager={assetManagerRef.current}
        scene={sceneEngineRef.current?.scene}
        camera={sceneEngineRef.current?.camera}
        spatialPanelManager={sceneEngineRef.current?.spatialPanelManager}
        networkService={networkServiceRef.current}
        manipulationManager={manipulationManagerRef.current}
        onClose={() => setActiveVideoAssetId(null)}
        resetVideoInactivityTimer={resetVideoInactivityTimer}
        handleVideoAction={handleVideoAction}
        setSelectedAsset={setSelectedAsset}
      />

      {/* Top-Level Overlays & Modals Host */}
      <ModalsHost
        showChatPanel={showChatPanel}
        setShowChatPanel={setShowChatPanel}
        setUnreadChatCount={setUnreadChatCount}
        networkService={networkServiceRef.current}
        showShareModal={showShareModal}
        setShowShareModal={setShowShareModal}
        mode={mode}
        roomId={roomId}
        shareModalTab={shareModalTab}
        handleJoinRoom={handleJoinRoom}
        handleDisconnect={handleDisconnect}
        showInventoryModal={showInventoryModal}
        setShowInventoryModal={setShowInventoryModal}
        inventoryService={inventoryServiceRef.current}
        handleSpawnFromInventory={handleSpawnFromInventory}
        handleEquipVrmFromInventory={handleEquipVrmFromInventory}
        showImportModal={showImportModal}
        setShowImportModal={setShowImportModal}
        handleImportFile={handleImportFile}
        showImportDialog={showImportDialog}
        setShowImportDialog={setShowImportDialog}
        importInitialFile={importInitialFile}
        setImportInitialFile={setImportInitialFile}
        importInitialUrl={importInitialUrl}
        setImportInitialUrl={setImportInitialUrl}
        uiRefreshKey={uiRefreshKey}
        handleImportAssetFromConfig={handleImportAssetFromConfig}
        sceneEngine={sceneEngineRef.current}
        assetManager={assetManagerRef.current}
        showWorldEnvModal={showWorldEnvModal}
        setShowWorldEnvModal={setShowWorldEnvModal}
        envSettings={envSettings}
        handleUpdateEnvSettings={handleUpdateEnvSettings}
        showSettingsModal={showSettingsModal}
        setShowSettingsModal={setShowSettingsModal}
        graphicsSettings={graphicsSettings}
        stats={stats}
        userName={userName}
        handleUpdateUserName={handleUpdateUserName}
        handleUpdateGraphicsSettings={handleUpdateGraphicsSettings}
      />

      {/* Misc File Inspection Modal */}
      {/* Tabbed Dash Menu Modal — rendered as a 3D spatial panel in VR, full-viewport overlay on desktop */}
      {isVRPresenting && sceneEngineRef.current?.spatialPanelManager ? (
        <SpatialPopUpWrapper
          key="dash-menu-spatial"
          isOpen={showDashMenu}
          onClose={() => setShowDashMenu(false)}
          title="NexusVR Dash"
          scene={sceneEngineRef.current.scene}
          camera={sceneEngineRef.current.camera}
          spatialPanelManager={sceneEngineRef.current.spatialPanelManager}
          assetManager={assetManagerRef.current ?? undefined}
          panelId="dash-menu"
          defaultWidth={900}
          defaultHeight={800}
          frameless={true}
          initialPinned={true}
        >
          <DashMenu
            isOpen={showDashMenu}
            onClose={() => setShowDashMenu(false)}
            variant="spatial"
            userName={userName}
            onUpdateUserName={handleUpdateUserName}
            networkService={networkServiceRef.current}
            localRole={localRole}
            onUpdateRole={handleUpdateRole}            onModerateUser={handleModerateUser}
            onRespawnSelf={handleRespawnSelf}
            defaultConfig={defaultPermissionsConfig}
            onUpdateDefaultConfig={setDefaultPermissionsConfig}
            inventoryItems={inventoryItems}
            inventoryFolders={inventoryFolders}
            onSpawnItem={handleSpawnFromInventory}
            onEquipVrm={handleEquipVrmFromInventory}
            onDeleteInventoryItem={handleDeleteInventoryItem}
            onRenameInventoryItem={handleRenameInventoryItem}
            onCreateInventoryFolder={handleCreateInventoryFolder}
            onMoveInventoryItem={handleMoveInventoryItem}
            onRenameInventoryFolder={handleRenameInventoryFolder}
            onDeleteInventoryFolder={handleDeleteInventoryFolder}
            onMoveInventoryFolder={handleMoveInventoryFolder}
            onOpenFullSettings={() => { setShowDashMenu(false); setShowSettingsModal(true); }}
            graphicsSettings={graphicsSettings}
            performanceStats={stats}
            onUpdateGraphicsSettings={handleUpdateGraphicsSettings}
            audioDevices={audioDevices}
            selectedAudioDeviceId={selectedAudioDeviceId}
            onSelectAudioDevice={handleSelectAudioDevice}
            isMuted={networkServiceRef.current.isMuted}
            onToggleMute={handleToggleMute}
            subtitleSettings={subtitleSettings}
            onUpdateSubtitleSettings={handleUpdateSubtitleSettings}
            sceneEngine={sceneEngineRef.current}
          />
        </SpatialPopUpWrapper>
      ) : (
        <DashMenu
          isOpen={showDashMenu}
          onClose={() => setShowDashMenu(false)}
          userName={userName}
          onUpdateUserName={handleUpdateUserName}
          networkService={networkServiceRef.current}
          localRole={localRole}
          onUpdateRole={handleUpdateRole}
          onModerateUser={handleModerateUser}
          onRespawnSelf={handleRespawnSelf}
          defaultConfig={defaultPermissionsConfig}
          onUpdateDefaultConfig={setDefaultPermissionsConfig}
          inventoryItems={inventoryItems}
          inventoryFolders={inventoryFolders}
          onSpawnItem={handleSpawnFromInventory}
          onEquipVrm={handleEquipVrmFromInventory}
          onDeleteInventoryItem={handleDeleteInventoryItem}
          onRenameInventoryItem={handleRenameInventoryItem}
          onCreateInventoryFolder={handleCreateInventoryFolder}
          onMoveInventoryItem={handleMoveInventoryItem}
          onRenameInventoryFolder={handleRenameInventoryFolder}
          onDeleteInventoryFolder={handleDeleteInventoryFolder}
          onMoveInventoryFolder={handleMoveInventoryFolder}
          onOpenFullSettings={() => { setShowDashMenu(false); setShowSettingsModal(true); }}
          graphicsSettings={graphicsSettings}
          performanceStats={stats}
          onUpdateGraphicsSettings={handleUpdateGraphicsSettings}
          audioDevices={audioDevices}
          selectedAudioDeviceId={selectedAudioDeviceId}
          onSelectAudioDevice={handleSelectAudioDevice}
          isMuted={networkServiceRef.current.isMuted}
          onToggleMute={handleToggleMute}
          subtitleSettings={subtitleSettings}
          onUpdateSubtitleSettings={handleUpdateSubtitleSettings}
          sceneEngine={sceneEngineRef.current}
        />
      )}

      {/* Radial Context Menu (Pie Menu) - desktop 2D overlay */}
      <RadialContextMenu
        isOpen={showRadialMenu}
        position={radialMenuPos}
        onClose={() => setShowRadialMenu(false)}
        locomotionMode={locomotionMode}
        allowedLocomotions={envSettings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip']}
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
        heldAssetCustomItems={heldAssetCustomItems}
        onDestroy={handleDestroyHeld}
        onDuplicate={handleDuplicateHeld}
        onSaveHeld={handleSaveHeldToInventory}
        onDownloadHeld={handleDownloadHeld}
        isMuted={networkServiceRef.current.isMuted}
        onToggleMute={handleToggleMute}
        activeTool={activeTool}
        onSpawnPointLight={() => spawnLightGizmo('point', '#ffffff', 2.0, 15)}
        onSpawnSpotLight={() => spawnLightGizmo('spot', '#ffffff', 2.0, 15)}
        onSpawnSunLight={() => spawnLightGizmo('sun', '#ffffff', 2.0, 15)}
        noShadows={graphicsSettings.shadowQuality === 'off'}
        onToggleNoShadows={() => handleUpdateGraphicsSettings({ ...graphicsSettings, shadowQuality: graphicsSettings.shadowQuality === 'off' ? 'high' : 'off' })}
        onUnequipTool={() => setActiveTool(null)}
        selectionMode={selectionMode}
        onToggleSelectionMode={handleToggleSelectionMode}
        onDeselectAll={handleDeselectAll}
        onOpenInspector={() => openInspectorForAsset(selectedAsset)}
        gizmoMode={manipulationManagerRef.current?.getMode() || 'translate'}
        onSetGizmoMode={(mode) => manipulationManagerRef.current?.setMode(mode)}
        gizmoSpace={manipulationManagerRef.current?.getSpace() || 'local'}
        onToggleGizmoSpace={() => {
          const cur = manipulationManagerRef.current?.getSpace() || 'local';
          manipulationManagerRef.current?.setSpace(cur === 'local' ? 'world' : 'local');
        }}
        onSpawnPrimitive={handleSpawnPrimitive}
        collisionEnabled={sceneEngineRef.current?.collisionManager?.enabled ?? true}
        onToggleCollision={() => {
          const se = sceneEngineRef.current;
          if (!se) return;
          se.collisionManager.enabled = !se.collisionManager.enabled;
        }}
        onToggleWireframe={handleToggleWireframe}
        onSampleMaterial={handleSampleMaterial}
        onApplyMaterialColor={handleApplyMaterialColor}
        onToggleDrawing={handleToggleDrawing}
        onClearStrokes={handleClearStrokes}
        brushColor="#ff007f"
        onChangeBrushColor={handleChangeBrushColor}
      />

      {/* Global toast notifications (import results, errors, etc.) */}
      <ToastHost />

      {/* Network stats debug overlay (Ctrl+Shift+D to toggle) */}
      <NetworkStatsOverlay
        visible={showNetworkStats}
        onToggle={() => setShowNetworkStats(v => !v)}
        peerCount={peerCount}
        isHost={isHost}
      />

   </div>
  );
};

export const App: React.FC = () => {
  const [isCompanionPortal, setIsCompanionPortal] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const p = new URLSearchParams(window.location.search);
    return !!(p.get('bridge') || p.get('companion') || p.get('pair') || p.get('mode') === 'companion');
  });
  const [companionInitialCode] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const p = new URLSearchParams(window.location.search);
    return p.get('bridge') || p.get('companion') || p.get('pair') || '';
  });

  if (isCompanionPortal) {
    return (
      <CompanionPortal
        initialCode={companionInitialCode}
        onExitCompanionMode={() => {
          setIsCompanionPortal(false);
          window.history.replaceState({}, '', window.location.pathname);
        }}
      />
    );
  }

  return <NexusVRMain />;
};