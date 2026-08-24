import { useEffect, useCallback } from 'react';
import * as THREE from 'three';

import type { SceneEngine } from '../engine/SceneEngine.ts';
import { AssetManager } from '../engine/AssetManager.ts';
import type { LoadedAsset } from '../engine/AssetManager.ts';
import type { ManipulationManager, TransformMode } from '../engine/ManipulationManager.ts';
import type { NetworkService, MaterialUpdate } from '../services/NetworkService.ts';
import type { InventoryService, InventoryItem } from '../services/InventoryService.ts';
import type { UndoRedoManager } from '../services/UndoRedoManager.ts';
import type { VRHUDManager } from '../engine/VRHUDManager.ts';
import type { ToolType } from '../components/WorldToolsPanel.tsx';
import { getGrabbable, setGrabbable } from '../components/grabbable/GrabbableComponent.ts';

// ---------------------------------------------------------------------------
// useKeyboardShortcuts
// ---------------------------------------------------------------------------
// Extracted from App.tsx to keep the god-component manageable. Owns:
//   • All keyboard event handling (keydown / keyup)
//   • The two keyboard-specific action callbacks (save-to-inventory,
//     duplicate-selected) that are only wired through the keyboard handler.
//   • The plainPasteModeRef safety-net (Ctrl+Shift+V flag).
//
// Every dependency is passed in via the params object so the hook is fully
// testable and has no hidden coupling to App.tsx internals.
// ---------------------------------------------------------------------------

interface UseKeyboardShortcutsParams {
  // ── Read-only state ────────────────────────────────────────────────────
  selectedAsset: LoadedAsset | null;
  cameraMode: 'orbit' | 'first-person';
  activeTool: ToolType | null;

  // ── State setters ──────────────────────────────────────────────────────
  setShowDashMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setShowChatPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setUnreadChatCount: React.Dispatch<React.SetStateAction<number>>;
  setActiveTool: React.Dispatch<React.SetStateAction<ToolType | null>>;
  setShowToolsPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setRadialMenuPos: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  setShowRadialMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setShowInventoryModal: React.Dispatch<React.SetStateAction<boolean>>;
  setImportInitialFile: React.Dispatch<React.SetStateAction<File | null>>;
  setShowImportDialog: React.Dispatch<React.SetStateAction<boolean>>;
  setInventoryItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;

  // ── Refs ───────────────────────────────────────────────────────────────
  sceneEngineRef: React.RefObject<SceneEngine | null>;
  inventoryServiceRef: React.RefObject<InventoryService>;
  vrHudRef: React.RefObject<VRHUDManager | null>;
  undoRedoManagerRef: React.RefObject<UndoRedoManager>;
  assetManagerRef: React.RefObject<AssetManager | null>;
  manipulationManagerRef: React.RefObject<ManipulationManager | null>;
  networkServiceRef: React.RefObject<NetworkService>;

  // ── Shared ref (created in App.tsx, shared with paste handler) ────────
  plainPasteModeRef: React.RefObject<boolean>;

  // ── Action callbacks (defined in App.tsx, passed in) ──────────────────
  onSetMode: (m: TransformMode) => void;
  onFocusSelected: () => void;
  onDeleteSelected: () => void;
  onCenterRaySelect: () => void;
  onOpenInspector: (asset: LoadedAsset | null) => void;
  onRecordSpawnUndo: (asset: LoadedAsset) => void;
}

