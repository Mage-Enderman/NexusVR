import React, { useState } from 'react';
import { Move, RotateCw, Maximize2, Box, PackageOpen, Upload, Shield, ShieldAlert, Trash2, ChevronUp, Crosshair, Wrench, Activity, Compass, Globe, Navigation } from 'lucide-react';
import type { TransformMode } from '../engine/ManipulationManager.ts';
import type { LoadedAsset } from '../engine/AssetManager.ts';

interface ToolbarProps {
  currentMode: TransformMode;
  onSetMode: (mode: TransformMode) => void;
  selectedAsset: LoadedAsset | null;
  onToggleCollision: () => void;
  onDeleteSelected: () => void;
  onFocusSelected: () => void;
  onSpawnPrimitive: (type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane') => void;
  onOpenInventory: () => void;
  onOpenImport: () => void;
  onOpenTools?: () => void;
  onOpenInspector?: () => void;
  onOpenRadialMenu?: () => void;
  activeTool?: string | null;
  transformSpace?: 'local' | 'world';
  onToggleSpace?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  currentMode,
  onSetMode,
  selectedAsset,
  onToggleCollision,
  onDeleteSelected,
  onFocusSelected,
  onSpawnPrimitive,
  onOpenInventory,
  onOpenImport,
  onOpenTools,
  onOpenInspector,
  onOpenRadialMenu,
  activeTool,
  transformSpace = 'local',
  onToggleSpace,
}) => {
  const [showPrimitives, setShowPrimitives] = useState(false);

  const primitives: Array<{ type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'; label: string }> = [
    { type: 'cube', label: 'Cube' },
    { type: 'sphere', label: 'Sphere' },
    { type: 'cylinder', label: 'Cylinder' },
    { type: 'cone', label: 'Cone' },
    { type: 'torus', label: 'Torus' },
    { type: 'plane', label: 'Plane' },
  ];

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 pointer-events-none">
      {/* Primitives Popup Sub-menu */}
      {showPrimitives && (
        <div className="glass-panel p-2 flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-auto">
          <span className="text-xs font-semibold uppercase text-slate-400 px-2">Spawn:</span>
          {primitives.map((p) => (
            <button
              key={p.type}
              onClick={() => {
                onSpawnPrimitive(p.type);
                setShowPrimitives(false);
              }}
              className="btn btn-glass text-xs py-1.5 px-3 hover:border-[#00f0ff] hover:text-[#00f0ff]"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Main Bar */}
      <div className="glass-panel p-2 flex items-center gap-2 pointer-events-auto shadow-2xl">
        {/* Transform Tools */}
        <div className="flex items-center gap-1 bg-slate-900/60 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => onSetMode('translate')}
            className={`btn-icon text-sm rounded-lg transition-all ${
              currentMode === 'translate' ? 'bg-[#00f0ff] text-black shadow-[0_0_12px_rgba(0,240,255,0.5)] font-bold' : 'text-slate-300 hover:bg-white/10'
            }`}
            title="Move (Translate) Mode [G / W]"
          >
            <Move className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSetMode('rotate')}
            className={`btn-icon text-sm rounded-lg transition-all ${
              currentMode === 'rotate' ? 'bg-[#a855f7] text-white shadow-[0_0_12px_rgba(168,85,247,0.5)] font-bold' : 'text-slate-300 hover:bg-white/10'
            }`}
            title="Rotate Mode [R / E]"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSetMode('scale')}
            className={`btn-icon text-sm rounded-lg transition-all ${
              currentMode === 'scale' ? 'bg-[#ec4899] text-white shadow-[0_0_12px_rgba(236,72,153,0.5)] font-bold' : 'text-slate-300 hover:bg-white/10'
            }`}
            title="Scale Mode [S / R]"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        <div className="h-6 w-[1px] bg-slate-700/60 mx-1" />

        {/* Spawning & Inventory */}
        <button
          onClick={() => setShowPrimitives(!showPrimitives)}
          className={`btn btn-glass text-xs py-2 px-3 ${showPrimitives ? 'active' : ''}`}
          title="Spawn Primitives"
        >
          <Box className="w-4 h-4 text-[#00f0ff]" />
          <span>Primitives</span>
          <ChevronUp className={`w-3 h-3 transition-transform ${showPrimitives ? 'rotate-180' : ''}`} />
        </button>

        <button
          onClick={onOpenInventory}
          className="btn btn-glass text-xs py-2 px-3"
          title="Open Inventory Storage [I]"
        >
          <PackageOpen className="w-4 h-4 text-[#a855f7]" />
          <span>Inventory</span>
        </button>

        <button
          onClick={onOpenTools}
          className={`btn btn-glass text-xs py-2 px-3 ${activeTool ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : ''}`}
          title="Open World Tools (Dev, Material, Light, Shape, Brush)"
        >
          <Wrench className="w-4 h-4 text-[#ffd700]" />
          <span>Tools</span>
        </button>

        <button
          onClick={onOpenRadialMenu}
          className="btn btn-glass text-xs py-2 px-3 bg-cyan-950/40 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-300"
          title="Open Resonite Radial Context Menu [Right-Click / M]"
        >
          <Compass className="w-4 h-4 text-cyan-400 animate-spin-slow" />
          <span>Context Menu</span>
        </button>

        <button
          onClick={onOpenImport}
          className="btn btn-primary text-xs py-2 px-3.5 bg-gradient-to-r from-[#00f0ff] to-[#0088ff]"
          title="Import 3D Models, Images, Videos, VRM [U]"
        >
          <Upload className="w-4 h-4" />
          <span>Import File</span>
        </button>

        {/* Selected Object Context Actions */}
        {selectedAsset && (
          <>
            <div className="h-6 w-[1px] bg-slate-700/60 mx-1" />
            <div className="flex items-center gap-1 bg-slate-900/80 px-2 py-1 rounded-xl border border-cyan-500/30 animate-in fade-in">
              <span className="text-xs font-mono text-cyan-300 max-w-[100px] truncate px-1">
                {selectedAsset.name}
              </span>

              <button
                onClick={onToggleCollision}
                className={`btn-icon w-8 h-8 rounded-lg ${
                  selectedAsset.isCollidable
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                }`}
                title={`Collision: ${selectedAsset.isCollidable ? 'Solid (ON)' : 'Ghost (OFF)'}`}
              >
                {selectedAsset.isCollidable ? <Shield className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
              </button>

              <button
                onClick={onToggleSpace}
                className={`btn-icon w-8 h-8 rounded-lg transition-all ${
                  transformSpace === 'local'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                }`}
                title={`Gizmo Space: ${transformSpace === 'local' ? 'Local Axis' : 'Global Axis'} (click to switch)`}
              >
                {transformSpace === 'local' ? <Navigation className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
              </button>

              <button
                onClick={onFocusSelected}
                className="btn-icon w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/40 border border-cyan-500/30"
                title="Focus & Orbit Camera Around Object [F]"
              >
                <Crosshair className="w-4 h-4" />
              </button>

              <button
                onClick={onOpenInspector}
                className="btn-icon w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/40 border border-purple-500/30"
                title="Open Resonite Spatial Scene Inspector [I]"
              >
                <Activity className="w-4 h-4" />
              </button>

              <button
                onClick={onDeleteSelected}
                className="btn-icon w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/40 border border-rose-500/30"
                title="Delete Object [Delete / Backspace]"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
