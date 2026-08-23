import React from 'react';
import { X, Globe, Sun, Grid, Sparkles, Moon, Sunset, Camera, Eye, Footprints, Plane, Wind } from 'lucide-react';
import type { EnvironmentSettings, AtmospherePreset, LocomotionType } from '../engine/EnvironmentManager.ts';

interface WorldEnvironmentModalProps {
  settings: EnvironmentSettings;
  onUpdateSettings: (newSettings: Partial<EnvironmentSettings>) => void;
  onClose: () => void;
}

export const WorldEnvironmentModal: React.FC<WorldEnvironmentModalProps> = ({
  settings,
  onUpdateSettings,
  onClose,
}) => {
  const atmospheres: Array<{ id: AtmospherePreset; name: string; desc: string; icon: any; color: string }> = [
    { id: 'cyber-nebula', name: 'Cyber Nebula', desc: 'Dark neon cyberpunk space with fog', icon: Sparkles, color: 'text-cyan-400' },
    { id: 'sunset-horizon', name: 'Sunset Twilight', desc: 'Warm magenta & orange evening sky', icon: Sunset, color: 'text-pink-400' },
    { id: 'studio-neutral', name: 'Studio Bright', desc: 'Clean neutral lighting for model inspection', icon: Camera, color: 'text-slate-300' },
    { id: 'starfield-space', name: 'Deep Starfield', desc: 'Infinite void with twinkling star particles', icon: Moon, color: 'text-indigo-400' },
    { id: 'passthrough', name: 'Mixed Reality', desc: 'Full-color passthrough background (Quest 3)', icon: Eye, color: 'text-emerald-400' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel max-w-xl w-[90vw] p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-[#00f0ff] flex items-center justify-center border border-cyan-500/30">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-['Outfit'] tracking-wide">World & Environment</h2>
              <p className="text-xs text-slate-400">Customize skybox atmosphere, floor grid, and scene lighting.</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-glass hover:text-rose-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
          {/* Atmosphere Selector */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Skybox Atmosphere
            </label>
            <div className="grid grid-cols-2 gap-3">
              {atmospheres.map((atm) => {
                const Icon = atm.icon;
                const isActive = settings.atmosphere === atm.id;
                return (
                  <button
                    key={atm.id}
                    onClick={() => onUpdateSettings({ atmosphere: atm.id })}
                    className={`glass-card p-3.5 flex items-start gap-3 text-left transition-all ${
                      isActive ? 'border-[#00f0ff] bg-[#00f0ff]/10 shadow-[0_0_15px_rgba(0,240,255,0.2)] font-semibold' : 'hover:border-white/20'
                    }`}
                  >
                    <div className={`p-2 rounded-lg bg-black/40 ${atm.color} shrink-0`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm text-white font-medium">{atm.name}</h4>
                      <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{atm.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Floor Grid Customization */}
          <div className="space-y-3 bg-slate-900/60 p-4 rounded-2xl border border-white/5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Grid className="w-3.5 h-3.5 text-purple-400" /> Floor Grid Space
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.gridVisible}
                  onChange={(e) => onUpdateSettings({ gridVisible: e.target.checked })}
                  className="w-4 h-4 rounded accent-purple-500"
                />
                <span className="text-xs text-purple-300 font-semibold">Grid Visible</span>
              </label>
            </div>

            {settings.gridVisible && (
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                <div>
                  <span className="text-[10px] uppercase text-slate-400 block mb-1.5">Grid Arena Size</span>
                  <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl">
                    {(['studio-20', 'standard-60', 'arena-200'] as const).map((size) => (
                      <button
                        key={size}
                        onClick={() => onUpdateSettings({ gridSize: size })}
                        className={`btn btn-glass text-[10px] py-1 capitalize ${settings.gridSize === size ? 'active bg-purple-500/20 text-purple-300 font-bold' : ''}`}
                      >
                        {size.replace('-', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase text-slate-400 block mb-1.5">Color Palette</span>
                  <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl">
                    {(['cyan', 'purple', 'monochrome'] as const).map((col) => (
                      <button
                        key={col}
                        onClick={() => onUpdateSettings({ gridColor: col })}
                        className={`btn btn-glass text-[10px] py-1 capitalize ${settings.gridColor === col ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''}`}
                      >
                        {col}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Lighting & Sun Intensity */}
          <div className="space-y-4 bg-slate-900/60 p-4 rounded-2xl border border-white/5">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-amber-400" /> Lighting Intensity
            </label>

            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-300">Ambient Fill Light</span>
                <span className="font-mono text-amber-300">{settings.ambientIntensity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="2.0"
                step="0.1"
                value={settings.ambientIntensity}
                onChange={(e) => onUpdateSettings({ ambientIntensity: parseFloat(e.target.value) })}
                className="w-full accent-amber-400 cursor-pointer"
              />

              <div className="flex justify-between items-center text-xs pt-1">
                <span className="text-slate-300">Directional Sun / Shadow Light</span>
                <span className="font-mono text-amber-300">{settings.dirLightIntensity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={settings.dirLightIntensity}
                onChange={(e) => onUpdateSettings({ dirLightIntensity: parseFloat(e.target.value) })}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Locomotion Permissions */}
        <div className="bg-slate-950 rounded-xl border border-slate-700/80 overflow-hidden shadow-xl">
          <div className="px-3 py-2 bg-gradient-to-r from-amber-900/40 via-slate-900 to-amber-900/40 border-b border-amber-500/30">
            <div className="flex items-center gap-2">
              <Footprints className="w-4 h-4 text-amber-400" />
              <span className="font-black text-amber-300 tracking-wider text-sm">Locomotion Permissions</span>
              <span className="text-[10px] text-slate-500 font-normal ml-1">Component</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Control what locomotion modes users can access in this world.</p>
          </div>
          <div className="p-3 space-y-3">
            {/* Allowed locomotion modes */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-300">Allowed Locomotion Modes</span>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'walk' as LocomotionType, label: 'Walk', icon: Footprints, color: 'emerald' },
                  { id: 'flight' as LocomotionType, label: 'Flight', icon: Plane, color: 'cyan' },
                  { id: 'noclip' as LocomotionType, label: 'Noclip', icon: Wind, color: 'purple' },
                ]).map(({ id, label, icon: Icon, color }) => {
                  const allowed = settings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip'];
                  const isEnabled = allowed.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        const current = settings.locomotion?.allowedLocomotions ?? ['walk', 'flight', 'noclip'];
                        const next = isEnabled ? current.filter((m) => m !== id) : [...current, id];
                        // Ensure at least one mode is always allowed
                        if (next.length === 0) return;
                        onUpdateSettings({
                          locomotion: {
                            ...settings.locomotion,
                            allowedLocomotions: next,
                            scalingEnabled: settings.locomotion?.scalingEnabled ?? true,
                          },
                        });
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                        isEnabled
                          ? `bg-${color}-500/20 text-${color}-300 border-${color}-500/40`
                          : 'bg-slate-800/50 text-slate-500 border-slate-700/50 hover:bg-slate-700/50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Scaling permission */}
            <div className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-300">Self-Scale</span>
                <span className="text-[10px] text-slate-500">Allow users to resize themselves</span>
              </div>
              <button
                onClick={() => {
                  const current = settings.locomotion ?? { allowedLocomotions: ['walk', 'flight', 'noclip'] as LocomotionType[], scalingEnabled: true };
                  onUpdateSettings({
                    locomotion: {
                      ...current,
                      scalingEnabled: !current.scalingEnabled,
                    },
                  });
                }}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  (settings.locomotion?.scalingEnabled ?? true) ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  (settings.locomotion?.scalingEnabled ?? true) ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
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
