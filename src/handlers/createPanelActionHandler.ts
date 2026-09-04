import type React from 'react';
import * as THREE from 'three';
import type { SceneEngine } from '../engine/SceneEngine.ts';
import type { AssetManager, LoadedAsset } from '../engine/AssetManager.ts';
import type { EnvironmentManager, AtmospherePreset } from '../engine/EnvironmentManager.ts';
import type { ManipulationManager } from '../engine/ManipulationManager.ts';
import type { VRHUDManager } from '../engine/VRHUDManager.ts';
import type { UndoRedoManager } from '../services/UndoRedoManager.ts';
import type { NetworkService, ConnectionMode } from '../services/NetworkService.ts';
import { CompanionTunnelService } from '../services/CompanionTunnelService.ts';
import type { InventoryService, InventoryItem } from '../services/InventoryService.ts';

/**
 * Everything the panel-action dispatcher needs from App.tsx.
 *
 * All engine/manager fields are refs (not React state) because this
 * dispatcher is created once inside the engine-init `useEffect` (which
 * runs with `[]` deps) and invoked much later, from VR controller/panel
 * button presses. Reading React state directly here would see the
 * value from the initial render forever - refs stay current.
 *
 * `locomotionModeRef` specifically mirrors the `locomotionMode` React
 * state (kept in sync by a small useEffect in App.tsx) for the same
 * stale-closure reason.
 */
export interface PanelActionHandlerDeps {
  // --- Engine / manager refs ---
  sceneEngineRef: React.MutableRefObject<SceneEngine | null>;
  environmentManagerRef: React.MutableRefObject<EnvironmentManager | null>;
  manipulationManagerRef: React.MutableRefObject<ManipulationManager | null>;
  assetManagerRef: React.MutableRefObject<AssetManager | null>;
  vrHudRef: React.MutableRefObject<VRHUDManager | null>;
  undoRedoManagerRef: React.MutableRefObject<UndoRedoManager>;
  networkServiceRef: React.MutableRefObject<NetworkService>;
  inventoryServiceRef: React.MutableRefObject<InventoryService>;
  locomotionModeRef: React.MutableRefObject<'walk' | 'flight' | 'noclip'>;
  allowedLocomotionsRef: React.MutableRefObject<Array<'walk' | 'flight' | 'noclip'>>;
  selectedAssetRef: React.MutableRefObject<LoadedAsset | null>;

  // --- React state setters ---
  setGrabMode: React.Dispatch<React.SetStateAction<'auto' | 'precision' | 'palm' | 'laser'>>;
  setScalingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setLaserEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedAsset: React.Dispatch<React.SetStateAction<LoadedAsset | null>>;

  // --- Handlers defined elsewhere in App.tsx ---
  handleSetLocomotionMode: (mode: 'walk' | 'flight' | 'noclip') => void;
  handleJoinRoom: (targetRoomId: string, targetMode: ConnectionMode, isCompanion?: boolean) => void;
  handleDisconnect: () => void;
  handleSpawnFromInventory: (item: InventoryItem) => void;
  handleDeleteSelected: () => void;
  handleVideoAction: (
    assetId: string,
    kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute' | 'syncMode' | 'subtitlesToggle',
    payload?: number | 'global' | 'local' | 'persistent' | 'watch-party'
  ) => void;
  handleVideoClose: (assetId: string) => void;
  handleAudioAction: (
    assetId: string,
    kind: 'play' | 'pause' | 'stop' | 'seek' | 'volume' | 'volumeMode' | 'mute' | 'loop' | 'speed',
    payload?: number | 'global' | 'local'
  ) => void;
  handleAudioClose: (assetId: string) => void;
}

/**
 * Builds the VR HUD's per-panel-button dispatcher (`onPanelAction`).
 *
 * This is the backbone of the "no React DOM in pure immersive VR" UX
 * path: canvas-rendered 3D panels (settings, environment, share/pair,
 * the radial menu, chat, and the scene inspector) can't render React
 * DOM inside a WebXR session, so they fire a flat `actionId` string
 * (e.g. `'inspect.transform:pos.x+'`, `'settings.shadow:high'`) which
 * this dispatcher routes to the same mutation paths the desktop React
 * UI uses (SceneInspectorWindow, RadialContextMenu, SettingsModal, etc).
 *
 * Extracted verbatim from the VRHUDManager construction in the
 * engine-init effect - see the original inline comments preserved
 * below for the per-action-family behavior notes (undo/redo semantics,
 * the `dirty()` post-edit housekeeping steps, transform stepper units,
 * material slot cycling, etc).
 */
