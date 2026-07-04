import React, { useState } from 'react';
import * as THREE from 'three';
import { 
  Wrench, Palette, Lightbulb, Box, Brush, X, Eye, 
  Trash2, Plus, Sparkles, Move, RotateCw, 
  Maximize2, Zap, Sun, Target
} from 'lucide-react';
import type { LoadedAsset } from '../engine/AssetManager.ts';
import type { TransformMode } from '../engine/ManipulationManager.ts';

export type ToolType = 'dev' | 'material' | 'light' | 'shape' | 'brush';

export interface WorldToolsPanelProps {
  activeTool: ToolType | null;
  onClose: () => void;
  onSelectTool: (tool: ToolType | null) => void;
  selectedAsset: LoadedAsset | null;
  currentTransformMode: TransformMode;
  onSetTransformMode: (mode: TransformMode) => void;
  onSpawnPrimitive: (type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane', scale?: number) => void;
  onSpawnLight: (type: 'point' | 'spot', color: string, intensity: number, distance: number) => void;
  onApplyMaterial: (color: string, roughness: number, metalness: number, wireframe: boolean, emissive: string, opacity: number, textureUrl?: string) => void;
  onToggleWireframe: () => void;
  brushColor: string;
  onChangeBrushColor: (color: string) => void;
  brushWidth: number;
  onChangeBrushWidth: (width: number) => void;
  isDrawingActive: boolean;
  onToggleDrawing: () => void;
  onClearStrokes: () => void;
}

export const WorldToolsPanel: React.FC<WorldToolsPanelProps> = ({
  activeTool,
  onClose,
  onSelectTool,
  selectedAsset,
  currentTransformMode,
  onSetTransformMode,
  onSpawnPrimitive,
  onSpawnLight,
  onApplyMaterial,
  onToggleWireframe,
  brushColor,
  onChangeBrushColor,
  brushWidth,
  onChangeBrushWidth,
  isDrawingActive,
  onToggleDrawing,
  onClearStrokes
}) => {
  if (!activeTool) return null;

  // Material state
  const [matColor, setMatColor] = useState('#00f0ff');
  const [matRoughness, setMatRoughness] = useState(0.2);
  const [matMetalness, setMatMetalness] = useState(0.8);
  const [matWireframe, setMatWireframe] = useState(false);
  const [matEmissive, setMatEmissive] = useState('#000000');
  const [matOpacity, setMatOpacity] = useState(1.0);
  const [matTextureUrl, setMatTextureUrl] = useState<string>('none');

  // Light state
  const [lightType, setLightType] = useState<'point' | 'spot'>('point');
  const [lightColor, setLightColor] = useState('#ffffff');
  const [lightIntensity, setLightIntensity] = useState(2.0);
  const [lightDistance, setLightDistance] = useState(15);

  // Shape state
  const [shapeScale, setShapeScale] = useState(1.0);

  const materialPresets = [
    { name: 'Neon Cyan Glow', color: '#00f0ff', roughness: 0.1, metalness: 0.9, emissive: '#004455' },
    { name: 'Polished Gold', color: '#ffd700', roughness: 0.15, metalness: 1.0, emissive: '#000000' },
    { name: 'Glass Crystal', color: '#ffffff', roughness: 0.05, metalness: 0.1, opacity: 0.5, emissive: '#000000' },
    { name: 'Cyber Purple', color: '#a855f7', roughness: 0.3, metalness: 0.7, emissive: '#3b0764' },
    { name: 'Dark Slate Matte', color: '#1e293b', roughness: 0.9, metalness: 0.1, emissive: '#000000' },
    { name: 'Chrome Silver', color: '#e2e8f0', roughness: 0.05, metalness: 1.0, emissive: '#000000' }
  ];

  const texturePresets = [
    { id: 'none', name: 'None (Pure Color)', url: 'none' },
    { id: 'grid', name: 'Cyber Grid', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=512&q=80' },
    { id: 'metal', name: 'Brushed Metal', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=512&q=80' },
    { id: 'carbon', name: 'Carbon Fiber', url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=512&q=80' },
    { id: 'stone', name: 'Dark Stone', url: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=512&q=80' }
  ];

  return (
    <div className="absolute top-20 right-4 z-20 w-96 glass-panel border border-slate-700/80 shadow-[0_0_35px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200 pointer-events-auto max-h-[calc(100vh-140px)]">
      {/* Header & Tool Switcher */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20 font-bold">
            {activeTool === 'dev' && <Wrench className="w-4 h-4" />}
            {activeTool === 'material' && <Palette className="w-4 h-4" />}
            {activeTool === 'light' && <Lightbulb className="w-4 h-4" />}
            {activeTool === 'shape' && <Box className="w-4 h-4" />}
            {activeTool === 'brush' && <Brush className="w-4 h-4" />}
          </div>
          <div>
            <h3 className="font-['Outfit'] font-bold text-sm text-white capitalize flex items-center gap-1.5">
              <span>{activeTool === 'dev' ? 'Dev Inspector & Gizmos' : activeTool === 'material' ? 'Material Editor' : activeTool === 'light' ? 'Light Spawner' : activeTool === 'shape' ? 'Shape Builder' : 'Geometry Line Brush'}</span>
            </h3>
            <span className="text-[10px] text-slate-400 block">World Inventory Tool</span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tool Tabs Bar */}
      <div className="flex border-b border-slate-800 bg-slate-950/60 p-1 gap-1 overflow-x-auto text-xs">
        <button
          onClick={() => onSelectTool('dev')}
          className={`flex-1 py-1.5 px-2 rounded-md font-semibold flex items-center justify-center gap-1 transition ${activeTool === 'dev' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:bg-slate-900'}`}
          title="Dev Tool (Inspect & Gizmo)"
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>Dev</span>
        </button>
        <button
          onClick={() => onSelectTool('material')}
          className={`flex-1 py-1.5 px-2 rounded-md font-semibold flex items-center justify-center gap-1 transition ${activeTool === 'material' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'text-slate-400 hover:bg-slate-900'}`}
          title="Material Tool (Color & Roughness)"
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Material</span>
        </button>
        <button
          onClick={() => onSelectTool('light')}
          className={`flex-1 py-1.5 px-2 rounded-md font-semibold flex items-center justify-center gap-1 transition ${activeTool === 'light' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:bg-slate-900'}`}
          title="Light Tool (Spawn Bulbs)"
        >
          <Lightbulb className="w-3.5 h-3.5" />
          <span>Light</span>
        </button>
        <button
          onClick={() => onSelectTool('shape')}
          className={`flex-1 py-1.5 px-2 rounded-md font-semibold flex items-center justify-center gap-1 transition ${activeTool === 'shape' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:bg-slate-900'}`}
          title="Shape Tool (Create Primitives)"
        >
          <Box className="w-3.5 h-3.5" />
          <span>Shape</span>
        </button>
        <button
          onClick={() => onSelectTool('brush')}
          className={`flex-1 py-1.5 px-2 rounded-md font-semibold flex items-center justify-center gap-1 transition ${activeTool === 'brush' ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40' : 'text-slate-400 hover:bg-slate-900'}`}
          title="Geometry Line Brush (Draw in 3D)"
        >
          <Brush className="w-3.5 h-3.5" />
          <span>Brush</span>
        </button>
      </div>

      {/* Body Content */}
      <div className="p-4 overflow-y-auto space-y-4 flex-1 text-slate-200 text-xs">
        {/* 1. DEV TOOL TAB */}
        {activeTool === 'dev' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider block">Target Object Inspector</span>
              {selectedAsset ? (
                <div className="space-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="text-slate-400">Name:</span>
                    <span className="text-white font-bold">{selectedAsset.name}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="text-slate-400">UUID:</span>
                    <span className="text-slate-300 truncate max-w-[180px]">{selectedAsset.id}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="text-slate-400">Type:</span>
                    <span className="text-cyan-300 uppercase">{selectedAsset.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Position:</span>
                    <span className="text-emerald-400">
                      [{selectedAsset.object3d.position.x.toFixed(1)}, {selectedAsset.object3d.position.y.toFixed(1)}, {selectedAsset.object3d.position.z.toFixed(1)}]
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-slate-400">
                  <Target className="w-8 h-8 mx-auto mb-1 opacity-40 animate-pulse text-cyan-400" />
                  <span>Click any mesh in the world to inspect & gizmo-control</span>
                </div>
              )}
            </div>

            {/* Gizmo Controls */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Active Transform Gizmo</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => onSetTransformMode('translate')}
                  className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition ${currentTransformMode === 'translate' ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold' : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                >
                  <Move className="w-4 h-4" />
                  <span>Move (G/W)</span>
                </button>
                <button
                  onClick={() => onSetTransformMode('rotate')}
                  className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition ${currentTransformMode === 'rotate' ? 'bg-purple-500/20 border-purple-500 text-purple-300 font-bold' : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                >
                  <RotateCw className="w-4 h-4" />
                  <span>Rotate (R/E)</span>
                </button>
                <button
                  onClick={() => onSetTransformMode('scale')}
                  className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition ${currentTransformMode === 'scale' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold' : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                >
                  <Maximize2 className="w-4 h-4" />
                  <span>Scale (S)</span>
                </button>
              </div>
              <button
                onClick={onToggleWireframe}
                disabled={!selectedAsset}
                className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40 transition"
              >
                <Eye className="w-4 h-4 text-cyan-400" />
                <span>Toggle Wireframe / Shading on Selected</span>
              </button>
            </div>

            {/* Quick Shape Create inside Dev Tool */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Dev Create Primitives</span>
              <div className="grid grid-cols-3 gap-2">
                {(['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane'] as const).map((prim) => (
                  <button
                    key={prim}
                    onClick={() => onSpawnPrimitive(prim, 1.0)}
                    className="p-2 rounded-lg bg-slate-900/80 hover:bg-cyan-500/20 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 capitalize font-medium flex items-center justify-center gap-1 transition"
                  >
                    <Plus className="w-3 h-3 text-cyan-400" />
                    <span>{prim}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 2. MATERIAL TOOL TAB */}
        {activeTool === 'material' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-purple-400 uppercase tracking-wider">Surface Material Editor</span>
                <span className="text-[10px] text-slate-400">{selectedAsset ? `Target: ${selectedAsset.name}` : 'No object selected'}</span>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between font-semibold">
                  <span>Base Albedo Color</span>
                  <input
                    type="color"
                    value={matColor}
                    onChange={(e) => setMatColor(e.target.value)}
                    className="w-8 h-6 rounded bg-transparent border-0 cursor-pointer"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={matColor}
                    onChange={(e) => setMatColor(e.target.value)}
                    className="w-full px-2.5 py-1 rounded bg-slate-950 border border-slate-700 font-mono text-xs text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Roughness (Matte vs Glossy)</span>
                  <span className="font-mono text-cyan-400">{matRoughness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={matRoughness}
                  onChange={(e) => setMatRoughness(parseFloat(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Metalness (Metallic reflection)</span>
                  <span className="font-mono text-purple-400">{matMetalness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={matMetalness}
                  onChange={(e) => setMatMetalness(parseFloat(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Opacity (Transparency)</span>
                  <span className="font-mono text-emerald-400">{matOpacity.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={matOpacity}
                  onChange={(e) => setMatOpacity(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer font-semibold">
                  <input
                    type="checkbox"
                    checked={matWireframe}
                    onChange={(e) => setMatWireframe(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-600 text-purple-500 focus:ring-0"
                  />
                  <span>Render as Wireframe</span>
                </label>
              </div>

              {/* Albedo Texture Selection */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider block">Albedo Surface Texture</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {texturePresets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setMatTextureUrl(t.url)}
                      className={`p-1.5 rounded-lg border text-left text-[11px] font-semibold truncate transition ${matTextureUrl === t.url ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold' : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (selectedAsset) {
                    selectedAsset.object3d.traverse((child) => {
                      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
                        const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
                        if (m.color) setMatColor('#' + m.color.getHexString());
                        if (m.roughness !== undefined) setMatRoughness(m.roughness);
                        if (m.metalness !== undefined) setMatMetalness(m.metalness);
                        if (m.wireframe !== undefined) setMatWireframe(m.wireframe);
                        if (m.opacity !== undefined) setMatOpacity(m.opacity);
                      }
                    });
                  }
                }}
                disabled={!selectedAsset}
                className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-cyan-500/20 border border-slate-700 hover:border-cyan-500/40 text-cyan-300 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-40 transition shadow"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Sample / Extract Target</span>
              </button>
            </div>

            <button
              onClick={() => onApplyMaterial(matColor, matRoughness, matMetalness, matWireframe, matEmissive, matOpacity, matTextureUrl)}
              disabled={!selectedAsset}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 disabled:opacity-40 transition"
            >
              <Sparkles className="w-4 h-4" />
              <span>Apply Material to Selected Asset</span>
            </button>

            {/* Presets */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Curated Material Swatches</span>
              <div className="grid grid-cols-2 gap-2">
                {materialPresets.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => {
                      setMatColor(p.color);
                      setMatRoughness(p.roughness);
                      setMatMetalness(p.metalness);
                      if (p.emissive) setMatEmissive(p.emissive);
                      if (p.opacity) setMatOpacity(p.opacity);
                      onApplyMaterial(p.color, p.roughness, p.metalness, matWireframe, p.emissive || '#000000', p.opacity || 1.0, matTextureUrl);
                    }}
                    className="p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 flex items-center gap-2 text-left transition"
                  >
                    <div className="w-5 h-5 rounded-md border border-white/20 shadow" style={{ backgroundColor: p.color }} />
                    <span className="font-semibold text-white truncate text-[11px]">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3. LIGHT TOOL TAB */}
        {activeTool === 'light' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">Light Spawner Settings</span>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setLightType('point')}
                  className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 font-bold transition ${lightType === 'point' ? 'bg-amber-500/20 border-amber-500 text-amber-300' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
                >
                  <Sun className="w-4 h-4" />
                  <span>Point Light Bulb</span>
                </button>
                <button
                  onClick={() => setLightType('spot')}
                  className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 font-bold transition ${lightType === 'spot' ? 'bg-amber-500/20 border-amber-500 text-amber-300' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
                >
                  <Zap className="w-4 h-4" />
                  <span>Spot Light Beam</span>
                </button>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between font-semibold">
                  <span>Light Color Swatch</span>
                  <input
                    type="color"
                    value={lightColor}
                    onChange={(e) => setLightColor(e.target.value)}
                    className="w-8 h-6 rounded bg-transparent border-0 cursor-pointer"
                  />
                </label>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Brightness Intensity</span>
                  <span className="font-mono text-amber-400">{lightIntensity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="8.0"
                  step="0.5"
                  value={lightIntensity}
                  onChange={(e) => setLightIntensity(parseFloat(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Illumination Radius (Meters)</span>
                  <span className="font-mono text-amber-400">{lightDistance}m</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="5"
                  value={lightDistance}
                  onChange={(e) => setLightDistance(parseInt(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>

            <button
              onClick={() => onSpawnLight(lightType, lightColor, lightIntensity, lightDistance)}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black font-extrabold shadow-lg shadow-amber-500/30 flex items-center justify-center gap-2 transition"
            >
              <Lightbulb className="w-5 h-5 fill-current" />
              <span>Spawn Light Gizmo into World</span>
            </button>
            <p className="text-[11px] text-slate-400 text-center">
              Spawns a real 3D glowing sphere that illuminates nearby models. Select it anytime to move or delete.
            </p>
          </div>
        )}

        {/* 4. SHAPE TOOL TAB */}
        {activeTool === 'shape' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Primitive Shape Creator</span>
                <span className="text-slate-400 font-mono">Instant Spawn</span>
              </div>

              <div className="space-y-1.5">
                <span className="text-slate-300 font-semibold block">Spawn Scale Multiplier</span>
                <div className="grid grid-cols-4 gap-1.5 font-mono">
                  {[0.5, 1.0, 2.0, 5.0].map((s) => (
                    <button
                      key={s}
                      onClick={() => setShapeScale(s)}
                      className={`py-1.5 rounded-lg border font-bold text-center transition ${shapeScale === s ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {(['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane'] as const).map((prim) => (
                <button
                  key={prim}
                  onClick={() => onSpawnPrimitive(prim, shapeScale)}
                  className="p-3 rounded-xl bg-slate-900/80 hover:bg-emerald-500/20 border border-slate-800 hover:border-emerald-500/50 flex flex-col items-center justify-center gap-2 text-center group transition"
                >
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 group-hover:bg-emerald-500/30 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black uppercase text-xs">
                    {prim.slice(0, 3)}
                  </div>
                  <span className="font-bold text-white capitalize text-xs">{prim}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 5. GEOMETRY LINE BRUSH TAB */}
        {activeTool === 'brush' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-pink-400 uppercase tracking-wider">3D Ribbon Line Brush</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isDrawingActive ? 'bg-pink-500 text-white animate-pulse' : 'bg-slate-800 text-slate-400'}`}>
                  {isDrawingActive ? 'Drawing Active' : 'Idle'}
                </span>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between font-semibold">
                  <span>Ribbon Color</span>
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => onChangeBrushColor(e.target.value)}
                    className="w-8 h-6 rounded bg-transparent border-0 cursor-pointer"
                  />
                </label>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Ribbon Width (Thickness)</span>
                  <span className="font-mono text-pink-400">{(brushWidth * 100).toFixed(0)} cm</span>
                </div>
                <input
                  type="range"
                  min="0.02"
                  max="0.4"
                  step="0.02"
                  value={brushWidth}
                  onChange={(e) => onChangeBrushWidth(parseFloat(e.target.value))}
                  className="w-full accent-pink-500 cursor-pointer"
                />
              </div>
            </div>

            <button
              onClick={onToggleDrawing}
              className={`w-full py-3 px-4 rounded-xl font-extrabold flex items-center justify-center gap-2 shadow-lg transition ${
                isDrawingActive
                  ? 'bg-gradient-to-r from-red-600 to-pink-600 text-white shadow-red-500/30 animate-pulse'
                  : 'bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-400 hover:to-rose-500 text-white shadow-pink-500/30'
              }`}
            >
              <Brush className="w-5 h-5" />
              <span>{isDrawingActive ? 'Stop Drawing Ribbon' : 'Start Drawing 3D Ribbon'}</span>
            </button>

            <button
              onClick={onClearStrokes}
              className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-red-950/60 border border-slate-800 hover:border-red-500/40 text-slate-400 hover:text-red-300 font-semibold flex items-center justify-center gap-2 transition"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear All 3D Brush Strokes</span>
            </button>
            <p className="text-[11px] text-slate-400 text-center">
              When Drawing is active, move your mouse or VR controller across the canvas to paint continuous glowing 3D ribbons in space!
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
