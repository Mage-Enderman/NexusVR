import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SpatialPopUpWrapper } from './SpatialPopUpWrapper.tsx';
import type { LoadedAsset } from '../engine/AssetManager.ts';
import { 
  Trash2, Copy, RotateCcw, ArrowUpRight, Magnet, Plus, Eye, EyeOff, 
  Box, Layers, Sun, Volume2, Shield, Sparkles, Activity, Check, ChevronRight, ChevronDown, Minimize2, Maximize2, Image as ImageIcon
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
  camera
}) => {
  if (!isOpen) return null;

  const [assetName, setAssetName] = useState(selectedAsset?.name || 'Box');
  const [tag, setTag] = useState('null');
  const [active, setActive] = useState(selectedAsset?.object3d.visible ?? true);
  const [persistent, setPersistent] = useState(true);
  const [orderOffset, setOrderOffset] = useState(0);

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

  // Collapsible component sections
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

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

  // Light selection sync — runs once per asset change. Holds the source-of-
  // truth state for the Reset buttons and applyTransform defaults; the
  // numeric inputs below are imperatively synced by a separate rAF loop.
  useEffect(() => {
    if (!selectedAsset) return;
    setAssetName(selectedAsset.name);
    setActive(selectedAsset.object3d.visible);
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

  const applyTransform = (newPos = pos, newRot = rot, newScale = scale) => {
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
    const next = { x: 0, y: 1.5, z: 0 };
    setPos(next);
    applyTransform(next, rot, scale);
  };

  const handleResetRot = () => {
    const next = { x: 0, y: 0, z: 0 };
    setRot(next);
    applyTransform(pos, next, scale);
  };

  const handleResetScale = () => {
    const next = { x: 1, y: 1, z: 1 };
    setScale(next);
    applyTransform(pos, rot, next);
  };

  const handleUpdateMaterial = (key: string, val: any) => {
    const next = { ...matProps, [key]: val };
    setMatProps(next);
    if (!selectedAsset) return;

    selectedAsset.object3d.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
        const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
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
      }
    });
    onUpdateAsset({ ...selectedAsset });
  };

  const handleAttachComponent = (compType: string) => {
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

  return (
    <SpatialPopUpWrapper
      isOpen={isOpen}
      onClose={onClose}
      title="Scene Inspector"
      icon={<Activity className="w-4 h-4 text-cyan-400" />}
      scene={scene}
      camera={camera}
      defaultWidth="w-[850px]"
      defaultHeight="max-h-[520px]"
      initialPinned={true}
    >
      <div className="flex gap-2.5 font-sans text-xs select-none" style={{ height: '460px' }}>

        {/* LEFT PANE: Hierarchy Tree */}
        <div className="w-56 bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex flex-col gap-2 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-cyan-300 uppercase font-mono tracking-wider text-[11px]">Root: {assetName}</span>
            <div className="flex gap-1">
              <button className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"><ArrowUpRight className="w-3 h-3" /></button>
            </div>
          </div>

          <div className="flex flex-col gap-1 mt-1">
            <div
              onClick={() => setSelectedNodeId('root')}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer font-bold transition ${
                selectedNodeId === 'root' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-300 hover:bg-slate-900'
              }`}
            >
              <Box className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">&bull; {assetName}</span>
            </div>

            {/* Child nodes / submeshes */}
            <div className="pl-4 flex flex-col gap-1 border-l border-slate-800 ml-2">
              <div
                onClick={() => setSelectedNodeId('mesh')}
                className={`flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition ${
                  selectedNodeId === 'mesh' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:bg-slate-900'
                }`}
              >
                <Layers className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate">BoxMesh Geometry</span>
              </div>
              <div
                onClick={() => setSelectedNodeId('mat')}
                className={`flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition ${
                  selectedNodeId === 'mat' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:bg-slate-900'
                }`}
              >
                <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="truncate">MeshRenderer</span>
              </div>
              {attachedComponents.map((comp) => (
                <div
                  key={comp}
                  onClick={() => setSelectedNodeId(comp)}
                  className="flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer bg-purple-500/10 text-purple-300 border border-purple-500/30 font-semibold"
                >
                  <Activity className="w-3 h-3 text-purple-400 shrink-0" />
                  <span className="truncate min-w-0">{comp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT PANE: Slot Inspector & Components */}
        <div className="flex-1 bg-slate-950/60 border border-slate-800 rounded-xl p-3 overflow-y-auto flex flex-col gap-3 custom-scrollbar">
          
          {/* SLOT HEADER */}
          <div className="flex flex-col gap-2.5 bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/80 shadow-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h4 className="font-extrabold text-sm text-white flex items-center gap-2">
                <span className="text-amber-400">Slot:</span>
                <span>{assetName}</span>
              </h4>
              <div className="flex items-center gap-1.5">
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
                    onChange={(e) => setPersistent(e.target.checked)}
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
                  <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold cursor-pointer">Local User Space</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer">World Root</span>
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
            </div>}
          </div>

          {/* COMPONENT 3: StaticTexture2D */}
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
    </SpatialPopUpWrapper>
  );
};