export function createPanelActionHandler(
  deps: PanelActionHandlerDeps
): (actionId: string) => void {
  const {
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
  } = deps;

  return (actionId: string) => {
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
    if (actionId === 'pair:host' || actionId === 'pair:newCode') {
      CompanionTunnelService.getInstance().startHost().catch(console.warn);
      return;
    }
    if (actionId === 'pair:disconnect') {
      CompanionTunnelService.getInstance().disconnect();
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
        // Cycle through allowed locomotion modes only.
        // Route through handleSetLocomotionMode (not just the React
        // setter) so sceneEngine.locomotionMode is kept in sync.
        const cur = locomotionModeRef.current;
        const allowed = allowedLocomotionsRef.current;
        const idx = allowed.indexOf(cur);
        const next = allowed[(idx + 1) % allowed.length] ?? 'walk';
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
        if (actionId === 'inspect.toggle:meshRenderer') {
          // Toggle child mesh visibility only — NOT the root
          // object3d.visible. This keeps the Mesh Renderer and
          // Active concepts independent: Active controls the
          // entire game object, Mesh Renderer only controls
          // whether the visual mesh is drawn.
          let anyMeshVisible = false;
          o3d.children.forEach((child) => {
            child.traverse((c) => {
              if ((c as THREE.Mesh).isMesh && c.visible) anyMeshVisible = true;
            });
          });
          const nextEnabled = !anyMeshVisible;
          o3d.children.forEach((child) => {
            child.traverse((c) => {
              if ((c as THREE.Mesh).isMesh) c.visible = nextEnabled;
            });
          });
          networkServiceRef.current?.broadcastInspectorUpdate({
            assetId: sel.id,
            nodeUuid: undefined,
            meshEnabled: nextEnabled
          });
          dirty();
          return;
        }
        if (actionId === 'inspect.toggle:visible') {
          // Kept for backward compatibility — same as meshRenderer.
          // The Mesh Renderer toggle only affects child meshes,
          // NOT the root object3d.visible.
          let anyMeshVisible = false;
          o3d.children.forEach((child) => {
            child.traverse((c) => {
              if ((c as THREE.Mesh).isMesh && c.visible) anyMeshVisible = true;
            });
          });
          const nextEnabled = !anyMeshVisible;
          o3d.children.forEach((child) => {
            child.traverse((c) => {
              if ((c as THREE.Mesh).isMesh) c.visible = nextEnabled;
            });
          });
          networkServiceRef.current?.broadcastInspectorUpdate({
            assetId: sel.id,
            nodeUuid: undefined,
            meshEnabled: nextEnabled
          });
          dirty();
          return;
        }
        if (actionId === 'inspect.toggle:active') {
          // Match the desktop inspector's semantics, where
          // "Active" IS object3d.visible (see
          // SceneInspectorWindow's Active checkbox and the
          // onInspectorUpdate handler above, which sets
          // targetNode.visible = update.active). The previous
          // userData.active flag was never read anywhere, so
          // this toggle did nothing — not locally, not for peers.
          o3d.visible = !o3d.visible;
          networkServiceRef.current?.broadcastInspectorUpdate({
            assetId: sel.id,
            nodeUuid: undefined,
            active: o3d.visible
          });
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
            const c2 = (m as any).color as THREE.Color;
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

        // ---- Texture Map Slot Actions ----
        if (actionId.startsWith('inspect.material.slot:')) {
          const slotName = actionId.substring('inspect.material.slot:'.length);
          const mm = manipulationManagerRef.current;
          const heldImg =
            mm?.getHandGrabAsset('right')?.type === 'image'
              ? mm.getHandGrabAsset('right')
              : mm?.getHandGrabAsset('left')?.type === 'image'
                ? mm.getHandGrabAsset('left')
                : null;
          const applyTextureUrl = (url: string | null) => {
            if (!url) {
              for (const m of mats) {
                (m as any)[slotName] = null;
                m.needsUpdate = true;
              }
              dirty();
              return;
            }
            new THREE.TextureLoader().load(url, (tex) => {
              tex.wrapS = THREE.RepeatWrapping;
              tex.wrapT = THREE.RepeatWrapping;
              if (slotName === 'map' || slotName === 'emissiveMap') {
                tex.colorSpace = THREE.SRGBColorSpace;
              }
              for (const m of mats) {
                (m as any)[slotName] = tex;
                m.needsUpdate = true;
              }
              dirty();
            });
          };

          if (heldImg && heldImg.url) {
            applyTextureUrl(heldImg.url);
            return;
          }
          // NOTE: do NOT redeclare `am` inside Priority 2/3/4 of any handler that also reads this outer `am` - use a distinct name. See Priority 4’s `amPrio4` rename.
    const am = assetManagerRef.current;
          const imgAssets = am
            ? Array.from(am.assets.values()).filter(
                (a): a is LoadedAsset & { url: string } => a.type === 'image' && typeof a.url === 'string' && a.url.length > 0
              )
            : [];
          if (imgAssets.length > 0) {
            const curTex = (mats[0] as any)?.[slotName] as THREE.Texture | null;
            const curUrl =
              (curTex?.image as any)?.src || (curTex?.source as any)?.data?.src || '';
            let nextIdx = 0;
            if (curUrl) {
              const idx = imgAssets.findIndex((a) => curUrl.includes(a.url) || a.url.includes(curUrl));
              nextIdx = (idx + 1) % (imgAssets.length + 1);
            }
            if (nextIdx === imgAssets.length) {
              applyTextureUrl(null);
            } else {
              applyTextureUrl(imgAssets[nextIdx].url || null);
            }
          } else {
            applyTextureUrl(null);
          }
          return;
        }

        if (actionId.startsWith('inspect.material.slotClear:')) {
          const slotName = actionId.substring('inspect.material.slotClear:'.length);
          for (const m of mats) {
            (m as any)[slotName] = null;
            m.needsUpdate = true;
          }
          dirty();
          return;
        }

        if (actionId === 'inspect.openMaterialEditor') {
          vrHudRef.current?.openPanel('sys-material');
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

        // ---- Video controls (only valid when sel.type === 'video') ----
        // Mirror of handleVideoAction + handleVideoClose above so
        // desktop + VR + network all mutate through the same path.
        if (actionId.startsWith('inspect.video:')) {
          if (sel.type !== 'video') return;
          const tail = actionId.substring('inspect.video:'.length);
          if (tail === 'play') handleVideoAction(sel.id, 'play');
          else if (tail === 'pause') handleVideoAction(sel.id, 'pause');
          else if (tail === 'togglePlay') {
            const vs = assetManagerRef.current?.getVideoState(sel.id);
            if (vs) handleVideoAction(sel.id, vs.playing ? 'pause' : 'play');
          }
          else if (tail === 'seekPrev' || tail === 'seekNext') {
            handleVideoAction(sel.id, 'step', tail === 'seekPrev' ? -5 : 5);
          }
          else if (tail === 'restart') handleVideoAction(sel.id, 'seek', 0);
          else if (tail === 'volUp' || tail === 'volDown') {
            const vs = assetManagerRef.current?.getVideoState(sel.id);
            if (vs) {
              const cur = vs.volumeMode === 'global' ? vs.globalVolume : vs.localVolume;
              handleVideoAction(sel.id, 'volume', Math.max(0, Math.min(1, cur + (tail === 'volUp' ? 0.1 : -0.1))));
            }
          }
          else if (tail === 'toggleMute') handleVideoAction(sel.id, 'mute');
          else if (tail === 'mode:global' || tail === 'mode:local') {
            handleVideoAction(sel.id, 'volumeMode', tail === 'mode:global' ? 'global' : 'local');
          }
          else if (tail === 'close') handleVideoClose(sel.id);
          else return;
          dirty();
          return;
        }

        // ---- Audio controls (only valid when sel.type === 'audio') ----
        if (actionId.startsWith('inspect.audio:')) {
          if (sel.type !== 'audio') return;
          const tail = actionId.substring('inspect.audio:'.length);
          if (tail === 'play') handleAudioAction(sel.id, 'play');
          else if (tail === 'pause') handleAudioAction(sel.id, 'pause');
          else if (tail === 'stop') handleAudioAction(sel.id, 'pause');
          else if (tail === 'restart') handleAudioAction(sel.id, 'seek', 0);
          else if (tail === 'volUp' || tail === 'volDown') {
            const aus = assetManagerRef.current?.getAudioState(sel.id);
            if (aus) {
              const cur = aus.volumeMode === 'global' ? aus.globalVolume : aus.localVolume;
              handleAudioAction(sel.id, 'volume', Math.max(0, Math.min(1, cur + (tail === 'volUp' ? 0.1 : -0.1))));
            }
          }
          else if (tail === 'mute') handleAudioAction(sel.id, 'mute');
          else if (tail === 'loop') handleAudioAction(sel.id, 'loop');
          else if (tail === 'mode:global' || tail === 'mode:local') {
            handleAudioAction(sel.id, 'volumeMode', tail === 'mode:global' ? 'global' : 'local');
          }
          else if (tail === 'speedDown' || tail === 'speedUp') {
            const aus = assetManagerRef.current?.getAudioState(sel.id);
            if (aus) {
              const delta = tail === 'speedUp' ? 0.1 : -0.1;
              handleAudioAction(sel.id, 'speed', Math.round((aus.playbackRate + delta) * 10) / 10);
            }
          }
          else if (tail === 'close') handleAudioClose(sel.id);
          else return;
          dirty();
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
  };
}
