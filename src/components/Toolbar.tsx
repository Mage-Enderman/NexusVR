import React, { useState } from 'react';
import { Move, RotateCw, Maximize2, Box, PackageOpen, Upload, Shield, ShieldAlert, Trash2, ChevronUp, Crosshair, Wrench, Activity, Compass, Globe, Navigation } from 'lucide-react';
import type { TransformMode } from '../engine/ManipulationManager.ts';
import type { LoadedAsset } from '../engine/AssetManager.ts';
import { Tooltip } from './Tooltip.tsx';

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
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 pointer-events-none max-w-[95vw]">
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
      <div className="glass-panel p-2 flex flex-wrap justify-center items-center gap-2 pointer-events-auto shadow-2xl max-h-[50vh] overflow-y-auto">
        {/* Transform Tools matching reference style */}
        <div className="flex items-center gap-1.5 bg-[#0a0d14] p-1.5 rounded-2xl border border-cyan-500/35 shadow-inner">
          <Tooltip text="Translate/Move">
            <button
              onClick={() => onSetMode('translate')}
              className={currentMode === 'translate' ? 'btn-dark-slate-active' : 'btn-dark-slate'}
            >
              <Move className="w-5 h-5" />
            </button>
          </Tooltip>

          <Tooltip text="Rotate">
            <button
              onClick={() => onSetMode('rotate')}
              className={currentMode === 'rotate' ? 'btn-dark-slate-active' : 'btn-dark-slate'}
            >
              <RotateCw className="w-5 h-5" />
            </button>
          </Tooltip>

          <Tooltip text="Scale">
            <button
              onClick={() => onSetMode('scale')}
              className={currentMode === 'scale' ? 'btn-dark-slate-active' : 'btn-dark-slate'}
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        <div className="h-6 w-[1px] bg-slate-700/60 mx-1" />

        {/* Spawning & Inventory */}
        <Tooltip text="Spawn Primitives">
          <button
            onClick={() => setShowPrimitives(!showPrimitives)}
            className={`btn btn-glass text-xs py-2 px-3 ${showPrimitives ? 'active' : ''}`}
          >
            <Box className="w-4 h-4 text-[#00f0ff]" />
            <span className="hidden md:inline">Primitives</span>
            <ChevronUp className={`w-3 h-3 transition-transform ${showPrimitives ? 'rotate-180' : ''}`} />
          </button>
        </Tooltip>

        <Tooltip text="Inventory">
          <button
            onClick={onOpenInventory}
            className="btn btn-glass text-xs py-2 px-3"
          >
            <PackageOpen className="w-4 h-4 text-[#a855f7]" />
            <span className="hidden md:inline">Inventory</span>
          </button>
        </Tooltip>

        <Tooltip text="World Tools">
          <button
            onClick={onOpenTools}
            className={`btn btn-glass text-xs py-2 px-3 ${activeTool ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : ''}`}
          >
            <Wrench className="w-4 h-4 text-[#ffd700]" />
            <span className="hidden md:inline">Tools</span>
          </button>
        </Tooltip>

        <Tooltip text="Context Menu">
          <button
            onClick={onOpenRadialMenu}
            className="hidden lg:flex btn btn-glass text-xs py-2 px-3 bg-cyan-950/40 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-300 items-center gap-1.5"
          >
            <Compass className="w-4 h-4 text-cyan-400 animate-spin-slow" />
            <span>Context Menu</span>
          </button>
        </Tooltip>

        <Tooltip text="Import File">
          <button
            onClick={onOpenImport}
            className="btn btn-primary text-xs py-2 px-3.5 bg-gradient-to-r from-[#00f0ff] to-[#0088ff]"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden md:inline">Import File</span>
          </button>
        </Tooltip>

        {/* Selected Object Context Actions */}
        {selectedAsset && (
          <>
            <div className="h-6 w-[1px] bg-slate-700/60 mx-1" />
            <div className="flex items-center gap-1 bg-slate-900/80 px-2 py-1 rounded-xl border border-cyan-500/30 animate-in fade-in">
              <span className="text-xs font-mono text-cyan-300 max-w-[100px] truncate px-1">
                {selectedAsset.name}
              </span>

              <Tooltip text={`Collision: ${selectedAsset.isCollidable ? 'Solid (ON)' : 'Ghost (OFF)'}`}>
                <button
                  onClick={onToggleCollision}
                  className={`btn-icon w-8 h-8 rounded-lg ${
                    selectedAsset.isCollidable
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  }`}
                >
                  {selectedAsset.isCollidable ? <Shield className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                </button>
              </Tooltip>

              <Tooltip text={`Gizmo: ${transformSpace === 'local' ? 'Local' : 'Global'} (click to switch)`}>
                <button
                  onClick={onToggleSpace}
                  className={`btn-icon w-8 h-8 rounded-lg transition-all ${
                    transformSpace === 'local'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  }`}
                >
                  {transformSpace === 'local' ? <Navigation className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                </button>
              </Tooltip>

              <Tooltip text="Focus Camera">
                <button
                  onClick={onFocusSelected}
                  className="btn-icon w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/40 border border-cyan-500/30"
                >
                  <Crosshair className="w-4 h-4" />
                </button>
              </Tooltip>

              <Tooltip text="Scene Inspector">
                <button
                  onClick={onOpenInspector}
                  className="btn-icon w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/40 border border-purple-500/30"
                >
                  <Activity className="w-4 h-4" />
                </button>
              </Tooltip>

              <Tooltip text="Delete">
                <button
                  onClick={onDeleteSelected}
                  className="btn-icon w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/40 border border-rose-500/30"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
