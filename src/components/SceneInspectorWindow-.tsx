import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { findObjectByUUID } from '../utils/findObjectByUUID.ts';
import { SpatialPopUpWrapper } from './SpatialPopUpWrapper.tsx';
import { AssetManager, type LoadedAsset } from '../engine/AssetManager.ts';
import type { MaterialUpdate, InspectorUpdateData } from '../services/NetworkService.ts';
import type { SpatialPanelManager } from '../engine/SpatialPanelManager.ts';
import { VideoControls } from './VideoControls.tsx';
import {
  Trash2, RotateCcw, ArrowUpRight, Magnet, Plus, Copy,
  Box, Layers, Sparkles, Activity, ChevronRight, ChevronDown, Minimize2, Maximize2, Image as ImageIcon, Eye
} from 'lucide-react';
import {
  type ResoniteLightConfig,
  DEFAULT_LIGHT_CONFIG,
  syncThreeLightFromConfig,
  removeLightComponent
} from '../engine/ResoniteLightSync.ts';

export interface SceneInspectorWindowProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAsset: LoadedAsset | null;
  onSelectAsset?: (asset: LoadedAsset | null) => void;
  onUpdateAsset: (asset: LoadedAsset) => void;
  onBroadcastMaterial?: (update: MaterialUpdate) => void;
  onBroadcastInspectorUpdate?: (update: InspectorUpdateData) => void;
  /**
   * Broadcast a transform-only update via the realtime `trans`
   * channel. Wired by App.tsx to NetworkService.broadcastAssetUpdate,
   * which encodes the asset's CURRENT transform (object3d.position
   * / .rotation / .scale) into a TransformUpdate envelope that
   * peers apply via ManipulationManager.applyRemoteTransform.
   * Same channel the gizmo uses, so inspector-driven edits feel
   * identical to drag-driven edits on the wire (no JSON
   * overhead, no head-of-line blocking on the reliable channel).
   *
   * Used by:
   *   - applyTransform (keyboard-typed position/rotation/scale
   *     inputs + per-axis Reset Pos/Rot/Scale + Reset All)
   *   - the Center Pivot button
   * Gizmo drags do NOT need this — manipulationManager already
   * broadcasts every transformChange directly via its own listener.
   */
  onBroadcastAssetUpdate?: (asset: LoadedAsset) => void;
  onDeleteAsset: (id: string) => void;
  onJumpToAsset: (asset: LoadedAsset) => void;
  onBringAsset: (asset: LoadedAsset) => void;
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  assetManager?: AssetManager;
  spatialPanelManager?: SpatialPanelManager;
  /**
   * Optional world-root Group3D — pass when there are TWO distinct
   * containers in scene (e.g. THREE.Scene itself vs a dedicated
   * `worldRoot` Group). When provided, the inspector's
   * 'Parent Under World' hierarchy button re-parents under this
   * node instead of `scene`, matching the receive-side path
   * (`sceneEngine.worldRoot.attach(...)`) so the broadcast is
   * symmetric across all peers. When null/missing, the inspector
   * falls back to attaching to `scene`.
   */
  worldRoot?: THREE.Object3D | null;
  /**
   * Video action callbacks. Only used when the selected asset is a
   * video; null when not. Wired by App.tsx to forward into
   * AssetManager.applyVideoState (+ NetworkService.broadcastVideoState
   * for the shared-with-peers fields). Passed as a single bundle
   * rather than 8 separate props so the inspector's prop surface
   * stays readable and adding new actions doesn't touch this
   * component's signature.
   */
  videoActions?: VideoActions | null;
  /**
   * Multiplayer panel-broadcast:
   *   - targetObject: Object3D to dock the inspector's 3D panel at
   *     so it follows the asset through gizmo drags / RMB grab.
   *     Forwarded to SpatialPopUpWrapper's `parentObject` prop.
   *     Defaults to selectedAsset?.object3d, so callers that don't
   *     pass it explicitly get the existing camera-relative float.
   *   - interactivePermissionGranted: when false, renders a banner
   *     + blocks click events on the body (pointer-events-none)
   *     so the peer's mirror view is read-only. Originated by the
   *     originator's localRole permission gate (ROLE_PERMISSIONS in
   *     App.tsx); the originator themselves always sees the panel
   *     fully interactive regardless.
   */
  targetObject?: THREE.Object3D | null;
  interactivePermissionGranted?: boolean;
  /**
   * Optional header text rendered above the title when the panel
   * was opened from a peer's panelstate broadcast (so the mirrored
   * view shows "X is inspecting…" instead of just "Scene Inspector").
   * Hidden when undefined.
   */
  originatorHeader?: React.ReactNode;
}

/**
 * Action bundle for the video-controls section. All mutations to
 * video playback state go through these — the inspector component
 * never mutates `asset.videoElement` directly. Volume in global
 * mode is broadcast by App.tsx; local volume / mute / mode toggle
 * are deliberately not broadcast (per-user UI preference).
 */
export interface VideoActions {
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onStep: (deltaSec: number) => void;
  onVolumeChange: (vol: number) => void;
  onVolumeModeToggle: (mode: 'global' | 'local') => void;
  onMuteToggle: () => void;
  onClose: () => void;
}