export function useKeyboardShortcuts(params: UseKeyboardShortcutsParams) {
  const {
    selectedAsset,
    cameraMode,
    activeTool,
    setShowDashMenu,
    setShowChatPanel,
    setUnreadChatCount,
    setActiveTool,
    setShowToolsPanel,
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
    onSetMode,
    onFocusSelected,
    onDeleteSelected,
    onCenterRaySelect,
    onOpenInspector,
    onRecordSpawnUndo,
    plainPasteModeRef,
  } = params;

  // ── Ctrl+S — Save selected asset to inventory ─────────────────────────
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
      primitiveType: (asset.object3d.userData as Record<string, unknown>)?.primitiveType as any,
      materialState: (asset.object3d.userData as Record<string, unknown>)?.materialState as MaterialUpdate | undefined,
      metadata:
        asset.metadata ||
        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),
    };
    inventoryServiceRef.current.saveItem(item).then(() => {
      console.log(`[Inventory] Saved "${asset.name}" to inventory`);
    });
  }, [selectedAsset]);

  // ── Ctrl+D — Duplicate selected asset ─────────────────────────────────
  const handleDuplicateSelected = useCallback(async () => {
    if (!selectedAsset) return;
    const asset = selectedAsset;
    const am = assetManagerRef.current;
    if (!am) return;

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
      onRecordSpawnUndo(newAsset);
      networkServiceRef.current.broadcastSpawn({
        id: newAsset.id,
        name: newAsset.name,
        type: newAsset.type as any,
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
        console.warn(`[Duplicate] Failed to re-import from URL ${asset.url}:`, err);
      }
    }
  }, [selectedAsset]);

  // ── Keyboard event listeners ───────────────────────────────────────────
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

      if (e.key === 'Enter') {
        e.preventDefault();
        setShowChatPanel((prev) => !prev);
        setUnreadChatCount(0);
        return;
      }

      // Resonite Desktop Tool Bindings (Keys 1..8)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === '1') {
          e.preventDefault();
          setActiveTool(null);
          return;
        } else if (e.key === '2') {
          e.preventDefault();
          setActiveTool((prev) => (prev === 'dev' ? null : 'dev'));
          setShowToolsPanel(true);
          return;
        } else if (e.key === '3') {
          e.preventDefault();
          setActiveTool((prev) => (prev === 'brush' ? null : 'brush'));
          setShowToolsPanel(true);
          return;
        } else if (e.key === '4') {
          e.preventDefault();
          setActiveTool((prev) => (prev === 'material' ? null : 'material'));
          setShowToolsPanel(true);
          return;
        } else if (e.key === '5') {
          e.preventDefault();
          setActiveTool((prev) => (prev === 'shape' ? null : 'shape'));
          setShowToolsPanel(true);
          return;
        } else if (e.key === '6') {
          e.preventDefault();
          setActiveTool((prev) => (prev === 'light' ? null : 'light'));
          setShowToolsPanel(true);
          return;
        } else if (e.key === '7') {
          e.preventDefault();
          if (selectedAsset) {
            const current = getGrabbable(selectedAsset.object3d);
            current.enabled = !current.enabled;
            setGrabbable(selectedAsset.object3d, current);
            console.log(`[Grabbable Setter Tool] "${selectedAsset.name}" grabbable enabled=${current.enabled}`);
          }
          return;
        } else if (e.key === '8') {
          e.preventDefault();
          if (selectedAsset) {
            const currentCollider = !!selectedAsset.object3d.userData.characterCollider;
            selectedAsset.object3d.userData.characterCollider = !currentCollider;
            console.log(`[Character Collider Setter Tool] "${selectedAsset.name}" characterCollider set to ${!currentCollider}`);
          }
          return;
        }
      }

      // Dev tool's secondary action (R) — center-of-screen raycast select.
      if (
        activeTool === 'dev' &&
        !sceneEngineRef.current?.renderer.xr.isPresenting &&
        (e.key === 'r' || e.key === 'R') &&
        !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      ) {
        e.preventDefault();
        onCenterRaySelect();
        return;
      }

      if (cameraMode !== 'first-person') {
        if (e.key === 'g' || e.key === 'w' || e.key === 'G' || e.key === 'W') {
          onSetMode('translate');
        } else if (e.key === 'r' || e.key === 'e' || e.key === 'R' || e.key === 'E') {
          onSetMode('rotate');
        } else if (e.key === 's' || e.key === 'S') {
          onSetMode('scale');
        }
      }

      // T key — toggle radial / pie context menu.
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setShowRadialMenu((prev) => !prev);
        return;
      } else if (e.key === 'o' || e.key === 'O') {
        // Open a new Scene Inspector pinned to the current selection.
        // Plain O only — modifier combos (Ctrl+O for "Open File" in
        // browsers, etc.) fall through to the browser's default.
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          onOpenInspector(selectedAsset);
          return;
        }
      } else if (e.key === 'f' || e.key === 'F') {
        onFocusSelected();
      } else if (e.key === 'i' || e.key === 'I') {
        setShowInventoryModal((prev) => !prev);
      } else if (e.key === 'u' || e.key === 'U') {
        setImportInitialFile(null);
        setShowImportDialog((prev) => !prev);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        onDeleteSelected();
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
        // the browser's default paste handler.
        plainPasteModeRef.current = true;
      }
    };

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
  }, [
    selectedAsset,
    cameraMode,
    activeTool,
    handleSaveSelectedToInventory,
    handleDuplicateSelected,
    onCenterRaySelect,
    onSetMode,
    onFocusSelected,
    onDeleteSelected,
    onOpenInspector,
  ]);

  // No return value — plainPasteModeRef is owned by App.tsx and shared
  // via params so the global paste handler can read-and-clear it.
}
