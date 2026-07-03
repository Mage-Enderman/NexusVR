import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import confetti from 'canvas-confetti';

import { SceneEngine } from './engine/SceneEngine.ts';
import type { GraphicsSettings } from './engine/SceneEngine.ts';
import { AssetManager } from './engine/AssetManager.ts';
import type { LoadedAsset } from './engine/AssetManager.ts';
import { ManipulationManager } from './engine/ManipulationManager.ts';
import type { TransformMode } from './engine/ManipulationManager.ts';
import { AvatarManager } from './engine/AvatarManager.ts';
import { NetworkService } from './services/NetworkService.ts';
import type { ConnectionMode, AssetSpawnData } from './services/NetworkService.ts';
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
import { MiscFileModal } from './components/MiscFileModal.tsx';
import { EnvironmentManager } from './engine/EnvironmentManager.ts';
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

  // UI State
  const [mode, setMode] = useState<ConnectionMode>('offline');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [isHost, setIsHost] = useState<boolean>(true);
  const [currentTransformMode, setCurrentTransformMode] = useState<TransformMode>('translate');
  const [selectedAsset, setSelectedAsset] = useState<LoadedAsset | null>(null);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'first-person'>('first-person');
  const [locomotionMode, setLocomotionMode] = useState<'walk' | 'flight' | 'noclip'>('walk');
  const [showSceneInspector, setShowSceneInspector] = useState<boolean>(false);
  // Ref so the canvas click handler can read the current value without
  // being re-created every time showSceneInspector changes.
  const showSceneInspectorRef = useRef(false);
  showSceneInspectorRef.current = showSceneInspector;
  
  // Resonite Radial Context Menu & Grab modes
  const [showRadialMenu, setShowRadialMenu] = useState<boolean>(false);
  const [radialMenuPos, setRadialMenuPos] = useState<{ x: number; y: number }>({ x: 500, y: 500 });
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
  
  // Misc File inspection modal
  const [inspectedMiscAsset, setInspectedMiscAsset] = useState<LoadedAsset | null>(null);

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
  const [showToolsPanel, setShowToolsPanel] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<ToolType>('dev');

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

  // Initialize 3D Viewport & Engines
  useEffect(() => {
    if (!containerRef.current) return;
    
    const sceneEngine = new SceneEngine(containerRef.current);
    sceneEngineRef.current = sceneEngine;

    const assetManager = new AssetManager(sceneEngine.scene);
    assetManagerRef.current = assetManager;

    const manipulationManager = new ManipulationManager(
      sceneEngine.scene,
      sceneEngine.camera,
      sceneEngine.renderer.domElement,
      sceneEngine.controls
    );
    manipulationManagerRef.current = manipulationManager;

    const avatarManager = new AvatarManager(sceneEngine.scene, sceneEngine.camera);
    avatarManagerRef.current = avatarManager;

    const environmentManager = new EnvironmentManager(sceneEngine.scene, sceneEngine.ambientLight, sceneEngine.dirLight);
    environmentManagerRef.current = environmentManager;

    const vrHud = new VRHUDManager(sceneEngine.scene, sceneEngine.camera, (item) => {
      handleSpawnFromInventory(item);
    }, () => {
      setShowDashMenu(false);
    });
    vrHudRef.current = vrHud;

    const brushManager = new BrushManager(sceneEngine.scene);
    brushManagerRef.current = brushManager;

    const net = networkServiceRef.current;

    // Connect selection events
    manipulationManager.registerOnSelectionChange((asset) => {
      setSelectedAsset(asset);
      if (asset && asset.type === 'misc') {
        setInspectedMiscAsset(asset);
      }
    });

    // Connect transform change -> network broadcast.
    // NOTE: We *deliberately* do NOT touch `setSelectedAsset` here.
    // SceneInspectorWindow displays live position/rotation via an internal
    // requestAnimationFrame loop that imperatively syncs input.value from
    // `selectedAsset.object3d`, so React doesn't need a re-render every
    // drag delta. Earlier we spawned a new object reference here 60x/sec,
    // which forced the inspector's heavy useEffect (meshStats traverse +
    // 6 setStates) to repeat every frame and tanked framerate to ~20fps.
    manipulationManager.registerOnTransformChange((update) => {
      net.broadcastTransform(update);
    });

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

    manipulationManager.registerOnDragChange((dragging) => {
      const asset = manipulationManager.selectedAsset;
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
    });

    // Connect asset additions -> save locally or broadcast
    assetManager.registerOnAssetAdded((asset) => {
      if (net.mode !== 'offline') {
        const spawnData: AssetSpawnData = {
          id: asset.id,
          name: asset.name,
          type: asset.type,
          position: [asset.object3d.position.x, asset.object3d.position.y, asset.object3d.position.z],
          rotation: [asset.object3d.rotation.x, asset.object3d.rotation.y, asset.object3d.rotation.z],
          scale: [asset.object3d.scale.x, asset.object3d.scale.y, asset.object3d.scale.z],
          url: asset.url,
          fileData: asset.fileData,
          isCollidable: asset.isCollidable
        };
        net.broadcastSpawn(spawnData);
      }
    });

    // Network listeners
    net.onPeerJoin(() => setPeerCount(net.peers.size));
    net.onPeerLeave((peerId) => {
      setPeerCount(net.peers.size);
      avatarManager.removePeerAvatar(peerId);
    });
    net.onHostChange((_newHostId, selfHost) => {
      setIsHost(selfHost);
    });

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
      if (data.type === 'primitive' && data.primitiveType) {
        const prim = assetManager.spawnPrimitive(data.primitiveType, pos);
        prim.object3d.rotation.set(...data.rotation);
        prim.object3d.scale.set(...data.scale);
      } else if (data.fileData && data.name) {
        const blob = new Blob([data.fileData]);
        const file = new File([blob], data.name);
        assetManager.importFile(file, pos).then((asset) => {
          if (asset) {
            asset.object3d.rotation.set(...data.rotation);
            asset.object3d.scale.set(...data.scale);
          }
        });
      }
    });

    net.onRemove((id) => {
      assetManager.removeAsset(id);
      if (manipulationManager.selectedAsset?.id === id) {
        manipulationManager.selectAsset(null);
      }
    });

    net.onChat((_msg) => {
      if (!showChatPanel) {
        setUnreadChatCount((prev) => prev + 1);
      }
    });

    net.onStream((stream, peerId) => {
      avatarManager.attachPeerAudio(peerId, stream);
    });

    net.onRoleUpdate((data) => {
      if (data.targetPeerId === net.localPeerId) {
        setLocalRole(data.newRole);
      }
    });

    net.onModerationAction((data) => {
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
    });

    manipulationManager.registerOnScaleSelf((factor) => {
      sceneEngine.camera.position.y = Math.max(0.4, sceneEngine.camera.position.y * factor);
      sceneEngine.controls.target.y = Math.max(0.2, sceneEngine.controls.target.y * factor);
      sceneEngine.controls.update();
    });

    inventoryServiceRef.current.getItems().then((items) => setInventoryItems(items));

    net.onSyncReq((fromPeerId) => {
      if (net.isHost) {
        const assetsList: AssetSpawnData[] = [];
        assetManager.assets.forEach((a) => {
          assetsList.push({
            id: a.id,
            name: a.name,
            type: a.type,
            position: [a.object3d.position.x, a.object3d.position.y, a.object3d.position.z],
            rotation: [a.object3d.rotation.x, a.object3d.rotation.y, a.object3d.rotation.z],
            scale: [a.object3d.scale.x, a.object3d.scale.y, a.object3d.scale.z],
            url: a.url,
            fileData: a.fileData,
            isCollidable: a.isCollidable
          });
        });
        net.sendSceneSnapshot(fromPeerId, assetsList);
      }
    });

    net.onSyncResp((snapshot) => {
      snapshot.assets.forEach((data) => {
        if (!assetManager.assets.has(data.id)) {
          const pos = new THREE.Vector3(...data.position);
          if (data.type === 'primitive' && data.primitiveType) {
            const prim = assetManager.spawnPrimitive(data.primitiveType, pos);
            prim.object3d.rotation.set(...data.rotation);
            prim.object3d.scale.set(...data.scale);
          } else if (data.fileData && data.name) {
            const blob = new Blob([data.fileData]);
            const file = new File([blob], data.name);
            assetManager.importFile(file, pos).then((asset) => {
              if (asset) {
                asset.object3d.rotation.set(...data.rotation);
                asset.object3d.scale.set(...data.scale);
              }
            });
          }
        }
      });
    });

    // Animation Loop sync
    let lastBroadcast = 0;
    const unbindLoop = sceneEngine.registerUpdateCallback((_delta, elapsed) => {
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
    });

    // Handle Canvas Click / Raycast
    const onCanvasClick = (e: MouseEvent) => {
      // Only raycast if clicking directly on canvas without dragging gizmo
      const rect = sceneEngine.renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Save the currently inspected asset BEFORE the raycast, because
      // handleRaycastSelection clears selectedAsset on miss.
      const wasInspected = showSceneInspectorRef.current ? manipulationManager.selectedAsset : null;

      sceneEngine.raycaster.setFromCamera(new THREE.Vector2(x, y), sceneEngine.camera);
      const selected = manipulationManager.handleRaycastSelection(sceneEngine.raycaster, assetManager.assets);
      if (selected && selected.type === 'misc') {
        setInspectedMiscAsset(selected);
      }
      // When the scene inspector is open, clicking the canvas to look around
      // should NOT deselect the inspected asset. Re-select it so the
      // inspector stays open.
      if (!selected && wasInspected) {
        manipulationManager.selectAsset(wasInspected);
        setSelectedAsset(wasInspected);
      }
    };
    const onCanvasContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setRadialMenuPos({ x: e.clientX, y: e.clientY });
      setShowRadialMenu(true);
    };
    const domElem = sceneEngine.renderer.domElement;
    domElem.addEventListener('click', onCanvasClick);
    domElem.addEventListener('contextmenu', onCanvasContextMenu);

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
      net.disconnect();
      manipulationManager.dispose();
      sceneEngine.dispose();
    };
  }, []);

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

      if (cameraMode !== 'first-person') {
        if (e.key === 'g' || e.key === 'w' || e.key === 'G' || e.key === 'W') {
          handleSetMode('translate');
        } else if (e.key === 'r' || e.key === 'e' || e.key === 'R' || e.key === 'E') {
          handleSetMode('rotate');
        } else if (e.key === 's' || e.key === 'S') {
          handleSetMode('scale');
        }
      }

      if (e.key === 'v' || e.key === 'V') {
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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAsset, cameraMode]);

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
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
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
      return next;
    });
  };

  const handleSetLocomotionMode = (mode: 'walk' | 'flight' | 'noclip') => {
    setLocomotionMode(mode);
    if (sceneEngineRef.current) {
      sceneEngineRef.current.locomotionMode = mode;
    }
  };

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
          // Update the mutable ID holder so redo uses the new ID
          if (latestId) latestId.value = a.id;
          networkServiceRef.current.broadcastSpawn({
            id: a.id, name: a.name, type: a.type as AssetSpawnData['type'],
            position: snap.position, rotation: snap.rotation, scale: snap.scale,
            url: a.url, fileData: a.fileData, isCollidable: a.isCollidable,
          });
        }
      });
      return;
    }
    if (asset) {
      asset.object3d.rotation.set(...snap.rotation);
      asset.object3d.scale.set(...snap.scale);
      // Update the mutable ID holder if provided
      if (latestId) latestId.value = asset.id;
      networkServiceRef.current.broadcastSpawn({
        id: asset.id, name: asset.name, type: asset.type as AssetSpawnData['type'],
        position: snap.position, rotation: snap.rotation, scale: snap.scale,
        url: asset.url, fileData: asset.fileData, isCollidable: asset.isCollidable,
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
      const vrm = await avatarManagerRef.current?.loadLocalVRM(file);
      if (vrm) {
        // Also save to inventory
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
    const asset = await assetManager.importFile(file, pos);
    if (asset) {
      manipulationManagerRef.current?.selectAsset(asset);

      // Record undo for imported asset
      recordSpawnUndo(asset);

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
  };

  const handleImportAssetFromConfig = async (config: ImportConfig) => {
    const assetManager = assetManagerRef.current;
    if (!assetManager) return;

    const pos = new THREE.Vector3(0, 1.5, -2.5);
    if (sceneEngineRef.current) {
      const forward = new THREE.Vector3(0, 0, -2.5).applyQuaternion(sceneEngineRef.current.camera.quaternion);
      pos.copy(sceneEngineRef.current.camera.position).add(forward);
    }

    let asset: LoadedAsset | null = null;
    if (config.file) {
      if (config.file.name.toLowerCase().endsWith('.vrm') && config.vrmAction === 'equip-avatar') {
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
      asset = await assetManager.importFile(config.file, pos, config);
    } else if (config.url) {
      asset = await assetManager.importFromUrl(config.url, pos, config);
    }

    if (asset) {
      manipulationManagerRef.current?.selectAsset(asset);
      recordSpawnUndo(asset);

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

      {/* Center Crosshair — always visible so the user knows what they'll select */}
      <div className="absolute inset-0 z-[5] pointer-events-none flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="3" stroke="rgba(0,240,255,0.5)" strokeWidth="1.5" fill="none" />
          <line x1="12" y1="2" x2="12" y2="8" stroke="rgba(0,240,255,0.7)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12" y1="16" x2="12" y2="22" stroke="rgba(0,240,255,0.7)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="2" y1="12" x2="8" y2="12" stroke="rgba(0,240,255,0.7)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="16" y1="12" x2="22" y2="12" stroke="rgba(0,240,255,0.7)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="1" fill="rgba(0,240,255,0.9)" />
        </svg>
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

      {/* First-Person Walk Mode HUD Banner */}
      {cameraMode === 'first-person' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 glass-card px-6 py-2.5 flex items-center gap-3 border border-emerald-500/40 bg-emerald-950/60 shadow-[0_0_25px_rgba(16,185,129,0.4)] pointer-events-auto">
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
          onToggleDrawing={(drawing) => {
            if (brushManagerRef.current) {
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
      {inspectedMiscAsset && (
        <MiscFileModal
          asset={inspectedMiscAsset}
          onClose={() => setInspectedMiscAsset(null)}
          onDownload={(a) => assetManagerRef.current?.downloadAsset(a)}
          onSaveToInventory={async (a) => {
            const item: InventoryItem = {
              id: a.id,
              name: a.name,
              type: a.type,
              createdAt: Date.now(),
              fileData: a.fileData,
              metadata: a.metadata
            };
            await inventoryServiceRef.current.saveItem(item);
          }}
        />
      )}

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

      {/* Resonite Radial Context Menu (Pie Menu) */}
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
      />
    </div>
  );
};
