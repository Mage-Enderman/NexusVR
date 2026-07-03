import React from 'react';
import { X, Settings, Monitor, Sliders, Cpu, Eye, ShieldAlert, Sparkles, Layers, Triangle, Hash } from 'lucide-react';
import type { GraphicsSettings, PerformanceStats } from '../engine/SceneEngine.ts';

interface SettingsModalProps {
  settings: GraphicsSettings;
  stats: PerformanceStats;
  onUpdateSettings: (newSettings: Partial<GraphicsSettings>) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  stats,
  onUpdateSettings,
  onClose,
}) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel max-w-xl w-[90vw] p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-[#a855f7] flex items-center justify-center border border-purple-500/30">
              <Settings className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-['Outfit'] tracking-wide">Graphical Settings</h2>
              <p className="text-xs text-slate-400">Configure Three.js rendering, shadows, and anti-aliasing.</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-glass hover:text-rose-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Performance Monitor Badge Panel */}
        <div className="grid grid-cols-3 gap-3 bg-slate-900/80 p-3.5 rounded-2xl border border-cyan-500/20">
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
              <Cpu className="w-3 h-3 text-cyan-400" /> FPS
            </span>
            <span className={`font-mono text-lg font-bold mt-0.5 ${stats.fps >= 50 ? 'text-emerald-400' : (stats.fps >= 30 ? 'text-amber-400' : 'text-rose-400')}`}>
              {stats.fps}
            </span>
          </div>

          <div className="flex flex-col items-center border-x border-slate-800">
            <span className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
              <Sliders className="w-3 h-3 text-purple-400" /> Draw Calls
            </span>
            <span className="font-mono text-lg font-bold text-slate-200 mt-0.5">
              {stats.drawCalls}
            </span>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-pink-400" /> Triangles
            </span>
            <span className="font-mono text-lg font-bold text-slate-200 mt-0.5">
              {(stats.triangles / 1000).toFixed(1)}k
            </span>
          </div>
        </div>

        {/* Settings Controls */}
        <div className="space-y-5 max-h-[50vh] overflow-y-auto pr-2">
          {/* Resolution Scale */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-cyan-400" /> Resolution Scaling / DPI
              </label>
              <span className="text-xs font-mono font-bold text-cyan-300">{settings.resolutionScale}x</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-white/5">
              {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((scale) => (
                <button
                  key={scale}
                  onClick={() => onUpdateSettings({ resolutionScale: scale })}
                  className={`btn btn-glass text-xs py-1.5 ${settings.resolutionScale === scale ? 'active font-bold' : ''}`}
                >
                  {scale}x
                </button>
              ))}
            </div>
          </div>

          {/* Shadow Quality */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-purple-400" /> Shadow Quality (PCSS / Soft)
              </label>
              <span className="text-xs font-mono font-bold text-purple-300 capitalize">{settings.shadowQuality}</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-white/5">
              {(['off', 'low', 'medium', 'high', 'ultra'] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => onUpdateSettings({ shadowQuality: q })}
                  className={`btn btn-glass text-xs py-1.5 capitalize ${settings.shadowQuality === q ? 'active bg-purple-500/20 text-purple-300 border-purple-500/40 font-bold' : ''}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Anti-Aliasing */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-pink-400" /> Anti-Aliasing (MSAA / FXAA)
              </label>
              <span className="text-xs font-mono font-bold text-pink-300 uppercase">{settings.antiAliasing}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-white/5">
              {(['none', 'fxaa', 'msaa'] as const).map((aa) => (
                <button
                  key={aa}
                  onClick={() => onUpdateSettings({ antiAliasing: aa })}
                  className={`btn btn-glass text-xs py-1.5 uppercase ${settings.antiAliasing === aa ? 'active bg-pink-500/20 text-pink-300 border-pink-500/40 font-bold' : ''}`}
                >
                  {aa}
                </button>
              ))}
            </div>
          </div>

            {/* Progressive LOD (gltf-progressive) */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" /> Progressive LOD (gltf-progressive)
              </label>
              <span className={`text-xs font-mono font-bold ${settings.progressiveLOD ? 'text-emerald-300' : 'text-slate-500'}`}>
                {settings.progressiveLOD ? 'ON' : 'OFF'}
              </span>
            </div>
            <button
              onClick={() => onUpdateSettings({ progressiveLOD: !settings.progressiveLOD })}
              className={`w-full btn btn-glass text-xs py-2 ${settings.progressiveLOD ? 'active bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold' : ''}`}
            >
              {settings.progressiveLOD ? '✓ Enabled — LOD streaming active for progressive assets' : 'Click to enable progressive LOD streaming'}
            </button>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Enables @needle-tools/gltf-progressive for automatic mesh LOD. Models processed with Needle tools will stream in progressively — a low-poly proxy renders instantly while high-detail geometry loads in the background. Regular models are unaffected.
            </p>
          </div>

          {/* LOD Debug Controls — only shown when progressive LOD is active */}
          {settings.progressiveLOD && (
            <div className="space-y-3 bg-slate-900/60 p-3.5 rounded-2xl border border-emerald-500/20">
              <div className="flex items-center gap-2 mb-1">
                <Triangle className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">LOD Debug Controls</span>
              </div>

              {/* Target Triangle Density */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1">
                    <Hash className="w-3 h-3 text-emerald-400" /> Target Triangle Density
                  </label>
                  <span className="text-[11px] font-mono font-bold text-emerald-300">
                    {(settings.lodTargetDensity / 1000).toFixed(0)}k
                  </span>
                </div>
                <input
                  type="range"
                  min={10_000}
                  max={1_000_000}
                  step={10_000}
                  value={settings.lodTargetDensity}
                  onChange={(e) => onUpdateSettings({ lodTargetDensity: Number(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-[9px] text-slate-500">
                  <span>10k (performance)</span>
                  <span>1M (quality)</span>
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed">
                  Max triangles on screen when a mesh fills the viewport. Lower values favour performance, higher values preserve detail.
                </p>
              </div>

              {/* Override LOD Level */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1">
                    <Layers className="w-3 h-3 text-emerald-400" /> Override LOD Level
                  </label>
                  <span className="text-[11px] font-mono font-bold text-emerald-300">
                    {settings.lodOverrideLevel !== undefined ? settings.lodOverrideLevel : 'Auto'}
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {[undefined, 0, 1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={String(level)}
                      onClick={() => onUpdateSettings({ lodOverrideLevel: level })}
                      className={`btn btn-glass text-[10px] py-1 ${settings.lodOverrideLevel === level ? 'active bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold' : ''}`}
                    >
                      {level === undefined ? 'Auto' : level}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed">
                  Force all progressive meshes to a specific LOD level. "Auto" lets the system pick the best level based on screen coverage and density.
                </p>
              </div>
            </div>
          )}

          {/* LOD & Meshoptimizer info */}
          <div className="glass-card bg-slate-900/40 border-white/5 p-3.5 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-[#00f0ff] shrink-0 mt-0.5" />
            <div className="text-xs text-slate-300 leading-relaxed">
              <span className="font-bold text-white">Meshopt LOD Optimization</span> is active by default. High-polygon 3D models automatically utilize vertex fetching and simplification buffers to preserve FPS in immersive VR sessions.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="btn btn-primary text-xs py-2 px-6 bg-gradient-to-r from-[#00f0ff] to-[#0099ff] text-black font-bold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