export const SceneInspectorWindow: React.FC<SceneInspectorWindowProps> = ({
  isOpen,
  onClose,
  selectedAsset,
  onSelectAsset,
  onUpdateAsset,
  onBroadcastMaterial,
  onBroadcastInspectorUpdate,
  onBroadcastAssetUpdate,
  onDeleteAsset,
  onJumpToAsset,
  onBringAsset,
  scene,
  camera,
  assetManager,
  spatialPanelManager,
  videoActions,
  targetObject,
  worldRoot,
  interactivePermissionGranted,
  originatorHeader,
}) => {
  // Mirror of the prop with a default so we don't sprinkle `?? true`
  // checks across the JSX. The defaults preserve the pre-broadcast
  // behaviour: panel is fully interactive, asset docks via default
  // propping the spatial wrapper's parentObject to selectedAsset?.object3d.
  const interactive = interactivePermissionGranted ?? true;
  const dockTarget = targetObject ?? selectedAsset?.object3d ?? undefined;
  // The actual top of the scene graph — used as the hierarchy tree's
  // default root so the left pane shows the WHOLE scene (parents,
  // siblings, everything) the way Resonite's Scene Inspector does,
  // not just the selected asset's own subtree. Falls back to the
  // selected asset itself if this component is ever used without
  // scene/worldRoot wired up.
  const trueRoot: THREE.Object3D | null = worldRoot ?? scene ?? null;

  if (!isOpen) return null;

  const [assetName, setAssetName] = useState(selectedAsset?.name || 'Box');
  const [tag, setTag] = useState('null');
  const [active, setActive] = useState(selectedAsset?.object3d.visible ?? true);
  const [persistent, setPersistent] = useState(true);
  // const [orderOffset, setOrderOffset] = useState(0);

  // Transform states
  const [pos, setPos] = useState({ x: 0, y: 1.5, z: 0 });
  const [rot, setRot] = useState({ x: 0, y: 0, z: 0 });
  const [scale, setScale] = useState({ x: 1, y: 1, z: 1 });

  // Mesh stats
  const [meshStats, setMeshStats] = useState({
    vertices: 0,
    triangles: 0,
    submeshes: 0,
    hasNormals: true,
    hasTangents: true,
    hasUV0: true,
    isSkinned: false,
    boneCount: 0,
    rootBoneName: 'None'
  });

  const [texProps, setTexProps] = useState({
    url: 'None',
    filterMode: 'Bilinear / Trilinear',
    anisotropic: 4,
    wrapU: 'Repeat',
    wrapV: 'Repeat',
    mipmaps: true,
    uncompressed: false
  });

  // Material properties
  const [matProps, setMatProps] = useState({
    color: '#38bdf8',
    roughness: 0.4,
    metalness: 0.2,
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1.0,
    normalScale: 1.0,
    aoMapIntensity: 1.0,
    wireframe: false,
    flatShading: false,
    shadowCast: true
  });

  // Custom components attached
  const [attachedComponents, setAttachedComponents] = useState<string[]>([]);
  const [lightConfig, setLightConfig] = useState<ResoniteLightConfig>(DEFAULT_LIGHT_CONFIG);

  const handleUpdateLightConfig = (updates: Partial<ResoniteLightConfig>) => {
    if (!selectedAsset || !interactive) return;
    const nextConfig = { ...lightConfig, ...updates };
    setLightConfig(nextConfig);
    syncThreeLightFromConfig(selectedAsset.object3d, nextConfig);
    onUpdateAsset({ ...selectedAsset });
    onBroadcastInspectorUpdate?.({
      assetId: selectedAsset.id,
      nodeUuid: undefined,
      resoniteLight: nextConfig,
    });
  };
  const [meshEnabled, setMeshEnabled] = useState(true);

  const handleToggleMeshEnabled = (enabled: boolean) => {
    setMeshEnabled(enabled);
    if (!selectedAsset || !interactive) return;
    selectedAsset.object3d.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.visible = enabled;
      }
    });
    onUpdateAsset({ ...selectedAsset });
    onBroadcastInspectorUpdate?.({
      assetId: selectedAsset.id,
      nodeUuid: undefined,
      meshEnabled: enabled,
    });
  };

  const handleDeleteMeshGizmo = () => {
    if (!selectedAsset || !interactive) return;
    const meshesToRemove: THREE.Object3D[] = [];
    selectedAsset.object3d.children.forEach((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshesToRemove.push(child);
      }
    });
    meshesToRemove.forEach((m) => {
      m.removeFromParent();
      if ((m as THREE.Mesh).geometry) (m as THREE.Mesh).geometry.dispose();
    });
    setMeshEnabled(false);
    // Sync mesh-renderer toggle to peers — same `meshEnabled` field
    // already wired on the receive side (`if (update.meshEnabled
    // !== undefined) child.visible = update.meshEnabled!`), so the
    // peer's hide-mesh-on-disable path runs identically for both
    // the Enabled checkbox and the Del Mesh button.
    onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, meshEnabled: false });
    onUpdateAsset({ ...selectedAsset });
  };

  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Hierarchy-tree state. selectedNodeUUID identifies the Object3D row
  // the user clicked in the left pane, expandedNodes remembers which
  // tree branches are unfolded across renders, and inspectorRootUUID
  // optionally scopes the visible tree to a chosen sub-slot (the
  // "Set Root" action from SceneInspector.txt). UUID addressing lets
  // us round-trip back to a Three node for the destructive and
  // reparenting actions without storing Object3D refs in React state.
  const [selectedNodeUUID, setSelectedNodeUUID] = useState<string | null>(null);
  // @ts-ignore
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [inspectorRootUUID, setInspectorRootUUID] = useState<string | null>(null);
  const [sceneExplorerQuery, setSceneExplorerQuery] = useState('');
  const [expandedExplorerNodes, setExpandedExplorerNodes] = useState<Set<string>>(new Set());

  // Collapsible component sections
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [openSlotDropdown, setOpenSlotDropdown] = useState<string | null>(null);
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [selectedMaterialIndex, setSelectedMaterialIndex] = useState<number>(0);

  // Refs for live pos/rot/scale display. The values are updated by a rAF
  // loop (further below) that imperatively writes `el.value` from
  // `selectedAsset.object3d` on every animation frame, so React never
  // re-renders this inspector 60x/sec during gizmo drags (which previously
  // tanked framerate from 60 to ~20fps by re-running a full scene-graph
  // traverse + 6 setStates inside useEffect on every drag delta).
  const posXRef = useRef<HTMLInputElement>(null);
  const posYRef = useRef<HTMLInputElement>(null);
  const posZRef = useRef<HTMLInputElement>(null);
  const rotXRef = useRef<HTMLInputElement>(null);
  const rotYRef = useRef<HTMLInputElement>(null);
  const rotZRef = useRef<HTMLInputElement>(null);
  const scaleXRef = useRef<HTMLInputElement>(null);
  const scaleYRef = useRef<HTMLInputElement>(null);
  const scaleZRef = useRef<HTMLInputElement>(null);

  // Tracks whether this inspector was previously inspecting a real asset, so
  // we can distinguish "opened with no selection" (stay open) from
  // "selection was deleted out from under us" (auto-close).
  const hadSelectionRef = useRef(false);

  // Per-asset video-event bump. When the inspected asset is a video,
  // we listen for every meaningful playback lifecycle event on the
  // underlying HTMLVideoElement so the inspector's render reflects
  // the current element state (play → icon flips to Pause, volume
  // change → slider thumb moves, timeupdate → progress bar tick).
  // Cheap: each event handler just increments an integer — React
  // doesn't diff tree, just schedules a render for the very next
  // microtask. The setState's identity shift is the re-render
  // trigger; the actual displayed values are read live from
  // `asset.object3d.userData.videoState` so this is just a "force one
  // more render" mechanism. timeupdate fires ~4x/sec on most
  // browsers while playback is active, which produces a small but
  // acceptable re-render load (the heavy meshStats useEffect above
  // doesn't re-run because its deps array is `[selectedAsset?.id]`,
  // not the bump counter).
  const [, setVideoTick] = useState(0);

  // Subscribe to the HTMLVideoElement lifecycle so the inspector
  // mirrors the user's playback engine. Bound to selection id so
  // re-selecting the same asset (e.g. via selection-clear + re-click)
  // re-attaches cleanly.
  useEffect(() => {
    if (selectedAsset?.type !== 'video' || !selectedAsset.videoElement) return;
    const v = selectedAsset.videoElement;
    const bump = () => setVideoTick((t) => t + 1);
    const events = ['play', 'pause', 'volumechange', 'loadedmetadata', 'ended', 'seeked', 'ratechange', 'timeupdate'];
    events.forEach((ev) => v.addEventListener(ev, bump));
    return () => {
      events.forEach((ev) => v.removeEventListener(ev, bump));
    };
  }, [selectedAsset?.id, selectedAsset?.type, selectedAsset?.videoElement]);

  // Heavy selection sync — runs once per asset id change. Holds the
  // source-of-truth state for the Reset buttons and applyTransform defaults;
  // the numeric inputs below are imperatively synced by a separate rAF loop.
  useEffect(() => {
    if (!selectedAsset) return;
    setAssetName(selectedAsset.name);
    // Re-read the persistent bit from userData on every selection
    // change. `userData.isPersistent` is the source of truth — the
    // inspector checkbox writes it on toggle, the network broadcast
    // mirror in applyRemoteTransform writes it on receive. Defaulting
    // to `true` (matches every primitive's default in this codebase)
    // means a guest opening the inspector on a spawn asset that hasn't
    // had isPersistent broadcast yet still shows the host's intent.
    setPersistent(((selectedAsset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined) ?? true);

    const existingLight = selectedAsset.object3d.children.find((c) => (c as THREE.Light).isLight) as THREE.Light | undefined;
    const existingLightConfig = (selectedAsset.object3d.userData as Record<string, any>)?.resoniteLight;
    const isLightAsset = Boolean(existingLightConfig || existingLight || selectedAsset.name.toLowerCase().includes('light'));

    if (isLightAsset) {
      const config: ResoniteLightConfig = existingLightConfig || {
        ...DEFAULT_LIGHT_CONFIG,
        LightType: existingLight instanceof THREE.SpotLight ? 'Spot' : existingLight instanceof THREE.DirectionalLight ? 'Directional' : 'Point',
        Intensity: existingLight ? existingLight.intensity / 35 : DEFAULT_LIGHT_CONFIG.Intensity,
      };
      selectedAsset.object3d.userData.resoniteLight = config;
      setLightConfig(config);
      setAttachedComponents((prev) => (prev.includes('Light Source') ? prev : ['Light Source', ...prev]));
    } else {
      setLightConfig(DEFAULT_LIGHT_CONFIG);
      setAttachedComponents((prev) => prev.filter((c) => c !== 'Light Source'));
    }

    let visibleMesh = false;
    selectedAsset.object3d.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).visible) visibleMesh = true;
    });
    setMeshEnabled(visibleMesh);

    const p = selectedAsset.object3d.position;
    const r = selectedAsset.object3d.rotation;
    const s = selectedAsset.object3d.scale;
    setPos({ x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)), z: Number(p.z.toFixed(4)) });
    setRot({
      x: Number(THREE.MathUtils.radToDeg(r.x).toFixed(2)),
      y: Number(THREE.MathUtils.radToDeg(r.y).toFixed(2)),
      z: Number(THREE.MathUtils.radToDeg(r.z).toFixed(2))
    });
    setScale({ x: Number(s.x.toFixed(4)), y: Number(s.y.toFixed(4)), z: Number(s.z.toFixed(4)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset?.id]);

  // Live UI-flag reconcile — runs whenever the selected asset reference
  // changes (e.g. App.tsx spreads a new wrapper after a peer broadcast).
  // Keeps the Active / Persistent / Mesh Enabled checkboxes in sync with
  // the Three.js source of truth without re-running the heavy selection
  // effect above on every local onUpdateAsset reference change.
  useEffect(() => {
    if (!selectedAsset) return;
    setActive(selectedAsset.object3d.visible);
    setPersistent(((selectedAsset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined) ?? true);
    let visibleMesh = false;
    selectedAsset.object3d.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).visible) visibleMesh = true;
    });
    setMeshEnabled(visibleMesh);
  }, [selectedAsset]);

  // Auto-expand the tree branches between the scene root and whatever
  // is currently selected, so the selected item is immediately visible
  // in place (matching Resonite's Scene Inspector, where the selected
  // slot shows expanded in the hierarchy without manual clicking).
  // Only walks UP from the asset (cheap) rather than re-deriving the
  // whole tree.
  useEffect(() => {
    if (!selectedAsset) return;
    setExpandedNodes(prev => {
      const next = new Set(prev);
      let cur: THREE.Object3D | null = selectedAsset.object3d.parent;
      while (cur) {
        next.add(cur.uuid);
        cur = cur.parent;
      }
      return next;
    });
  }, [selectedAsset?.id]);
  // Runs ONCE per selection change — never per-frame during drags. This
  // was the main fps killer (meshStats traverse compounds with React
  // render of a 1000+ line panel to drop framerate to ~20fps).
  useEffect(() => {
    if (!selectedAsset) return;
    let verts = 0;
    let tris = 0;
    let submeshes = 0;
    let normals = false;
    let uv = false;
    let isSkinned = false;
    let boneCount = 0;
    let rootBoneName = 'None';
    let colorHex = '#38bdf8';
    let rgh = 0.4;
    let met = 0.2;
    let wire = false;
    let flat = false;

    selectedAsset.object3d.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        let childTris = 0;
        if (mesh.geometry) {
          const posAttr = mesh.geometry.attributes.position;
          if (posAttr) verts += posAttr.count;
          if (mesh.geometry.index) {
            childTris = mesh.geometry.index.count / 3;
          } else if (posAttr) {
            childTris = posAttr.count / 3;
          }
          tris += childTris;
          if (mesh.geometry.attributes.normal) normals = true;
          if (mesh.geometry.attributes.uv) uv = true;
        }
        if (childTris > 0) {
          submeshes++;
          if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
            isSkinned = true;
            boneCount = (child as THREE.SkinnedMesh).skeleton?.bones?.length || 15;
            rootBoneName = (child as THREE.SkinnedMesh).skeleton?.bones?.[0]?.name || 'RootBone';
          }
          if (mesh.material) {
            const m = mesh.material as THREE.MeshStandardMaterial;
            if (m.color && m.color.getHexString) colorHex = '#' + m.color.getHexString();
            if (m.roughness !== undefined) rgh = m.roughness;
            if (m.metalness !== undefined) met = m.metalness;
            if (m.wireframe !== undefined) wire = m.wireframe;
            if (m.flatShading !== undefined) flat = m.flatShading;
          }
        }
      }
    });

    setMeshStats({
      vertices: verts,
      triangles: Math.floor(tris),
      submeshes: submeshes,
      hasNormals: normals,
      hasTangents: normals,
      hasUV0: uv,
      isSkinned,
      boneCount,
      rootBoneName
    });

    setMatProps((prev) => ({
      ...prev,
      color: colorHex,
      roughness: rgh,
      metalness: met,
      wireframe: wire,
      flatShading: flat
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset?.id]);

  useEffect(() => {
    const allMats = getTargetMaterials();
    const activeMat = selectedMaterialIndex >= 0 && allMats[selectedMaterialIndex]
      ? allMats[selectedMaterialIndex]
      : allMats[0];
    if (activeMat) {
      setMatProps((prev) => ({
        ...prev,
        color: activeMat.color?.getHexString ? '#' + activeMat.color.getHexString() : prev.color,
        roughness: activeMat.roughness ?? prev.roughness,
        metalness: activeMat.metalness ?? prev.metalness,
        opacity: activeMat.opacity ?? prev.opacity,
        normalScale: activeMat.normalScale ? activeMat.normalScale.x : prev.normalScale,
        aoMapIntensity: activeMat.aoMapIntensity ?? prev.aoMapIntensity,
        wireframe: activeMat.wireframe ?? prev.wireframe,
        flatShading: activeMat.flatShading ?? prev.flatShading,
        emissive: activeMat.emissive?.getHexString ? '#' + activeMat.emissive.getHexString() : prev.emissive,
        emissiveIntensity: activeMat.emissiveIntensity ?? prev.emissiveIntensity,
      }));
    }
  }, [selectedMaterialIndex, selectedAsset?.id, selectedNodeUUID]);

  // Live transform display: imperatively writes input.value every animation
  // frame from `selectedAsset.object3d` (the source of truth during drags).
  // Skips inputs that currently have focus so user typing into a field
  // isn't clobbered as they drag elsewhere. Cancels itself on unmount or
  // selection change.
  useEffect(() => {
    if (!isOpen || !selectedAsset) return;
    let rafId = 0;
    let cancelled = false;

    const syncOne = (ref: React.RefObject<HTMLInputElement | null>, value: string) => {
      const el = ref.current;
      if (!el || el === document.activeElement) return;
      if (el.value !== value) el.value = value;
    };

    const tick = () => {
      if (cancelled) return;
      const obj = selectedAsset.object3d;
      syncOne(posXRef, Number(obj.position.x.toFixed(4)).toString());
      syncOne(posYRef, Number(obj.position.y.toFixed(4)).toString());
      syncOne(posZRef, Number(obj.position.z.toFixed(4)).toString());
      syncOne(rotXRef, Number(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(2)).toString());
      syncOne(rotYRef, Number(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(2)).toString());
      syncOne(rotZRef, Number(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(2)).toString());
      syncOne(scaleXRef, Number(obj.scale.x.toFixed(4)).toString());
      syncOne(scaleYRef, Number(obj.scale.y.toFixed(4)).toString());
      syncOne(scaleZRef, Number(obj.scale.z.toFixed(4)).toString());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [isOpen, selectedAsset?.id]);

  // Track whether we had a selection previously. When selectedAsset becomes null
  // (deselected or deleted), we stay open showing the full Scene Hierarchy explorer.
  useEffect(() => {
    if (isOpen && selectedAsset) {
      hadSelectionRef.current = true;
    } else if (isOpen && !selectedAsset) {
      hadSelectionRef.current = false;
    }
  }, [isOpen, selectedAsset]);

  // Reset the left-pane tree state (highlighted UUID, expanded branches,
  // visible root) whenever the inspected asset id changes. The previous
  // selections referred to Object3D UUIDs inside the OLD asset's
  // subtree — keeping them would (a) leave the visual highlight on a
  // node that doesn't exist anymore and (b) make handler fallbacks
  // silently snap to the new asset root without telling the user.
  // Clearing all three on every id change keeps editor focus aligned
  // with the asset the user is now inspecting.
  useEffect(() => {
    setSelectedNodeUUID(null);
    setExpandedNodes(new Set());
    setInspectorRootUUID(null);
  }, [selectedAsset?.id]);

  const applyTransform = (newPos = pos, newRot = rot, newScale = scale) => {
    // Multiplayer panel-broadcast (Issue 2 fix): gate the apply path at
    // the handler level. The read-only mirror UI already has
    // pointer-events-none on its body, but Tab-key navigation can still
    // fire onChange on the X/Y/Z number inputs and the existing asset
    // would propagate through onUpdateAsset → handleUpdateAsset →
    // broadcastAssetUpdate to ALL peers. The early return below blocks
    // any keyboard-driven mutation reaching the broadcast site.
    if (!interactive) return;
    if (!selectedAsset) return;

    selectedAsset.object3d.position.set(newPos.x, newPos.y, newPos.z);
    selectedAsset.object3d.rotation.set(
      THREE.MathUtils.degToRad(newRot.x),
      THREE.MathUtils.degToRad(newRot.y),
      THREE.MathUtils.degToRad(newRot.z)
    );
    selectedAsset.object3d.scale.set(newScale.x, newScale.y, newScale.z);
    onUpdateAsset({ ...selectedAsset });
    onBroadcastAssetUpdate?.(selectedAsset);
  };

  const handleResetPos = () => {
    if (!interactive) return;
    const next = { x: 0, y: 1.5, z: 0 };
    setPos(next);
    applyTransform(next, rot, scale);
  };

  const handleResetRot = () => {
    if (!interactive) return;
    const next = { x: 0, y: 0, z: 0 };
    setRot(next);
    applyTransform(pos, next, scale);
  };

  const handleResetScale = () => {
    if (!interactive) return;
    const next = { x: 1, y: 1, z: 1 };
    setScale(next);
    applyTransform(pos, rot, next);
  };

  const getTargetMaterials = (): THREE.MeshStandardMaterial[] => {
    if (!selectedAsset) return [];
    const target = findObjectByUUID(selectedAsset.object3d, selectedNodeUUID) ?? selectedAsset.object3d;
    const mats: THREE.MeshStandardMaterial[] = [];
    const seen = new Set<string>();
    target.traverse((c) => {
      const m = (c as THREE.Mesh).material;
      if (m) {
        const list = Array.isArray(m) ? m : [m];
        list.forEach((mat) => {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if (stdMat && !seen.has(stdMat.uuid)) {
            seen.add(stdMat.uuid);
            mats.push(stdMat);
          }
        });
      }
    });
    return mats;
  };

  const handleUpdateMaterial = (key: string, val: any) => {
    if (!interactive) return;
    const next = { ...matProps, [key]: val };
    setMatProps(next);
    if (!selectedAsset) return;

    const update: MaterialUpdate = {
      assetId: selectedAsset.id,
      materialIndex: selectedMaterialIndex >= 0 ? selectedMaterialIndex : undefined,
      [key]: val
    };
    if (key === 'emissive') {
      update.emissiveIntensity = next.emissiveIntensity || 1.0;
    }

    AssetManager.applyMaterialUpdate(selectedAsset, update);
    onBroadcastMaterial?.(update);
    onUpdateAsset({ ...selectedAsset });
  };

  const imageAssets = assetManager ? Array.from(assetManager.assets.values()).filter((a) => a.type === 'image') : [];

  const handleApplyTextureSlot = (slotName: string, url: string | null) => {
    // Mirror-safety: same exploit class as the 4 onChange handlers we
    // already gated (Active toggle was the user's #1 priority).
    // Texture slot dropdown can be fired via keyboard, since the
    // pointer-events:none CSS only blocks mouse clicks.
    if (!interactive || !selectedAsset) return;

    const update: MaterialUpdate = {
      assetId: selectedAsset.id,
      materialIndex: selectedMaterialIndex >= 0 ? selectedMaterialIndex : undefined,
      [slotName]: url
    };

    AssetManager.applyMaterialUpdate(selectedAsset, update);
    onBroadcastMaterial?.(update);
    onUpdateAsset({ ...selectedAsset });
  };

  const targetMaterials = getTargetMaterials();

  const handleAttachComponent = (compType: string) => {
    if (!interactive) return;
    if (!selectedAsset) return;
    if (!attachedComponents.includes(compType)) {
      setAttachedComponents([...attachedComponents, compType]);
    }
    setShowAttachMenu(false);

    if (compType === 'Light Source') {
      const config: ResoniteLightConfig = { ...DEFAULT_LIGHT_CONFIG };
      selectedAsset.object3d.userData.resoniteLight = config;
      setLightConfig(config);
      syncThreeLightFromConfig(selectedAsset.object3d, config);
    } else if (compType === 'Rotator Script') {
      // Add custom userData to drive rotation in SceneEngine
      selectedAsset.object3d.userData.rotatorSpeed = { x: 0, y: 1.5, z: 0 };
    } else if (compType === 'Bobbing / Float') {
      selectedAsset.object3d.userData.bobbingSpeed = 2.0;
    }
    onUpdateAsset({ ...selectedAsset });
    if (compType === 'Light Source') {
      onBroadcastInspectorUpdate?.({
        assetId: selectedAsset.id,
        nodeUuid: undefined,
        resoniteLight: selectedAsset.object3d.userData.resoniteLight,
      });
    } else if (compType === 'Rotator Script') {
      onBroadcastInspectorUpdate?.({
        assetId: selectedAsset.id,
        nodeUuid: undefined,
        rotatorSpeed: selectedAsset.object3d.userData.rotatorSpeed,
      });
    } else if (compType === 'Bobbing / Float') {
      onBroadcastInspectorUpdate?.({
        assetId: selectedAsset.id,
        nodeUuid: undefined,
        bobbingSpeed: selectedAsset.object3d.userData.bobbingSpeed,
      });
    }
  };

  // Insert an empty THREE.Group above the currently-selected node and
  // reparent the target under it. THREE.Object3D.attach() preserves
  // world transforms through the reparenting, so the slot keeps the
  // exact pose it had before the user clicked.
  const handleInsertParent = () => {
    if (!interactive) return;
    if (!selectedAsset) return;
    const target = findObjectByUUID(selectedAsset.object3d, selectedNodeUUID) ?? selectedAsset.object3d;
    const newParent = new THREE.Group();
    newParent.name = `Parent_of_${target.name || 'Slot'}`;
    newParent.attach(target);
    setSelectedNodeUUID(newParent.uuid);
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.add(newParent.uuid);
      return next;
    });
    onUpdateAsset({ ...selectedAsset });
    onBroadcastInspectorUpdate?.({
      assetId: selectedAsset.id,
      nodeUuid: selectedNodeUUID ?? undefined,
      hierarchyAction: { type: 'insertParent', newNodeUuid: newParent.uuid },
    });
  };

  // Append an empty THREE.Group as a child of the currently-selected
  // node, offset slightly so the user can see it spawn under the
  // tree.
  const handleAddChild = () => {
    if (!interactive) return;
    if (!selectedAsset) return;
    const target = findObjectByUUID(selectedAsset.object3d, selectedNodeUUID) ?? selectedAsset.object3d;
    const newChild = new THREE.Group();
    newChild.name = `Child_of_${target.name || 'Slot'}`;
    newChild.position.set(0, 0.5, 0);
    target.add(newChild);
    setSelectedNodeUUID(newChild.uuid);
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.add(target.uuid);
      return next;
    });
    onUpdateAsset({ ...selectedAsset });
    onBroadcastInspectorUpdate?.({
      assetId: selectedAsset.id,
      nodeUuid: selectedNodeUUID ?? undefined,
      hierarchyAction: { type: 'addChild', newNodeUuid: newChild.uuid },
    });
  };

  // Walk up from any clicked tree node to find which tracked
  // LoadedAsset owns it (the node itself, or the nearest ancestor
  // that IS a LoadedAsset.object3d). Structural scene nodes that
  // aren't spawned assets (e.g. Controllers, Skybox, Ground) return
  // undefined — clicking those just scopes the sub-selection, it
  // doesn't change which asset is being inspected.
  const findOwningAsset = (node: THREE.Object3D): LoadedAsset | undefined => {
    if (!assetManager) return undefined;
    let cur: THREE.Object3D | null = node;
    while (cur) {
      for (const asset of assetManager.assets.values()) {
        if (asset.object3d === cur) return asset;
      }
      cur = cur.parent;
    }
    return undefined;
  };

  // Scope the left-pane tree to a chosen descendant — useful for deep
  // hierarchies where the top-level name list gets unreadable. This
  // is the "focus" action (Resonite's blue-arrow button): re-roots
  // the DISPLAYED tree at the selected node without changing what's
  // actually selected/inspected.
  const handleSetInspectorRoot = () => {
    if (!selectedNodeUUID) return;
    setInspectorRootUUID(selectedNodeUUID);
  };

  const handleResetInspectorRoot = () => {
    setInspectorRootUUID(null);
  };

  const handleStepUpInspectorRoot = () => {
    if (!inspectorRootUUID || !trueRoot) return;
    const node = findObjectByUUID(trueRoot, inspectorRootUUID);
    if (node && node.parent) {
      setInspectorRootUUID(node.parent.uuid);
    } else {
      // Focused node has no parent left within the tree (or wasn't
      // found) — just clear focus back to the full scene root.
      setInspectorRootUUID(null);
    }
  };

  // Reparent the selected node so it sits directly under the scene
  // root (Three.Object3D.attach() preserves world pose).
  const handleParentUnderWorld = () => {
    if (!interactive) return;
    if (!selectedAsset) return;
    const attachRoot = worldRoot ?? scene;
    if (!attachRoot) return;
    const target = findObjectByUUID(selectedAsset.object3d, selectedNodeUUID) ?? selectedAsset.object3d;
    attachRoot.attach(target);
    onUpdateAsset({ ...selectedAsset });
    onBroadcastInspectorUpdate?.({
      assetId: selectedAsset.id,
      nodeUuid: selectedNodeUUID ?? undefined,
      hierarchyAction: { type: 'parentToWorld' },
    });
  };

  return (
    <SpatialPopUpWrapper
      isOpen={isOpen}
      onClose={onClose}
      title="Scene Inspector"
      icon={<Activity className="w-4 h-4 text-cyan-400" />}
      scene={scene}
      camera={camera}
      assetManager={assetManager}
      spatialPanelManager={spatialPanelManager}
      panelId="inspector"
      defaultWidth={560}
      defaultHeight={780}
      initialPinned={true}
      parentObject={dockTarget ?? undefined}
    >
      {originatorHeader && (
        <div className="mb-2 flex items-center gap-2 bg-purple-500/10 border border-purple-500/40 rounded-lg px-3 py-2">
          <Eye className="w-4 h-4 text-purple-300 shrink-0" />
          <div className="flex-1 text-[11px] text-purple-200 font-semibold">
            {originatorHeader}
          </div>
        </div>
      )}
      {!interactive && (
        <div className="mb-2 flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
          <Eye className="w-4 h-4 text-amber-300 shrink-0" />
          <div className="flex-1 text-[11px] text-amber-200 font-semibold">
            Read-only mirror — your role does not include edit permission; changes here would not broadcast.
          </div>
        </div>
      )}
      {!selectedAsset ? (
        <div className="flex flex-col gap-3 font-sans text-xs select-none pb-4">
          <div className="bg-gradient-to-r from-cyan-950/60 to-slate-900/80 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col gap-1.5 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">Scene Hierarchy</div>
                  <div className="text-[11px] text-cyan-300/80">Select any object in the scene to inspect & edit</div>
                </div>
              </div>
              <div className="text-[11px] font-mono bg-slate-800/80 text-cyan-300 px-2.5 py-1 rounded-lg border border-slate-700">
                {(assetManager?.assets.size ?? 0)} Asset{(assetManager?.assets.size ?? 0) !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
            <input
              type="text"
              placeholder="Search scene objects by name or type..."
              value={sceneExplorerQuery}
              onChange={(e) => setSceneExplorerQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 transition"
            />
          </div>

          {/* Hierarchy list */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col gap-1.5 max-h-[580px] overflow-y-auto custom-scrollbar">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 mb-1">
              Spawned Assets & Objects
            </div>
            {(() => {
              const allAssets: LoadedAsset[] = assetManager ? Array.from(assetManager.assets.values()) : [];
              const filtered = allAssets.filter((a: LoadedAsset) => {
                if (!sceneExplorerQuery.trim()) return true;
                const q = sceneExplorerQuery.toLowerCase();
                return a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q);
              });

              const renderHierarchyNode = (node: THREE.Object3D, parentAsset: LoadedAsset, depth: number): React.ReactNode => {
                const isExpanded = expandedExplorerNodes.has(node.uuid);
                return (
                  <div key={node.uuid}>
                    <div
                      onClick={() => onSelectAsset?.(parentAsset)}
                      style={{ paddingLeft: `${depth * 14 + 8}px` }}
                      className="flex items-center justify-between py-1.5 pr-2 rounded-lg hover:bg-slate-900 border border-transparent hover:border-slate-800 cursor-pointer transition group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {node.children.length > 0 ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedExplorerNodes(prev => {
                                const next = new Set(prev);
                                if (next.has(node.uuid)) next.delete(node.uuid);
                                else next.add(node.uuid);
                                return next;
                              });
                            }}
                            className="p-0.5 rounded hover:bg-slate-800 text-slate-400 transition shrink-0"
                          >
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        ) : (
                          <span className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <Box className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate text-slate-200 group-hover:text-cyan-300 font-medium">
                          {node.name || node.type || 'Unnamed Node'}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono shrink-0">
                        Object3D
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="flex flex-col">
                        {node.children.map(child => renderHierarchyNode(child, parentAsset, depth + 1))}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <>
                  {filtered.length === 0 ? (
                    <div className="py-6 text-center text-slate-400 text-xs italic">
                      {allAssets.length === 0 ? 'No objects spawned in scene yet.' : 'No matching objects found.'}
                    </div>
                  ) : (
                    filtered.map((asset) => {
                      const isExpanded = expandedExplorerNodes.has(asset.id);
                      const hasChildren = asset.object3d.children.length > 0;

                      return (
                        <div key={asset.id} className="flex flex-col border border-slate-900 hover:border-slate-800 rounded-lg overflow-hidden transition">
                          <div
                            onClick={() => onSelectAsset?.(asset)}
                            className="flex items-center justify-between p-2.5 bg-slate-900/40 hover:bg-slate-800/80 cursor-pointer transition group"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {hasChildren ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedExplorerNodes(prev => {
                                      const next = new Set(prev);
                                      if (next.has(asset.id)) next.delete(asset.id);
                                      else next.add(asset.id);
                                      return next;
                                    });
                                  }}
                                  className="p-1 rounded hover:bg-slate-700 text-slate-400 transition shrink-0"
                                >
                                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </button>
                              ) : (
                                <span className="w-3.5 h-3.5 shrink-0" />
                              )}

                              <div className="p-1.5 rounded bg-slate-800 text-amber-400 border border-slate-700 shrink-0">
                                {asset.type === 'video' ? <Activity className="w-3.5 h-3.5 text-pink-400" /> :
                                 asset.type === 'image' ? <ImageIcon className="w-3.5 h-3.5 text-cyan-400" /> :
                                 <Box className="w-3.5 h-3.5 text-amber-400" />}
                              </div>

                              <div className="min-w-0">
                                <div className="text-slate-100 font-bold group-hover:text-cyan-300 transition truncate">
                                  {asset.name}
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                  Pos: {asset.object3d.position.x.toFixed(1)}, {asset.object3d.position.y.toFixed(1)}, {asset.object3d.position.z.toFixed(1)}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                                {asset.type}
                              </span>
                              <div className="px-2.5 py-1 rounded bg-cyan-500/20 group-hover:bg-cyan-500 text-cyan-300 group-hover:text-slate-950 font-bold text-[11px] transition">
                                Inspect
                              </div>
                            </div>
                          </div>

                          {isExpanded && hasChildren && (
                            <div className="flex flex-col bg-slate-950/60 border-t border-slate-900 py-1">
                              {asset.object3d.children.map(child => renderHierarchyNode(child, asset, 1))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  {scene && scene.children.length > 0 && (() => {
                    const nodeMatchesQuery = (node: THREE.Object3D, query: string): boolean => {
                      if (!query.trim()) return true;
                      const q = query.toLowerCase();
                      if ((node.name?.toLowerCase() || '').includes(q) || (node.type?.toLowerCase() || '').includes(q)) {
                        return true;
                      }
                      return node.children.some(child => nodeMatchesQuery(child, query));
                    };

                    const renderSceneGraphNode = (node: THREE.Object3D, depth: number): React.ReactNode => {
                      if (!nodeMatchesQuery(node, sceneExplorerQuery)) return null;
                      const isDefaultExpanded = node.name === 'World Root' || node.name === 'Camera Rig';
                      const isExpanded = isDefaultExpanded
                        ? !expandedExplorerNodes.has(`collapsed_${node.uuid}`)
                        : expandedExplorerNodes.has(node.uuid);

                      const matchedAsset = allAssets.find(a => a.object3d === node || a.object3d.uuid === node.uuid);
                      const hasChildren = node.children.length > 0;

                      const icon = node.type.includes('Light') ? (
                        <Sparkles className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                      ) : node.type.includes('Camera') ? (
                        <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      ) : node.type === 'Mesh' ? (
                        <Box className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      ) : (
                        <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      );

                      return (
                        <div key={node.uuid}>
                          <div
                            onClick={() => {
                              if (matchedAsset) {
                                onSelectAsset?.(matchedAsset);
                              } else {
                                onSelectAsset?.({
                                  id: node.uuid,
                                  name: node.name || node.type || 'Scene Object',
                                  type: '3d-model',
                                  object3d: node,
                                  isCollidable: false
                                });
                              }
                            }}
                            style={{ paddingLeft: `${depth * 14 + 8}px` }}
                            className="flex items-center justify-between p-2 rounded-lg bg-slate-900/40 hover:bg-slate-800/80 cursor-pointer border border-slate-900 hover:border-slate-800 transition group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {hasChildren ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedExplorerNodes(prev => {
                                      const next = new Set(prev);
                                      if (isDefaultExpanded) {
                                        const key = `collapsed_${node.uuid}`;
                                        if (next.has(key)) next.delete(key);
                                        else next.add(key);
                                      } else {
                                        if (next.has(node.uuid)) next.delete(node.uuid);
                                        else next.add(node.uuid);
                                      }
                                      return next;
                                    });
                                  }}
                                  className="p-0.5 rounded hover:bg-slate-800 text-slate-400 transition shrink-0"
                                >
                                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </button>
                              ) : (
                                <span className="w-3.5 h-3.5 shrink-0" />
                              )}
                              {icon}
                              <span className="text-slate-200 group-hover:text-cyan-300 font-medium truncate">
                                {node.name || node.type || 'Unnamed Node'}
                              </span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-400 shrink-0">
                              {node.type}
                            </span>
                          </div>
                          {isExpanded && hasChildren && (
                            <div className="flex flex-col border-l border-slate-800/60 ml-2.5">
                              {node.children.map(child => renderSceneGraphNode(child, depth + 1))}
                            </div>
                          )}
                        </div>
                      );
                    };

                    return (
                      <>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 mt-4 mb-1">
                          Root Scene Nodes (THREE.Scene)
                        </div>
                        {scene.children.map(node => renderSceneGraphNode(node, 0))}
                      </>
                    );
                  })()}
                </>
              );
            })()}
          </div>
        </div>
      ) : (
        <div className="flex flex-row gap-3 font-sans text-xs select-none pb-4 min-h-0">
          {/* LEFT COLUMN: HIERARCHY TREE — always-visible scene tree,
              mirrors Resonite's "Root: X" left pane. Fixed width so it
              doesn't crowd the Slot detail column on narrower panels. */}
        <div className={`w-[200px] shrink-0 bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col gap-2 min-h-0 ${
          !interactive ? 'pointer-events-none opacity-80' : ''
        }`}>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-1">
              <span className="font-bold text-slate-300 font-mono text-[11px] truncate">
                Root: <span className="text-amber-300 normal-case">
                  {inspectorRootUUID
                    ? (trueRoot && findObjectByUUID(trueRoot, inspectorRootUUID)?.name) || '...'
                    : (trueRoot?.name || 'Scene')}
                </span>
              </span>
              <button
                onClick={() => setShowHierarchy(!showHierarchy)}
                title={showHierarchy ? 'Hide hierarchy tree' : 'Show hierarchy tree'}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 shrink-0 transition"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => onSelectAsset?.(null)}
                title="Return to full scene hierarchy to select another object"
                className="px-1.5 py-1 rounded bg-slate-800 hover:bg-cyan-500/20 text-cyan-300 font-bold text-[10px] flex items-center gap-1 transition"
              >
                <Layers className="w-3 h-3" />
                <span>All</span>
              </button>
              {inspectorRootUUID && (
                <>
                  <button
                    onClick={handleStepUpInspectorRoot}
                    title="Step up one level"
                    className="p-1 rounded bg-slate-800 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 transition"
                  >
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                  <button
                    onClick={handleResetInspectorRoot}
                    title="Back to top of hierarchy"
                    className="px-1.5 py-1 rounded bg-slate-800 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 font-bold text-[10px] transition"
                  >
                    Top
                  </button>
                </>
              )}
              <button
                onClick={handleSetInspectorRoot}
                disabled={!selectedNodeUUID}
                title="Focus in on the selected item (shows only its own children)"
                className="p-1 rounded bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 disabled:opacity-30 disabled:hover:bg-slate-800 transition"
              >
                <Layers className="w-3 h-3" />
              </button>
            </div>
          </div>

          {showHierarchy && (
            <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto border-t border-slate-800 pt-2 custom-scrollbar">
              {(() => {
                if (!selectedAsset) return null;
                const visibleRoot = inspectorRootUUID
                  ? (trueRoot && findObjectByUUID(trueRoot, inspectorRootUUID)) || selectedAsset.object3d
                  : (trueRoot ?? selectedAsset.object3d);
                if (!visibleRoot) return null;
                const renderNode = (node: THREE.Object3D, depth: number): React.ReactNode => {
                  const expanded = expandedNodes.has(node.uuid);
                  const isAssetRoot = node.uuid === selectedAsset.object3d.uuid;
                  const isSubSelected = !isAssetRoot && selectedNodeUUID === node.uuid;
                  const isNonPersistent = node.userData?.isPersistent === false;
                  return (
                    <div key={node.uuid}>
                      <div
                        onClick={() => {
                          setSelectedNodeUUID(node.uuid);
                          const owningAsset = findOwningAsset(node);
                          if (owningAsset && owningAsset.id !== selectedAsset.id) {
                            onSelectAsset?.(owningAsset);
                          }
                        }}
                        style={{ paddingLeft: `${depth * 12 + 4}px` }}
                        className={`flex items-center gap-1.5 py-0.5 pr-1.5 rounded text-[11px] cursor-pointer transition ${
                          isAssetRoot
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                            : isSubSelected
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                            : 'text-slate-300 hover:bg-slate-900 border border-transparent'
                        }`}
                      >
                        {node.children.length > 0 ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedNodes(prev => {
                                const next = new Set(prev);
                                if (next.has(node.uuid)) next.delete(node.uuid);
                                else next.add(node.uuid);
                                return next;
                              });
                            }}
                            className="p-0.5 rounded hover:bg-slate-800 text-slate-400 transition shrink-0"
                            title={expanded ? 'Collapse children' : 'Expand children'}
                          >
                            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                        ) : (
                          <span
                            className="inline-block w-3 h-3 shrink-0 rounded-full border border-slate-700"
                            title="No children"
                          />
                        )}
                        <Box className="w-3 h-3 text-amber-400 shrink-0" />
                        <span className="truncate flex-1">{node.name || node.type || 'Unnamed'}</span>
                        {isNonPersistent && (
                          <span
                            className="text-orange-400 text-[10px] font-black ml-0.5"
                            title="Non-persistent (won't save with the world)"
                          >
                            ●
                          </span>
                        )}
                      </div>
                      {expanded && node.children.map(c => (
                        <div key={c.uuid + '_branch'} className="border-l border-slate-800 ml-3.5">
                          {renderNode(c, depth + 1)}
                        </div>
                      ))}
                    </div>
                  );
                };
                return <div className="flex flex-col gap-0.5 mt-1">{renderNode(visibleRoot, 0)}</div>;
              })()}

              {attachedComponents.length > 0 && (
                <div className="mt-2 pt-1.5 border-t border-slate-800">
                  <div className="text-[9px] uppercase tracking-wider text-purple-400 font-bold px-1.5 mb-1">Attached Components</div>
                  {attachedComponents.map((comp) => (
                    <div
                      key={comp}
                      className="flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer bg-purple-500/10 text-purple-300 border border-purple-500/30 font-semibold"
                    >
                      <Activity className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="truncate min-w-0">{comp}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* VERTICAL SCROLLABLE SLOT & COMPONENTS STACK */}
        <div className={`flex-1 bg-slate-950/60 border border-slate-800 rounded-xl p-3 overflow-y-auto flex flex-col gap-3 custom-scrollbar ${
          !interactive ? 'pointer-events-none opacity-85' : ''
        }`}>

          {/* SLOT HEADER */}
          <div className="flex flex-col gap-2.5 bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/80 shadow-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h4 className="font-extrabold text-sm text-white flex items-center gap-2">
                <span className="text-amber-400">Slot:</span>
                <span>{assetName}</span>
              </h4>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => { if (selectedAsset) onDeleteAsset(selectedAsset.id); onClose(); }}
                  title="Destroy Slot"
                  className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { if (selectedAsset) onJumpToAsset(selectedAsset); }}
                  title="Jump To Slot"
                  className="p-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 transition flex items-center gap-1 font-bold"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span>Jump To</span>
                </button>
                <button
                  onClick={() => { if (selectedAsset) onBringAsset(selectedAsset); }}
                  title="Bring To Me"
                  className="p-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 transition flex items-center gap-1 font-bold"
                >
                  <Magnet className="w-3.5 h-3.5" />
                  <span>Bring To</span>
                </button>
                {/* Hierarchy scene-graph actions (per SceneInspector.txt).
                    Insert Parent creates an empty Group above the selected
                    row; Add Child creates one below; Set Root scopes the
                    visible hierarchy to the selected descendant. Resonite
                    also exposes Duplicate; we don't add a UI button since
                    Ctrl+D already covers it, but the keyboard binding
                    works on the same node. */}
                <button
                  onClick={handleInsertParent}
                  disabled={!selectedAsset}
                  title="Insert Empty Parent Above (Insert Parent)"
                  className="p-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 disabled:opacity-30 disabled:hover:bg-blue-500/20 disabled:hover:text-blue-300 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleAddChild}
                  disabled={!selectedAsset}
                  title="Add Empty Child To Selected (Add Child)"
                  className="p-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 disabled:opacity-30 disabled:hover:bg-emerald-500/20 disabled:hover:text-emerald-300 transition"
                >
                  <Box className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Slot Basic Properties */}
            <div className="grid grid-cols-2 gap-2 text-slate-300">
              <div className="flex items-center gap-2">
                <span className="w-16 font-semibold text-slate-400">Name:</span>
                <input
                  type="text"
                  value={assetName}
                  onChange={(e) => { setAssetName(e.target.value); if (!interactive || !selectedAsset) return; selectedAsset.name = e.target.value; onUpdateAsset({ ...selectedAsset }); onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, name: e.target.value }); }}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 font-semibold text-slate-400">Parent:</span>
                <span className="flex-1 bg-slate-950/80 border border-slate-800 rounded px-2 py-1 text-slate-400 font-mono text-[10px] truncate">
                  Spawn - User Holder ({selectedAsset?.id.slice(-6) || 'ID674'})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 font-semibold text-slate-400">Tag:</span>
                <input
                  type="text"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => { setActive(e.target.checked); if (!interactive || !selectedAsset) return; selectedAsset.object3d.visible = e.target.checked; onUpdateAsset({ ...selectedAsset }); onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, active: e.target.checked }); }}
                    className="w-3.5 h-3.5 accent-cyan-500 rounded"
                  />
                  <span className="font-bold text-slate-300">Active</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={persistent}
                    onChange={(e) => {
                      setPersistent(e.target.checked);
                      // Keep userData in sync so other consumers (peer
                      // synchronization, future "save world" action,
                      // and the inspector's hierarchy orange-dot indicator)
                      // see the persisted bit, not just local UI state.
                      if (!interactive || !selectedAsset) return;
                      selectedAsset.object3d.userData.isPersistent = e.target.checked;
                      onUpdateAsset({ ...selectedAsset });
                      onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, persistent: e.target.checked });
                    }}
                    className="w-3.5 h-3.5 accent-cyan-500 rounded"
                  />
                  <span className="font-bold text-slate-300">Persistent</span>
                </label>
              </div>
            </div>

            {/* Transform Controls (Position, Rotation, Scale) */}
            <div className="flex flex-col gap-2 mt-1 bg-slate-950/90 p-2.5 rounded-lg border border-slate-800">
              <div className="grid grid-cols-12 gap-1.5 items-center">
                <span className="col-span-2 font-bold text-cyan-400 flex items-center justify-between pr-1">
                  <span>Position:</span>
                </span>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-red-400 font-bold">X</span>
                  <input type="number" step="0.1" ref={posXRef} defaultValue={pos.x} onChange={(e) => { const n = { ...pos, x: parseFloat(e.target.value) || 0 }; setPos(n); applyTransform(n, rot, scale); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-emerald-400 font-bold">Y</span>
                  <input type="number" step="0.1" ref={posYRef} defaultValue={pos.y} onChange={(e) => { const n = { ...pos, y: parseFloat(e.target.value) || 0 }; setPos(n); applyTransform(n, rot, scale); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-blue-400 font-bold">Z</span>
                  <input type="number" step="0.1" ref={posZRef} defaultValue={pos.z} onChange={(e) => { const n = { ...pos, z: parseFloat(e.target.value) || 0 }; setPos(n); applyTransform(n, rot, scale); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <button onClick={handleResetPos} title="Reset Pos" className="col-span-1 p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center"><RotateCcw className="w-3 h-3" /></button>
              </div>

              <div className="grid grid-cols-12 gap-1.5 items-center">
                <span className="col-span-2 font-bold text-emerald-400 flex items-center justify-between pr-1">
                  <span>Rotation:</span>
                </span>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-red-400 font-bold">X</span>
                  <input type="number" step="5" ref={rotXRef} defaultValue={rot.x} onChange={(e) => { const n = { ...rot, x: parseFloat(e.target.value) || 0 }; setRot(n); applyTransform(pos, n, scale); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-emerald-400 font-bold">Y</span>
                  <input type="number" step="5" ref={rotYRef} defaultValue={rot.y} onChange={(e) => { const n = { ...rot, y: parseFloat(e.target.value) || 0 }; setRot(n); applyTransform(pos, n, scale); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-blue-400 font-bold">Z</span>
                  <input type="number" step="5" ref={rotZRef} defaultValue={rot.z} onChange={(e) => { const n = { ...rot, z: parseFloat(e.target.value) || 0 }; setRot(n); applyTransform(pos, n, scale); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <button onClick={handleResetRot} title="Reset Rot" className="col-span-1 p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center"><RotateCcw className="w-3 h-3" /></button>
              </div>

              <div className="grid grid-cols-12 gap-1.5 items-center">
                <span className="col-span-2 font-bold text-amber-400 flex items-center justify-between pr-1">
                  <span>Scale:</span>
                </span>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-red-400 font-bold">X</span>
                  <input type="number" step="0.1" ref={scaleXRef} defaultValue={scale.x} onChange={(e) => { const n = { ...scale, x: parseFloat(e.target.value) || 1 }; setScale(n); applyTransform(pos, rot, n); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-emerald-400 font-bold">Y</span>
                  <input type="number" step="0.1" ref={scaleYRef} defaultValue={scale.y} onChange={(e) => { const n = { ...scale, y: parseFloat(e.target.value) || 1 }; setScale(n); applyTransform(pos, rot, n); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <span className="text-blue-400 font-bold">Z</span>
                  <input type="number" step="0.1" ref={scaleZRef} defaultValue={scale.z} onChange={(e) => { const n = { ...scale, z: parseFloat(e.target.value) || 1 }; setScale(n); applyTransform(pos, rot, n); }} className="w-full bg-transparent text-right font-mono text-white focus:outline-none" />
                </div>
                <button onClick={handleResetScale} title="Reset Scale" className="col-span-1 p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center"><RotateCcw className="w-3 h-3" /></button>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/80">
                <div className="flex gap-2">
                  <button onClick={() => { handleResetPos(); handleResetRot(); handleResetScale(); }} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px]">Reset All</button>
                  <button onClick={() => { if (selectedAsset) { selectedAsset.object3d.position.set(0, 1.5, 0); onUpdateAsset({ ...selectedAsset }); onBroadcastAssetUpdate?.(selectedAsset); } }} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px]">Center Pivot</button>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-slate-400 font-bold">Parent Under:</span>
                  <span
                    onClick={() => { /* Local context = current scene as-is; toggle is purely visual */ }}
                    title="Leave at current parent in scene graph"
                    className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold cursor-pointer hover:bg-cyan-500/30 transition"
                  >
                    Local User Space
                  </span>
                  <span
                    onClick={handleParentUnderWorld}
                    title="Reparent selected slot under the world / scene root"
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-amber-500/20 hover:border-amber-500/40 border border-transparent cursor-pointer transition"
                  >
                    World Root
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* COMPONENT 0: Resonite Light Source Component (Shown at top for light assets) */}
          {attachedComponents.includes('Light Source') && (
            <div className="bg-slate-950 rounded-xl border border-slate-700/80 overflow-hidden shadow-xl mb-3">
              {/* Resonite-style Light Component Header */}
              <div
                onClick={() => toggleSection('comp-Light Source')}
                className="px-3 py-2 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700 flex items-center justify-between cursor-pointer select-none hover:bg-slate-800/90 transition"
              >
                <div className="w-16" />
                <span className="font-black text-yellow-400 tracking-wider text-sm">Light</span>
                <div className="flex items-center gap-1.5 w-16 justify-end">
                  <button
                    title="Duplicate Light Config"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpdateLightConfig({ ...lightConfig });
                    }}
                    className="p-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/40 transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    title="Remove Light Component"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!interactive || !selectedAsset) return;
                      removeLightComponent(selectedAsset.object3d);
                      setAttachedComponents(attachedComponents.filter((c) => c !== 'Light Source'));
                      onUpdateAsset({ ...selectedAsset });
                      onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, resoniteLight: null });
                    }}
                    className="p-1 rounded bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 border border-rose-500/40 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {!collapsedSections['comp-Light Source'] && (
                <div className="p-2 bg-slate-950/90 divide-y divide-slate-800/60 text-xs">
                  {/* persistent */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-slate-300 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">persistent:</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={lightConfig.persistent}
                      onChange={(e) => handleUpdateLightConfig({ persistent: e.target.checked })}
                      className="w-4 h-4 rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-cyan-500 cursor-pointer"
                    />
                  </div>

                  {/* UpdateOrder */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-emerald-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">UpdateOrder:</span>
                    </div>
                    <input
                      type="number"
                      value={lightConfig.UpdateOrder}
                      onChange={(e) => handleUpdateLightConfig({ UpdateOrder: parseInt(e.target.value) || 0 })}
                      className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-right font-mono text-xs text-white"
                    />
                  </div>

                  {/* Enabled */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-slate-300 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">Enabled:</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={lightConfig.Enabled}
                      onChange={(e) => handleUpdateLightConfig({ Enabled: e.target.checked })}
                      className="w-4 h-4 rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-cyan-500 cursor-pointer"
                    />
                  </div>

                  {/* LightType */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-cyan-300 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">LightType:</span>
                    </div>
                    <select
                      value={lightConfig.LightType}
                      onChange={(e) =>
                        handleUpdateLightConfig({
                          LightType: e.target.value as 'Point' | 'Directional' | 'Spot',
                        })
                      }
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-semibold cursor-pointer"
                    >
                      <option value="Point">&lt;&lt; Point &gt;&gt;</option>
                      <option value="Directional">&lt;&lt; Directional &gt;&gt;</option>
                      <option value="Spot">&lt;&lt; Spot &gt;&gt;</option>
                    </select>
                  </div>

                  {/* Intensity */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-cyan-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">Intensity:</span>
                    </div>
                    <div className="flex items-center gap-2 max-w-[55%] w-full">
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.1"
                        value={lightConfig.Intensity}
                        onChange={(e) => handleUpdateLightConfig({ Intensity: parseFloat(e.target.value) })}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <input
                        type="number"
                        step="0.1"
                        value={lightConfig.Intensity}
                        onChange={(e) => handleUpdateLightConfig({ Intensity: parseFloat(e.target.value) || 0 })}
                        className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* Color & Profile */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-amber-500 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-amber-200">Color:</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400">Profile:</span>
                      <select
                        value={lightConfig.ColorProfile}
                        onChange={(e) =>
                          handleUpdateLightConfig({
                            ColorProfile: e.target.value as 'sRGB' | 'Linear',
                          })
                        }
                        className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white"
                      >
                        <option value="sRGB">&lt;&lt; sRGB &gt;&gt;</option>
                        <option value="Linear">&lt;&lt; Linear &gt;&gt;</option>
                      </select>
                      <input
                        type="color"
                        value={lightConfig.Color}
                        onChange={(e) => handleUpdateLightConfig({ Color: e.target.value })}
                        className="w-8 h-6 rounded bg-transparent border border-slate-600 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* ShadowType */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-slate-300 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">ShadowType:</span>
                    </div>
                    <select
                      value={lightConfig.ShadowType}
                      onChange={(e) =>
                        handleUpdateLightConfig({
                          ShadowType: e.target.value as 'None' | 'Hard' | 'Soft',
                        })
                      }
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-semibold cursor-pointer"
                    >
                      <option value="None">&lt;&lt; None &gt;&gt;</option>
                      <option value="Hard">&lt;&lt; Hard &gt;&gt;</option>
                      <option value="Soft">&lt;&lt; Soft &gt;&gt;</option>
                    </select>
                  </div>

                  {/* ShadowStrength */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-cyan-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">ShadowStrength:</span>
                    </div>
                    <div className="flex items-center gap-2 max-w-[55%] w-full">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={lightConfig.ShadowStrength}
                        onChange={(e) => handleUpdateLightConfig({ ShadowStrength: parseFloat(e.target.value) })}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <input
                        type="number"
                        step="0.05"
                        value={lightConfig.ShadowStrength}
                        onChange={(e) => handleUpdateLightConfig({ ShadowStrength: parseFloat(e.target.value) || 0 })}
                        className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* ShadowNearPlane */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-cyan-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">ShadowNearPlane:</span>
                    </div>
                    <div className="flex items-center gap-2 max-w-[55%] w-full">
                      <input
                        type="range"
                        min="0.01"
                        max="5"
                        step="0.05"
                        value={lightConfig.ShadowNearPlane}
                        onChange={(e) => handleUpdateLightConfig({ ShadowNearPlane: parseFloat(e.target.value) })}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <input
                        type="number"
                        step="0.05"
                        value={lightConfig.ShadowNearPlane}
                        onChange={(e) => handleUpdateLightConfig({ ShadowNearPlane: parseFloat(e.target.value) || 0.1 })}
                        className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* ShadowMapResolution */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-emerald-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">ShadowMapResolution:</span>
                    </div>
                    <select
                      value={lightConfig.ShadowMapResolution}
                      onChange={(e) =>
                        handleUpdateLightConfig({
                          ShadowMapResolution: parseInt(e.target.value) || 0,
                        })
                      }
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-semibold cursor-pointer"
                    >
                      <option value="0">0 (Auto)</option>
                      <option value="512">512px</option>
                      <option value="1024">1024px</option>
                      <option value="2048">2048px</option>
                      <option value="4096">4096px</option>
                    </select>
                  </div>

                  {/* ShadowBias */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-cyan-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">ShadowBias:</span>
                    </div>
                    <div className="flex items-center gap-2 max-w-[55%] w-full">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={lightConfig.ShadowBias}
                        onChange={(e) => handleUpdateLightConfig({ ShadowBias: parseFloat(e.target.value) })}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={lightConfig.ShadowBias}
                        onChange={(e) => handleUpdateLightConfig({ ShadowBias: parseFloat(e.target.value) || 0 })}
                        className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* ShadowNormalBias */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-cyan-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">ShadowNormalBias:</span>
                    </div>
                    <div className="flex items-center gap-2 max-w-[55%] w-full">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={lightConfig.ShadowNormalBias}
                        onChange={(e) => handleUpdateLightConfig({ ShadowNormalBias: parseFloat(e.target.value) })}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={lightConfig.ShadowNormalBias}
                        onChange={(e) => handleUpdateLightConfig({ ShadowNormalBias: parseFloat(e.target.value) || 0 })}
                        className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* Range */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-cyan-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">Range:</span>
                    </div>
                    <div className="flex items-center gap-2 max-w-[55%] w-full">
                      <input
                        type="range"
                        min="0.5"
                        max="100"
                        step="0.5"
                        value={lightConfig.Range}
                        onChange={(e) => handleUpdateLightConfig({ Range: parseFloat(e.target.value) })}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <input
                        type="number"
                        step="0.5"
                        value={lightConfig.Range}
                        onChange={(e) => handleUpdateLightConfig({ Range: parseFloat(e.target.value) || 1 })}
                        className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* SpotAngle */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-cyan-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">SpotAngle:</span>
                    </div>
                    <div className="flex items-center gap-2 max-w-[55%] w-full">
                      <input
                        type="range"
                        min="1"
                        max="180"
                        step="1"
                        disabled={lightConfig.LightType !== 'Spot'}
                        value={lightConfig.SpotAngle}
                        onChange={(e) => handleUpdateLightConfig({ SpotAngle: parseFloat(e.target.value) })}
                        className={`w-full accent-cyan-400 cursor-pointer ${lightConfig.LightType !== 'Spot' ? 'opacity-40' : ''}`}
                      />
                      <input
                        type="number"
                        step="1"
                        disabled={lightConfig.LightType !== 'Spot'}
                        value={lightConfig.SpotAngle}
                        onChange={(e) => handleUpdateLightConfig({ SpotAngle: parseFloat(e.target.value) || 60 })}
                        className={`w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs text-white ${lightConfig.LightType !== 'Spot' ? 'opacity-40' : ''}`}
                      />
                    </div>
                  </div>

                  {/* Cookie */}
                  <div className="flex items-center justify-between py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-3.5 border-l-2 border-t border-b border-purple-400 rounded-l-sm" />
                      <span className="font-mono text-xs font-semibold text-slate-300">Cookie:</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-slate-400 italic">
                        {lightConfig.Cookie ? 'Loaded' : 'null'}
                      </span>
                      {lightConfig.Cookie && (
                        <button
                          onClick={() => handleUpdateLightConfig({ Cookie: null })}
                          className="text-rose-400 hover:text-rose-300 p-0.5"
                          title="Clear Cookie Texture"
                        >
                          Ø
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* COMPONENT 1: StaticMesh / SkinnedMeshRenderer */}
          {meshStats.submeshes > 0 && meshStats.triangles > 0 && (
            <div className="bg-slate-900/80 rounded-xl border border-slate-700/80 overflow-hidden shadow-md">
              <div
                onClick={() => toggleSection('mesh')}
                className="px-3 py-2 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-800 flex items-center justify-between cursor-pointer select-none hover:bg-slate-800/60 transition"
              >
                <span className="font-bold text-amber-300 flex items-center gap-2">
                  <Box className="w-4 h-4 text-amber-400" />
                  <span>{meshStats.isSkinned ? 'SkinnedMeshRenderer & Armature' : 'StaticMesh Geometry'}</span>
                </span>
                <div className="flex gap-1.5 items-center">
                  <span className="text-[10px] text-slate-400">Order: 0</span>
                  <label className="flex items-center gap-1 cursor-pointer ml-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={meshEnabled}
                      onChange={(e) => handleToggleMeshEnabled(e.target.checked)}
                      className="accent-amber-500 rounded"
                    />
                    <span className="text-slate-300 font-bold">Enabled</span>
                  </label>
                  <button
                    title="Delete Mesh Helper (Preserves Light)"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteMeshGizmo();
                    }}
                    className="p-1 rounded bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 border border-rose-500/40 transition ml-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSection('mesh'); }}
                    className="p-0.5 rounded hover:bg-slate-700 text-slate-400 transition ml-1"
                  >
                    {collapsedSections['mesh'] ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
                  </button>
                </div>
              </div>

            {!collapsedSections['mesh'] && <div className="p-3 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">Shading:</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleUpdateMaterial('flatShading', false)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${!matProps.flatShading ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-slate-800 text-slate-400'}`}
                    >
                      Smooth
                    </button>
                    <button
                      onClick={() => handleUpdateMaterial('flatShading', true)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${matProps.flatShading ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-slate-400'}`}
                    >
                      Flat
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">Wireframe:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={matProps.wireframe}
                      onChange={(e) => handleUpdateMaterial('wireframe', e.target.checked)}
                      className="w-3.5 h-3.5 accent-cyan-500 rounded"
                    />
                    <span className="text-white font-bold">{matProps.wireframe ? 'ON' : 'OFF'}</span>
                  </label>
                </div>
              </div>

              {/* Resonite Mesh Statistics Box */}
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 text-center flex flex-col gap-1 font-mono text-[11px] text-slate-300 shadow-inner">
                <div className="text-slate-500 tracking-widest text-[9px] uppercase border-b border-slate-800 pb-1 mb-1">
                  ---------------- Mesh Statistics ----------------
                </div>
                {meshStats.isSkinned && (
                  <div className="bg-purple-950/60 p-2 rounded border border-purple-500/40 text-purple-200 text-[10px] mb-1 flex items-center justify-between">
                    <span>🦴 RootBone: <strong>{meshStats.rootBoneName}</strong></span>
                    <span className="px-1.5 py-0.2 rounded bg-purple-500/30 text-[9px] uppercase font-bold">Skinned ({meshStats.boneCount} Bones)</span>
                  </div>
                )}
                <div className="text-cyan-400 font-bold">Update Count: 1 &bull; Mode: {meshStats.isSkinned ? 'Deformable Skeleton' : 'Static Geometry'}</div>
                <div>Vertex Count: <span className="text-white font-bold">{meshStats.vertices}</span> &bull; Triangle Count: <span className="text-white font-bold">{meshStats.triangles}</span></div>
                <div>Submesh Count: <span className="text-white font-bold">{meshStats.submeshes}</span> &bull; Bone Count: <span className="text-purple-400 font-bold">{meshStats.boneCount}</span></div>
                <div className="text-[10px] text-slate-400 mt-1 pt-1 border-t border-slate-800">
                  Normals: <span className="text-emerald-400 font-bold">True</span>, Tangents: <span className="text-emerald-400 font-bold">True</span>, UV0: <span className="text-emerald-400 font-bold">True</span>, UV1: False
                </div>
              </div>
            </div>}
            </div>
          )}

          {/* COMPONENT 2: MeshRenderer / Material */}
          {meshStats.submeshes > 0 && meshStats.triangles > 0 && (
            <div className="bg-slate-900/80 rounded-xl border border-slate-700/80 overflow-hidden shadow-md">
              <div
              onClick={() => toggleSection('material')}
              className="px-3 py-2 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-800 flex items-center justify-between cursor-pointer select-none hover:bg-slate-800/60 transition"
            >
              <span className="font-bold text-emerald-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>MeshRenderer & Materials</span>
              </span>
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" defaultChecked className="accent-emerald-500 rounded" />
                  <span className="text-slate-300 font-bold">Enabled</span>
                </label>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSection('material'); }}
                  className="p-0.5 rounded hover:bg-slate-700 text-slate-400 transition"
                >
                  {collapsedSections['material'] ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {!collapsedSections['material'] && <div className="p-3 flex flex-col gap-3">
              {targetMaterials.length > 1 && (
                <div className="flex flex-col gap-1.5 bg-slate-950 p-2 rounded-lg border border-emerald-500/40">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                    Target Material ({targetMaterials.length} found on mesh):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {targetMaterials.map((m, idx) => (
                      <button
                        key={m.uuid}
                        onClick={() => setSelectedMaterialIndex(idx)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition border ${
                          selectedMaterialIndex === idx
                            ? 'bg-emerald-600 text-white border-emerald-400 shadow'
                            : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                        }`}
                      >
                        #{idx + 1}: {m.name || `Mat ${idx + 1}`}
                      </button>
                    ))}
                    <button
                      onClick={() => setSelectedMaterialIndex(-1)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition border ${
                        selectedMaterialIndex === -1
                          ? 'bg-cyan-600 text-white border-cyan-400'
                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      All Materials
                    </button>
                  </div>
                </div>
              )}
              {/* Resonite-style PBS Sliders & Color Properties */}
              <div className="flex flex-col gap-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-bold text-[11px]">AlbedoColor:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-white uppercase text-[10px]">{matProps.color}</span>
                      <input
                        type="color"
                        value={matProps.color}
                        onChange={(e) => handleUpdateMaterial('color', e.target.value)}
                        className="w-7 h-7 rounded border border-slate-600 bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-bold text-[11px]">EmissiveColor:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-white uppercase text-[10px]">{matProps.emissive}</span>
                      <input
                        type="color"
                        value={matProps.emissive}
                        onChange={(e) => handleUpdateMaterial('emissive', e.target.value)}
                        className="w-7 h-7 rounded border border-slate-600 bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-bold text-[11px]">NormalScale:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="3"
                        step="0.05"
                        value={matProps.normalScale}
                        onChange={(e) => handleUpdateMaterial('normalScale', parseFloat(e.target.value))}
                        className="w-24 accent-purple-400 cursor-pointer"
                      />
                      <span className="font-mono text-purple-300 font-bold text-[10px] w-8 text-right">{Number(matProps.normalScale).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-bold text-[11px]">Roughness:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={matProps.roughness}
                        onChange={(e) => handleUpdateMaterial('roughness', parseFloat(e.target.value))}
                        className="w-24 accent-purple-400 cursor-pointer"
                      />
                      <span className="font-mono text-white font-bold text-[10px] w-8 text-right">{Number(matProps.roughness).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-bold text-[11px]">Metallic:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={matProps.metalness}
                        onChange={(e) => handleUpdateMaterial('metalness', parseFloat(e.target.value))}
                        className="w-24 accent-purple-400 cursor-pointer"
                      />
                      <span className="font-mono text-white font-bold text-[10px] w-8 text-right">{Number(matProps.metalness).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-bold text-[11px]">Opacity:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={matProps.opacity}
                        onChange={(e) => handleUpdateMaterial('opacity', parseFloat(e.target.value))}
                        className="w-24 accent-purple-400 cursor-pointer"
                      />
                      <span className="font-mono text-white font-bold text-[10px] w-8 text-right">{Number(matProps.opacity).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-bold text-[11px]">EmissiveScale:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="5"
                        step="0.1"
                        value={matProps.emissiveIntensity}
                        onChange={(e) => handleUpdateMaterial('emissiveIntensity', parseFloat(e.target.value))}
                        className="w-24 accent-cyan-400 cursor-pointer"
                      />
                      <span className="font-mono text-cyan-300 font-bold text-[10px] w-8 text-right">{Number(matProps.emissiveIntensity).toFixed(1)}x</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-slate-300 font-bold text-[11px]">AOIntensity:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        value={matProps.aoMapIntensity}
                        onChange={(e) => handleUpdateMaterial('aoMapIntensity', parseFloat(e.target.value))}
                        className="w-24 accent-purple-400 cursor-pointer"
                      />
                      <span className="font-mono text-white font-bold text-[10px] w-8 text-right">{Number(matProps.aoMapIntensity).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/90 px-3 py-2 rounded-lg border border-slate-800 text-purple-300 font-bold text-xs flex items-center justify-between mt-1">
                <span>PBS Texture Maps & Shading Slots</span>
                <span className="text-[10px] text-slate-400 font-mono">Resonite PBS</span>
              </div>

              {/* Texture Map Slots (Resonite PBS layout with full readable titles & hidden file inputs) */}
              <div className="flex flex-col gap-2.5 pt-1">
                {[
                  { key: 'map', label: 'AlbedoTexture', subLabel: 'Base Color / Diffuse Map' },
                  { key: 'normalMap', label: 'NormalMap', subLabel: 'Surface Bump / Detail Map' },
                  { key: 'roughnessMap', label: 'RoughnessMap', subLabel: 'Microsurface Roughness' },
                  { key: 'metalnessMap', label: 'MetallicMap', subLabel: 'Surface Conductivity' },
                  { key: 'emissiveMap', label: 'EmissiveMap', subLabel: 'Self-Illumination / Glow' },
                  { key: 'aoMap', label: 'OcclusionMap', subLabel: 'Ambient Occlusion Shadowing' }
                ].map((slot) => {
                  return (
                    <div key={slot.key} className="flex flex-col gap-2 bg-slate-950/95 p-2.5 rounded-xl border border-slate-800/80 shadow-inner">
                      {/* Full readable label header with Resonite color accent */}
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-3.5 rounded-full bg-purple-400" />
                          <span className="text-xs font-bold text-white tracking-wide">{slot.label}</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">{slot.subLabel}</span>
                      </div>

                      {/* Preview + Actions Row */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {/* Thumbnail Status Card */}
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-lg bg-black/80 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                            <span className="text-[10px] font-bold italic text-slate-500">null</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold italic text-slate-300">null</span>
                            <span className="text-[9px] font-mono text-slate-500">---</span>
                          </div>
                        </div>

                        {/* Action Buttons Row */}
                        <div className="flex items-center gap-1.5 ml-auto">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenSlotDropdown(openSlotDropdown === `main_${slot.key}` ? null : `main_${slot.key}`);
                            }}
                            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-slate-200 text-[10px] font-bold rounded-lg px-2.5 py-1 flex items-center gap-1.5 transition"
                          >
                            <span>Choose Image ({imageAssets.length})</span>
                            <span className="text-[9px] text-cyan-400">▼</span>
                          </button>

                          <label className="px-2.5 py-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/40 rounded-lg text-[10px] font-bold cursor-pointer transition">
                            <span>Upload</span>
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  const reader = new FileReader();
                                  reader.onload = () => {
                                    if (typeof reader.result === 'string') {
                                      handleApplyTextureSlot(slot.key, reader.result);
                                    }
                                  };
                                  reader.readAsDataURL(f);
                                }
                              }}
                            />
                          </label>

                          <button
                            onClick={() => handleApplyTextureSlot(slot.key, null)}
                            className="px-2 py-1 bg-red-900/30 hover:bg-red-800/50 text-red-300 border border-red-700/50 rounded-lg text-[10px] font-bold transition"
                            title="Clear texture slot"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      {openSlotDropdown === `main_${slot.key}` && (
                        <div className="p-2 bg-slate-900 border border-cyan-500/40 rounded-lg shadow-lg flex flex-col gap-1 max-h-36 overflow-y-auto">
                          <div className="text-[10px] font-bold text-slate-400 pb-1 border-b border-slate-800 flex items-center justify-between">
                            <span>Select Imported Image Asset</span>
                            <button
                              onClick={() => setOpenSlotDropdown(null)}
                              className="text-slate-400 hover:text-rose-400 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                          {imageAssets.length === 0 ? (
                            <div className="py-1.5 text-[10px] text-slate-400 italic">
                              No imported images found. Click &quot;Upload&quot; to import an image!
                            </div>
                          ) : (
                            imageAssets.map((img) => (
                              <button
                                key={img.id}
                                onClick={() => {
                                  handleApplyTextureSlot(slot.key, img.url || null);
                                  setOpenSlotDropdown(null);
                                }}
                                className="flex items-center justify-between px-2 py-1 rounded bg-slate-950/60 hover:bg-cyan-500/20 text-left transition border border-transparent hover:border-cyan-500/30"
                              >
                                <span className="text-[10px] font-semibold text-slate-200 truncate max-w-[180px]">
                                  {img.name}
                                </span>
                                <span className="text-[9px] font-mono text-cyan-400">Apply</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>}
            </div>
          )}

          {/* COMPONENT 0: Video Controls (only rendered when the selected asset is a video).
              Positioned at the top so it's the first thing the user sees after
              Slot Header. Asset type drives inclusion so non-video assets don't
              render an empty video card. The component is dumb — it just emits
              callbacks that App.tsx forwards to AssetManager.applyVideoState +
              NetworkService.broadcastVideoState. */}
          {selectedAsset?.type === 'video' && videoActions && (
            <VideoControls
              state={((selectedAsset.object3d.userData as { videoState?: import('../engine/AssetManager.ts').VideoPlaybackState }).videoState) ?? {
                playing: false,
                currentTime: 0,
                duration: 0,
                globalVolume: 0.8,
                localVolume: 0.8,
                volumeMode: 'global',
                muted: true,
              }}
              onPlay={videoActions.onPlay}
              onPause={videoActions.onPause}
              onSeek={videoActions.onSeek}
              onStep={videoActions.onStep}
              onVolumeChange={videoActions.onVolumeChange}
              onVolumeModeToggle={videoActions.onVolumeModeToggle}
              onMuteToggle={videoActions.onMuteToggle}
              onClose={videoActions.onClose}
              compact={true}
            />
          )}

          {/* COMPONENT 3: StaticTexture2D */}
          {meshStats.submeshes > 0 && meshStats.triangles > 0 && (
            <div className="bg-slate-900/80 rounded-xl border border-slate-700/80 overflow-hidden shadow-md">
              <div
              onClick={() => toggleSection('texture')}
              className="px-3 py-2 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-800 flex items-center justify-between cursor-pointer select-none hover:bg-slate-800/60 transition"
            >
              <span className="font-bold text-cyan-300 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-cyan-400" />
                <span>StaticTexture2D / Albedo Surface Map</span>
              </span>
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" defaultChecked className="accent-cyan-500 rounded" />
                  <span className="text-slate-300 font-bold">Enabled</span>
                </label>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSection('texture'); }}
                  className="p-0.5 rounded hover:bg-slate-700 text-slate-400 transition"
                >
                  {collapsedSections['texture'] ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {!collapsedSections['texture'] && <div className="p-3 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">FilterMode:</span>
                  <select
                    value={texProps.filterMode}
                    onChange={(e) => {
                      setTexProps({ ...texProps, filterMode: e.target.value });
                      if (selectedAsset) {
                        selectedAsset.object3d.traverse((c) => {
                          const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
                          if (m && m.map) {
                            m.map.minFilter = e.target.value.includes('Point') ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
                            m.map.magFilter = e.target.value.includes('Point') ? THREE.NearestFilter : THREE.LinearFilter;
                            m.map.needsUpdate = true;
                          }
                        });
                      }
                    }}
                    className="bg-slate-900 border border-slate-700 rounded text-cyan-300 font-bold text-[10px] px-1 py-0.5"
                  >
                    <option value="Bilinear / Trilinear">Trilinear (Smooth)</option>
                    <option value="Point / Nearest">Point / Nearest (Pixel)</option>
                    <option value="Anisotropic 8x">Anisotropic 8x</option>
                    <option value="Anisotropic 16x">Anisotropic 16x</option>
                  </select>
                </div>

                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">Anisotropic Level:</span>
                  <input
                    type="range" min="1" max="16" step="1"
                    value={texProps.anisotropic}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      setTexProps({ ...texProps, anisotropic: v });
                      if (selectedAsset) {
                        selectedAsset.object3d.traverse((c) => {
                          const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
                          if (m && m.map) { m.map.anisotropy = v; m.map.needsUpdate = true; }
                        });
                      }
                    }}
                    className="w-20 accent-cyan-400 cursor-pointer"
                  />
                  <span className="font-mono text-white text-[10px] w-4 text-right">{texProps.anisotropic}x</span>
                </div>

                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">WrapMode U/V:</span>
                  <div className="flex gap-1">
                    {['Repeat', 'Clamp', 'Mirror'].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setTexProps({ ...texProps, wrapU: mode, wrapV: mode });
                          if (selectedAsset) {
                            selectedAsset.object3d.traverse((c) => {
                              const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
                              if (m && m.map) {
                                const w = mode === 'Repeat' ? THREE.RepeatWrapping : mode === 'Clamp' ? THREE.ClampToEdgeWrapping : THREE.MirroredRepeatWrapping;
                                m.map.wrapS = w; m.map.wrapT = w; m.map.needsUpdate = true;
                              }
                            });
                          }
                        }}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${texProps.wrapU === mode ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-slate-800 text-slate-400'}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">MipMaps & Raw:</span>
                  <div className="flex gap-2">
                    <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={texProps.mipmaps} onChange={(e) => setTexProps({...texProps, mipmaps: e.target.checked})} className="accent-cyan-400 rounded w-3 h-3" /><span>MipMaps</span></label>
                    <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={texProps.uncompressed} onChange={(e) => setTexProps({...texProps, uncompressed: e.target.checked})} className="accent-cyan-400 rounded w-3 h-3" /><span>Raw</span></label>
                  </div>
                </div>
              </div>

              {/* Texture Utility Action Buttons */}
              <div className="space-y-1 pt-1 border-t border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Texture Operations & Methods</span>
                <div className="grid grid-cols-4 gap-1.5 font-mono text-[10px]">
                  {[
                    { label: 'Flip Horiz()', act: () => { if (selectedAsset) selectedAsset.object3d.traverse(c => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.map) { m.map.repeat.x *= -1; m.map.needsUpdate = true; } }); } },
                    { label: 'Flip Vert()', act: () => { if (selectedAsset) selectedAsset.object3d.traverse(c => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.map) { m.map.repeat.y *= -1; m.map.needsUpdate = true; } }); } },
                    { label: 'Rotate90CW()', act: () => { if (selectedAsset) selectedAsset.object3d.traverse(c => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.map) { m.map.rotation += Math.PI/2; m.map.needsUpdate = true; } }); } },
                    { label: 'Rotate180()', act: () => { if (selectedAsset) selectedAsset.object3d.traverse(c => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.map) { m.map.rotation += Math.PI; m.map.needsUpdate = true; } }); } },
                    { label: 'MakeTileable()', act: () => { if (selectedAsset) selectedAsset.object3d.traverse(c => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.map) { m.map.wrapS = THREE.RepeatWrapping; m.map.wrapT = THREE.RepeatWrapping; m.map.repeat.set(2, 2); m.map.needsUpdate = true; } }); } },
                    { label: 'InvertRGB()', act: () => { if (selectedAsset) selectedAsset.object3d.traverse(c => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.color) { m.color.set((0xffffff - m.color.getHex()) || 0xff00ff); m.needsUpdate = true; } }); } },
                    { label: 'Grayscale()', act: () => { if (selectedAsset) selectedAsset.object3d.traverse(c => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.color) { const g = (m.color.r + m.color.g + m.color.b)/3; m.color.setRGB(g,g,g); m.needsUpdate = true; } }); } },
                    { label: 'BleedAlpha()', act: () => { if (selectedAsset) selectedAsset.object3d.traverse(c => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m) { m.transparent = true; m.opacity = 0.85; m.needsUpdate = true; } }); } },
                  ].map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      onClick={btn.act}
                      className="p-1 rounded bg-slate-950 hover:bg-cyan-500/20 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 font-semibold truncate transition text-center"
                      title={btn.label}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>}
            </div>
          )}

          {/* COMPONENT 3+: Custom Attached Components */}
          {attachedComponents
            .filter((comp) => comp !== 'Light Source')
            .map((comp) => (
              <div key={comp} className="bg-slate-900/80 rounded-xl border border-purple-500/40 overflow-hidden shadow-md">
                <div
                  onClick={() => toggleSection(`comp-${comp}`)}
                  className="px-3 py-2 bg-gradient-to-r from-purple-950/60 via-slate-900 to-purple-950/60 border-b border-purple-500/30 flex items-center justify-between cursor-pointer select-none hover:bg-purple-950/40 transition"
                >
                  <span className="font-bold text-purple-300 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-400" />
                    <span>Component: {comp}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSection(`comp-${comp}`); }}
                      className="p-0.5 rounded hover:bg-slate-700 text-slate-400 transition"
                    >
                      {collapsedSections[`comp-${comp}`] ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setAttachedComponents(attachedComponents.filter(c => c !== comp)); }} className="text-slate-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {!collapsedSections[`comp-${comp}`] && (
                  <div className="p-3 text-slate-300 text-xs">
                    {comp === 'Rotator Script' && <p>Rotator behavior running: Yaw +1.5 rad/sec</p>}
                    {comp === 'Bobbing / Float' && <p>Floating hover animation active (2.0 Hz)</p>}
                    {comp === 'Positional Audio' && <p>Audio emitter configured with 3D falloff (Ref: 2m, Max: 20m)</p>}
                  </div>
                )}
              </div>
            ))}

          {/* ATTACH COMPONENT BUTTON */}
          <div className="relative mt-2">
            <button
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 border border-cyan-500/40 text-cyan-300 font-extrabold flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-500/10"
            >
              <Plus className="w-4 h-4 text-cyan-400" />
              <span className="text-sm tracking-wide">Attach Component</span>
            </button>

            {showAttachMenu && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-900 border border-cyan-500/60 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.8)] p-2 grid grid-cols-2 gap-1.5 z-50 animate-in fade-in slide-in-from-bottom-2">
                {[
                  { name: 'Light Source', desc: 'Point/Spot illumination' },
                  { name: 'Rotator Script', desc: 'Continuous spinning' },
                  { name: 'Bobbing / Float', desc: 'Hover animation' },
                  { name: 'Positional Audio', desc: '3D spatial sound' },
                  { name: 'Physics Collider', desc: 'Solid bounding box' },
                  { name: 'Particle Emitter', desc: 'Sparkles & dust effects' }
                ].map((item) => (
                  <div
                    key={item.name}
                    onClick={() => handleAttachComponent(item.name)}
                    className="p-2 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 border border-slate-700 hover:border-cyan-500/50 cursor-pointer transition flex flex-col"
                  >
                    <span className="font-bold text-white">{item.name}</span>
                    <span className="text-[10px] text-slate-400">{item.desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Separate Floating Material Properties & PBR Texture Inspector Window */}
      {showMaterialModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto">
          <div className="w-[520px] max-h-[85vh] bg-slate-900 border border-emerald-500/60 rounded-2xl shadow-[0_0_50px_rgba(16,185,129,0.3)] flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 border-b border-emerald-500/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-emerald-300">
                  Material & PBR Texture Inspector — {selectedAsset?.name || 'Selected Asset'}
                </h3>
              </div>
              <button
                onClick={() => setShowMaterialModal(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex flex-col gap-4">
              {targetMaterials.length > 1 && (
                <div className="flex flex-col gap-2 bg-slate-950 p-2.5 rounded-xl border border-emerald-500/50">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    Target Material ({targetMaterials.length} found on mesh):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {targetMaterials.map((m, idx) => (
                      <button
                        key={m.uuid}
                        onClick={() => setSelectedMaterialIndex(idx)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border ${
                          selectedMaterialIndex === idx
                            ? 'bg-emerald-600 text-white border-emerald-400 shadow'
                            : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                        }`}
                      >
                        #{idx + 1}: {m.name || `Mat ${idx + 1}`}
                      </button>
                    ))}
                    <button
                      onClick={() => setSelectedMaterialIndex(-1)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border ${
                        selectedMaterialIndex === -1
                          ? 'bg-cyan-600 text-white border-cyan-400'
                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      All Materials
                    </button>
                  </div>
                </div>
              )}
              {/* Scalar PBR Properties */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">Base Color:</span>
                  <input
                    type="color"
                    value={matProps.color}
                    onChange={(e) => handleUpdateMaterial('color', e.target.value)}
                    className="w-8 h-8 rounded border border-slate-600 bg-transparent cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">NormalScale:</span>
                  <input
                    type="range"
                    min="0" max="3" step="0.05"
                    value={matProps.normalScale}
                    onChange={(e) => handleUpdateMaterial('normalScale', parseFloat(e.target.value))}
                    className="w-24 accent-purple-400 cursor-pointer"
                  />
                  <span className="font-mono text-xs text-purple-300">{Number(matProps.normalScale).toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">Roughness:</span>
                  <input
                    type="range"
                    min="0" max="1" step="0.05"
                    value={matProps.roughness}
                    onChange={(e) => handleUpdateMaterial('roughness', parseFloat(e.target.value))}
                    className="w-24 accent-emerald-400 cursor-pointer"
                  />
                  <span className="font-mono text-xs text-white">{matProps.roughness}</span>
                </div>
                <div className="flex items-center justify-between bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">Metalness:</span>
                  <input
                    type="range"
                    min="0" max="1" step="0.05"
                    value={matProps.metalness}
                    onChange={(e) => handleUpdateMaterial('metalness', parseFloat(e.target.value))}
                    className="w-24 accent-emerald-400 cursor-pointer"
                  />
                  <span className="font-mono text-xs text-white">{matProps.metalness}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">Opacity:</span>
                  <input
                    type="range"
                    min="0" max="1" step="0.05"
                    value={matProps.opacity}
                    onChange={(e) => handleUpdateMaterial('opacity', parseFloat(e.target.value))}
                    className="w-24 accent-emerald-400 cursor-pointer"
                  />
                  <span className="font-mono text-xs text-white">{matProps.opacity}</span>
                </div>
                <div className="flex items-center justify-between bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">AOIntensity:</span>
                  <input
                    type="range"
                    min="0" max="2" step="0.05"
                    value={matProps.aoMapIntensity}
                    onChange={(e) => handleUpdateMaterial('aoMapIntensity', parseFloat(e.target.value))}
                    className="w-24 accent-purple-400 cursor-pointer"
                  />
                  <span className="font-mono text-xs text-white">{Number(matProps.aoMapIntensity).toFixed(2)}</span>
                </div>
              </div>

              {/* Texture Map Slots Header */}
              <div className="border-t border-slate-800 pt-3">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2.5">
                  PBR Texture Slots (Albedo, Normal, Roughness, Metalness, Emission, AO)
                </h4>
                <div className="flex flex-col gap-2.5">
                  {[
                    { key: 'map', label: 'Albedo (Base Color)' },
                    { key: 'normalMap', label: 'Normal Map' },
                    { key: 'roughnessMap', label: 'Roughness Map' },
                    { key: 'metalnessMap', label: 'Metalness Map' },
                    { key: 'emissiveMap', label: 'Emission Map' },
                    { key: 'aoMap', label: 'AO (Ambient Occlusion)' }
                  ].map((slot) => (
                    <div key={slot.key} className="flex flex-col gap-2 bg-slate-950 px-3 py-2.5 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">{slot.label}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenSlotDropdown(openSlotDropdown === `modal_${slot.key}` ? null : `modal_${slot.key}`);
                            }}
                            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-slate-300 text-xs rounded-lg px-2.5 py-1 flex items-center gap-1.5 transition max-w-[160px]"
                          >
                            <span className="truncate">Choose Image ({imageAssets.length})</span>
                            <span className="text-[10px] text-cyan-400">▼</span>
                          </button>
                          <label className="px-3 py-1 bg-emerald-600/40 hover:bg-emerald-600/60 text-emerald-300 border border-emerald-500/50 rounded-lg text-xs font-bold cursor-pointer transition">
                            Upload File
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  const reader = new FileReader();
                                  reader.onload = () => {
                                    if (typeof reader.result === 'string') {
                                      handleApplyTextureSlot(slot.key, reader.result);
                                    }
                                  };
                                  reader.readAsDataURL(f);
                                }
                              }}
                            />
                          </label>
                          <button
                            onClick={() => handleApplyTextureSlot(slot.key, null)}
                            className="px-2.5 py-1 bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-700/50 rounded-lg text-xs font-bold transition"
                            title="Clear texture map"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      {openSlotDropdown === `modal_${slot.key}` && (
                        <div className="p-2 bg-slate-900 border border-cyan-500/40 rounded-xl shadow-lg flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                          <div className="text-xs font-bold text-slate-400 pb-1 border-b border-slate-800 flex items-center justify-between">
                            <span>Select Imported Image Asset</span>
                            <button
                              onClick={() => setOpenSlotDropdown(null)}
                              className="text-slate-400 hover:text-rose-400 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                          {imageAssets.length === 0 ? (
                            <div className="py-2 px-1 text-xs text-slate-400 italic">
                              No imported images found. Click &quot;Upload File&quot; next to this slot to import one directly!
                            </div>
                          ) : (
                            imageAssets.map((img) => (
                              <button
                                key={img.id}
                                onClick={() => {
                                  handleApplyTextureSlot(slot.key, img.url || null);
                                  setOpenSlotDropdown(null);
                                }}
                                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-950/60 hover:bg-cyan-500/20 text-left transition border border-transparent hover:border-cyan-500/30"
                              >
                                <span className="text-xs font-semibold text-slate-200 truncate max-w-[220px]">
                                  {img.name}
                                </span>
                                <span className="text-[10px] font-mono text-cyan-400">Apply</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </SpatialPopUpWrapper>
  );
};