import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SpatialPopUpWrapper } from './SpatialPopUpWrapper.tsx';
import type { LoadedAsset, AssetManager } from '../engine/AssetManager.ts';
import type { SpatialPanelManager } from '../engine/SpatialPanelManager.ts';
import { VideoControls } from './VideoControls.tsx';
import {
  Trash2, RotateCcw, ArrowUpRight, Magnet, Plus,
  Box, Layers, Sparkles, Activity, ChevronRight, ChevronDown, Minimize2, Maximize2, Image as ImageIcon, Eye
} from 'lucide-react';

export interface SceneInspectorWindowProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAsset: LoadedAsset | null;
  onUpdateAsset: (asset: LoadedAsset) => void;
  onDeleteAsset: (id: string) => void;
  onJumpToAsset: (asset: LoadedAsset) => void;
  onBringAsset: (asset: LoadedAsset) => void;
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  assetManager?: AssetManager;
  spatialPanelManager?: SpatialPanelManager;
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
  onUpdateAsset,
  onDeleteAsset,
  onJumpToAsset,
  onBringAsset,
  scene,
  camera,
  assetManager,
  spatialPanelManager,
  videoActions,
  targetObject,
  interactivePermissionGranted,
  originatorHeader,
}) => {
  // Mirror of the prop with a default so we don't sprinkle `?? true`
  // checks across the JSX. The defaults preserve the pre-broadcast
  // behaviour: panel is fully interactive, asset docks via default
  // propping the spatial wrapper's parentObject to selectedAsset?.object3d.
  const interactive = interactivePermissionGranted ?? true;
  const dockTarget = targetObject ?? selectedAsset?.object3d ?? undefined;

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
    vertices: 24,
    triangles: 12,
    submeshes: 1,
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
    wireframe: false,
    flatShading: false,
    shadowCast: true
  });

  // Custom components attached
  const [attachedComponents, setAttachedComponents] = useState<string[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('root');

  // Hierarchy-tree state. selectedNodeUUID identifies the Object3D row
  // the user clicked in the left pane, expandedNodes remembers which
  // tree branches are unfolded across renders, and inspectorRootUUID
  // optionally scopes the visible tree to a chosen sub-slot (the
  // "Set Root" action from SceneInspector.txt). UUID addressing lets
  // us round-trip back to a Three node for the destructive and
  // reparenting actions without storing Object3D refs in React state.
  const [selectedNodeUUID, setSelectedNodeUUID] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [inspectorRootUUID, setInspectorRootUUID] = useState<string | null>(null);

  // Collapsible component sections
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [openSlotDropdown, setOpenSlotDropdown] = useState<string | null>(null);
  const [showHierarchy, setShowHierarchy] = useState(false);
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

  // Light selection sync — runs once per asset change. Holds the source-of-
  // truth state for the Reset buttons and applyTransform defaults; the
  // numeric inputs below are imperatively synced by a separate rAF loop.
  useEffect(() => {
    if (!selectedAsset) return;
    setAssetName(selectedAsset.name);
    setActive(selectedAsset.object3d.visible);
    // Re-read the persistent bit from userData on every selection
    // change. `userData.isPersistent` is the source of truth — the
    // inspector checkbox writes it on toggle, the network broadcast
    // mirror in applyRemoteTransform writes it on receive. Defaulting
    // to `true` (matches every primitive's default in this codebase)
    // means a guest opening the inspector on a spawn asset that hasn't
    // had isPersistent broadcast yet still shows the host's intent.
    setPersistent(((selectedAsset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined) ?? true);
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

  // Heavy meshStats + initial material props: full scene-graph traverse.
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
        submeshes++;
        const mesh = child as THREE.Mesh;
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          isSkinned = true;
          boneCount = (child as THREE.SkinnedMesh).skeleton?.bones?.length || 15;
          rootBoneName = (child as THREE.SkinnedMesh).skeleton?.bones?.[0]?.name || 'RootBone';
        }
        if (mesh.geometry) {
          const posAttr = mesh.geometry.attributes.position;
          if (posAttr) verts += posAttr.count;
          if (mesh.geometry.index) {
            tris += mesh.geometry.index.count / 3;
          } else if (posAttr) {
            tris += posAttr.count / 3;
          }
          if (mesh.geometry.attributes.normal) normals = true;
          if (mesh.geometry.attributes.uv) uv = true;
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
    });

    setMeshStats({
      vertices: verts || 24,
      triangles: Math.floor(tris) || 12,
      submeshes: submeshes || 1,
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

  // Auto-close when the inspected asset disappears (delete, network remove,
  // or explicit deselect). We only close if we previously had a selection,
  // so opening the inspector with no asset still works.
  useEffect(() => {
    if (isOpen && selectedAsset) {
      hadSelectionRef.current = true;
    } else if (isOpen && !selectedAsset && hadSelectionRef.current) {
      hadSelectionRef.current = false;
      onClose();
    }
  }, [isOpen, selectedAsset, onClose]);

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
  }, [selectedAsset?.id]);  const applyTransform = (newPos = pos, newRot = rot, newScale = scale) => {
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

    const allMats = getTargetMaterials();
    const targetMats = selectedMaterialIndex >= 0 && allMats[selectedMaterialIndex]
      ? [allMats[selectedMaterialIndex]]
      : allMats;

    targetMats.forEach((m) => {
      if (key === 'color') m.color.set(val);
      if (key === 'roughness') m.roughness = val;
      if (key === 'metalness') m.metalness = val;
      if (key === 'emissive') {
        m.emissive.set(val);
        m.emissiveIntensity = next.emissiveIntensity || 1.0;
      }
      if (key === 'emissiveIntensity') m.emissiveIntensity = val;
      if (key === 'opacity') {
        m.opacity = val;
        m.transparent = val < 1.0;
      }
      if (key === 'wireframe') m.wireframe = val;
      if (key === 'flatShading') {
        m.flatShading = val;
        m.needsUpdate = true;
      }
    });
    onUpdateAsset({ ...selectedAsset });
  };

  const imageAssets = assetManager ? Array.from(assetManager.assets.values()).filter((a) => a.type === 'image') : [];

  const handleApplyTextureSlot = (slotName: string, url: string | null) => {
    if (!selectedAsset) return;
    const allMats = getTargetMaterials();
    const targetMats = selectedMaterialIndex >= 0 && allMats[selectedMaterialIndex]
      ? [allMats[selectedMaterialIndex]]
      : allMats;

    if (!url) {
      targetMats.forEach((m) => {
        (m as any)[slotName] = null;
        m.needsUpdate = true;
      });
      onUpdateAsset({ ...selectedAsset });
      return;
    }
    new THREE.TextureLoader().load(url, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      if (slotName === 'map' || slotName === 'emissiveMap') {
        tex.colorSpace = THREE.SRGBColorSpace;
      }
      targetMats.forEach((m) => {
        (m as any)[slotName] = tex;
        m.needsUpdate = true;
      });
      onUpdateAsset({ ...selectedAsset });
    });
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
      const light = new THREE.PointLight('#00f0ff', 2.0, 10);
      light.position.set(0, 1.2, 0);
      selectedAsset.object3d.add(light);
    } else if (compType === 'Rotator Script') {
      // Add custom userData to drive rotation in SceneEngine
      selectedAsset.object3d.userData.rotatorSpeed = { x: 0, y: 1.5, z: 0 };
    } else if (compType === 'Bobbing / Float') {
      selectedAsset.object3d.userData.bobbingSpeed = 2.0;
    }
    onUpdateAsset({ ...selectedAsset });
  };

  // Recursively resolve a Three Object3D by uuid inside the loaded
  // asset's subtree. Returns null when uuid doesn't match; fallback
  // callers always default to the asset root when this fires.
  const findObjectByUUID = (root: THREE.Object3D, uuid: string | null): THREE.Object3D | null => {
    if (!uuid) return null;
    if (root.uuid === uuid) return root;
    for (const child of root.children) {
      const found = findObjectByUUID(child, uuid);
      if (found) return found;
    }
    return null;
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
  };

  // Scope the left-pane tree to a chosen descendant — useful for deep
  // hierarchies where the top-level name list gets unreadable.
  const handleSetInspectorRoot = () => {
    if (!selectedNodeUUID) return;
    setInspectorRootUUID(selectedNodeUUID);
  };

  const handleResetInspectorRoot = () => {
    setInspectorRootUUID(null);
  };

  // Reparent the selected node so it sits directly under the scene
  // root (Three.Object3D.attach() preserves world pose).
  const handleParentUnderWorld = () => {
    if (!interactive) return;
    if (!selectedAsset || !scene) return;
    const target = findObjectByUUID(selectedAsset.object3d, selectedNodeUUID) ?? selectedAsset.object3d;
    scene.attach(target);
    onUpdateAsset({ ...selectedAsset });
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
      defaultWidth={500}
      defaultHeight={740}
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
      <div className="flex flex-col gap-2.5 font-sans text-xs select-none" style={{ height: '620px' }}>
        {/* COMPACT HIERARCHY / PATH BAR (Collapsible Top Section) */}
        <div className={`bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col gap-2 ${
          !interactive ? 'pointer-events-none opacity-80' : ''
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setShowHierarchy(!showHierarchy)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-[11px] flex items-center gap-1.5 transition shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{showHierarchy ? 'Hide Hierarchy Tree' : 'Show Hierarchy Tree'}</span>
              </button>
              <span className="font-bold text-slate-300 font-mono text-[11px] truncate">
                {inspectorRootUUID
                  ? <>View: <span className="text-amber-300 normal-case">{findObjectByUUID(selectedAsset?.object3d ?? new THREE.Object3D(), inspectorRootUUID)?.name || '...'}</span></>
                  : <>Root: <span className="text-amber-300 normal-case">{assetName}</span></>}
              </span>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => setShowMaterialModal(true)}
                className="px-2.5 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-[11px] font-bold shadow transition flex items-center gap-1.5"
                title="Open floating Material & Textures Editor window"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Open Material Editor
              </button>
              {inspectorRootUUID && (
                <button
                  onClick={handleResetInspectorRoot}
                  title="Back to top of hierarchy (Top)"
                  className="p-1.5 rounded bg-slate-800 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 transition"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleSetInspectorRoot}
                disabled={!selectedNodeUUID}
                title="Set selected as visible hierarchy root (Set Root)"
                className="p-1.5 rounded bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 disabled:opacity-30 disabled:hover:bg-slate-800 transition"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {showHierarchy && (
            <div className="flex flex-col gap-1 mt-1 max-h-48 overflow-y-auto border-t border-slate-800 pt-2 custom-scrollbar">
              <div
                onClick={() => setSelectedNodeId('root')}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer font-bold transition ${
                  selectedNodeId === 'root' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-300 hover:bg-slate-900'
                }`}
              >
                <Box className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">&bull; {assetName}</span>
              </div>

              {(() => {
                if (!selectedAsset) return null;
                const visibleRoot = inspectorRootUUID
                  ? (findObjectByUUID(selectedAsset.object3d, inspectorRootUUID) ?? selectedAsset.object3d)
                  : selectedAsset.object3d;
                if (!visibleRoot) return null;
                const renderNode = (node: THREE.Object3D, depth: number): React.ReactNode => {
                  const expanded = expandedNodes.has(node.uuid);
                  const highlight = selectedNodeUUID === node.uuid;
                  const isNonPersistent = node.userData?.isPersistent === false;
                  return (
                    <div key={node.uuid}>
                      <div
                        onClick={() => setSelectedNodeUUID(node.uuid)}
                        style={{ paddingLeft: `${depth * 12 + 4}px` }}
                        className={`flex items-center gap-1.5 py-0.5 pr-1.5 rounded text-[11px] cursor-pointer transition ${
                          highlight
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
                  onChange={(e) => { setAssetName(e.target.value); if (selectedAsset) { selectedAsset.name = e.target.value; onUpdateAsset({ ...selectedAsset }); } }}
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
                    onChange={(e) => { setActive(e.target.checked); if (selectedAsset) { selectedAsset.object3d.visible = e.target.checked; onUpdateAsset({ ...selectedAsset }); } }}
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
                      if (selectedAsset) {
                        selectedAsset.object3d.userData.isPersistent = e.target.checked;
                        onUpdateAsset({ ...selectedAsset });
                      }
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
                  <button onClick={() => { if (selectedAsset) { selectedAsset.object3d.position.set(0, 1.5, 0); onUpdateAsset({ ...selectedAsset }); } }} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px]">Center Pivot</button>
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

          {/* COMPONENT 1: StaticMesh / SkinnedMeshRenderer */}
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
                  <input type="checkbox" defaultChecked className="accent-amber-500 rounded" />
                  <span className="text-slate-300 font-bold">Enabled</span>
                </label>
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

          {/* COMPONENT 2: MeshRenderer / Material */}
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
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">Base Color:</span>
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

                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">Roughness:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={matProps.roughness}
                    onChange={(e) => handleUpdateMaterial('roughness', parseFloat(e.target.value))}
                    className="w-24 accent-emerald-400 cursor-pointer"
                  />
                  <span className="font-mono text-white text-[10px] w-6 text-right">{matProps.roughness}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">Metalness:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={matProps.metalness}
                    onChange={(e) => handleUpdateMaterial('metalness', parseFloat(e.target.value))}
                    className="w-24 accent-emerald-400 cursor-pointer"
                  />
                  <span className="font-mono text-white text-[10px] w-6 text-right">{matProps.metalness}</span>
                </div>

                <div className="flex items-center justify-between bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-semibold">Opacity:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={matProps.opacity}
                    onChange={(e) => handleUpdateMaterial('opacity', parseFloat(e.target.value))}
                    className="w-24 accent-emerald-400 cursor-pointer"
                  />
                  <span className="font-mono text-white text-[10px] w-6 text-right">{matProps.opacity}</span>
                </div>
              </div>

              <div className="flex items-center justify-between bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800">
                <span className="text-slate-400 font-semibold">Emissive Glow:</span>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={matProps.emissive}
                    onChange={(e) => handleUpdateMaterial('emissive', e.target.value)}
                    className="w-7 h-7 rounded border border-slate-600 bg-transparent cursor-pointer"
                  />
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.1"
                    value={matProps.emissiveIntensity}
                    onChange={(e) => handleUpdateMaterial('emissiveIntensity', parseFloat(e.target.value))}
                    className="w-24 accent-cyan-400 cursor-pointer"
                  />
                  <span className="font-mono text-cyan-300 font-bold text-[10px] w-8">{matProps.emissiveIntensity}x</span>
                </div>
              </div>

              <div className="flex items-center justify-between bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800">
                <span className="text-slate-300 font-bold text-xs">PBR Material Properties & Textures</span>
                <button
                  onClick={() => setShowMaterialModal(true)}
                  className="px-2.5 py-1 bg-emerald-600/40 hover:bg-emerald-600/60 text-emerald-300 rounded border border-emerald-500/50 text-[11px] font-bold transition flex items-center gap-1.5"
                >
                  <Sparkles className="w-3 h-3" />
                  Open Material Editor
                </button>
              </div>

              {/* Texture Map Slots */}
              <div className="flex flex-col gap-2 pt-1">
                {[
                  { key: 'map', label: 'Albedo (Base Color)' },
                  { key: 'normalMap', label: 'Normal Map' },
                  { key: 'roughnessMap', label: 'Roughness Map' },
                  { key: 'metalnessMap', label: 'Metalness Map' },
                  { key: 'emissiveMap', label: 'Emission Map' },
                  { key: 'aoMap', label: 'AO (Ambient Occlusion)' }
                ].map((slot) => {
                  return (
                    <div key={slot.key} className="flex flex-col gap-1.5 bg-slate-950/90 px-2.5 py-1.5 rounded-lg border border-slate-800/80">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-300 w-36 truncate">{slot.label}</span>
                        <div className="flex items-center gap-1.5 flex-1 justify-end">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenSlotDropdown(openSlotDropdown === `main_${slot.key}` ? null : `main_${slot.key}`);
                            }}
                            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-slate-300 text-[10px] rounded px-2 py-0.5 flex items-center gap-1 transition max-w-[130px]"
                          >
                            <span className="truncate">Choose Image ({imageAssets.length})</span>
                            <span className="text-[9px] text-cyan-400">▼</span>
                          </button>
                          <label className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded text-[10px] font-bold cursor-pointer transition">
                            Upload
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleApplyTextureSlot(slot.key, URL.createObjectURL(f));
                              }}
                            />
                          </label>
                          <button
                            onClick={() => handleApplyTextureSlot(slot.key, null)}
                            className="px-1.5 py-0.5 bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-700/50 rounded text-[10px] font-bold transition"
                            title="Clear texture slot"
                          >
                            ✕
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

          {/* COMPONENT 1: StaticMesh / SkinnedMeshRenderer */}
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

          {/* COMPONENT 3+: Custom Attached Components */}
          {attachedComponents.map((comp) => (
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
                  {comp === 'Light Source' && <p>Point Light attached: #00f0ff (Intensity: 2.0, Range: 10m)</p>}
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
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleApplyTextureSlot(slot.key, URL.createObjectURL(f));
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
