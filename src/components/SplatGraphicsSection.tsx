import React, { useEffect, useState } from 'react';
import { Sparkles, Gauge, AlertTriangle, Zap, Info } from 'lucide-react';
import type { GraphicsSettings } from '../engine/SceneEngine.ts';

/**
 * Preset options for the "Maximum splats" limiter. `undefined` is
 * "no limit" — Spark's `SparkRenderer.driveLod` falls back to its
 * platform default (500K-750K WebXR, 1-1.5M mobile, 2.5M desktop; see
 * `SparkRenderer.defaultSplatTarget()`) when the cap is undefined.
 *
 * The four numeric presets are the common buckets users hit in
 * practice:
 *   - 1M: authored for @native-density demos + hi-end desktop GPUs
 *   - 500k: high-quality Quest 3 sessions and dense desktop scenes
 *   - 200k: Quest 2 / mobile VR sweet spot (also the value SceneEngine
 *           applies automatically on VR entry if the user hasn't
 *           picked any preset — see SceneEngine.sessionstart for the
 *           rationale and the re-entry behaviour)
 *   - 100k: emergency "everything is choppy" floor
 *
 * Numbers are stored uncompressed; the splat count display & presets
 * stay readable without formatting.
 */
export const SPLAT_MAX_COUNT_PRESETS: Array<{ label: string; value: number | undefined }> = [
  { label: 'No Limit', value: undefined },
  { label: '1,000,000', value: 1_000_000 },
  { label: '500,000', value: 500_000 },
  { label: '200,000', value: 200_000 },
  { label: '100,000', value: 100_000 },
];

/**
 * Returns the matching preset label for a current `splatMaxCount`
 * value. If the current value isn't one of the known presets (e.g.
 * a future custom value), falls back to `String(n)` so users always
 * see *something* rather than a blank button. Used to highlight the
 * active preset button in the UI.
 */
function activePresetLabel(value: number | undefined): string {
  const match = SPLAT_MAX_COUNT_PRESETS.find((p) => p.value === value);
  return match ? match.label : String(value ?? '');
}

export interface SplatGraphicsSectionProps {
  settings: GraphicsSettings;
  onUpdateSettings: (newSettings: Partial<GraphicsSettings>) => void;
  /**
   * Optional SceneEngine reference. When provided, the section reads
   * the current `SparkRenderer.defaultSplatTarget()` so the "No
   * Limit" preset can show the platform default cap (e.g. "≈ 2.5M on
   * desktop") as a hint. Falls back to a generic explanation if not
   * provided (e.g. when embedded in a context without engine access).
   */
  sceneEngine?: { getDefaultSplatTarget: () => number | null } | null;
  /**
   * Compact mode removes the section header + the per-row explanation
   * text so the section can be embedded inline in panels that already
   * have their own header (e.g. DashMenu's settings tab). Default
   * false (verbose — looks great as a dedicated sub-page).
   */
  compact?: boolean;
}

/**
 * Shared splat-graphics sub-section. Used by:
 *  - `SettingsModal` (as a dedicated "Gaussian Splats" tab)
 *  - `DashMenu` (as the splat portion of the settings tab)
 *
 * Centralised here so the LOD enable/state, LOD scale, and Maximum
 * splats options render identically across the two surfaces. Both
 * callers pass the same `GraphicsSettings` slice + the same `Partial<GraphicsSettings>`
 * mutator; the renderer doesn't care where the data is coming from.
 *
 * Maximum splats is a LIVE control: changes are written to
 * `SparkRenderer.lodSplatCount` on every update and the Spark
 * runtime re-reads that field every frame in `driveLod`
 * (`this.lodSplatCount ?? defaultSplatCount`). Users see the new
 * cap take effect on the very next frame across every splat
 * asset in the world — no re-import required.
 */
export const SplatGraphicsSection: React.FC<SplatGraphicsSectionProps> = ({
  settings,
  onUpdateSettings,
  sceneEngine = null,
  compact = false,
}) => {
  const splatLodOn = settings.splatLodEnabled !== false;
  const currentMax = settings.splatMaxCount;
  const currentMaxLabel = activePresetLabel(currentMax);

  // Look up the platform-default LoD budget (500K-750K WebXR, 1-1.5M
  // mobile, 2.5M desktop) so the "No Limit" preset can show a useful
  // hint: "No Limit ≈ 2.5M on desktop". Spark's defaultSplatTarget()
  // probes the actual device tier; calling it on every render is
  // cheap (one switch statement) so we just invoke on each mount +
  // each settings change rather than memoizing.
  const [platformDefault, setPlatformDefault] = useState<number | null>(null);
  useEffect(() => {
    if (sceneEngine) {
      setPlatformDefault(sceneEngine.getDefaultSplatTarget());
    }
  }, [sceneEngine, currentMax]);
  return (
    <div className="space-y-3.5">
      {!compact && (
        <div className="flex items-center gap-3 pb-3 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shadow-sm">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold font-['Outfit'] tracking-wide text-white">
              Gaussian Splat Settings
            </h3>
            <p className="text-xs text-slate-400 leading-snug">
              Tune Spark RAD LOD generation, quality scaling, and VRAM caps for{' '}
              <span className="font-mono text-emerald-300">.ply</span>,{' '}
              <span className="font-mono text-emerald-300">.spz</span>,{' '}
              <span className="font-mono text-emerald-300">.splat</span>,{' '}
              <span className="font-mono text-emerald-300">.ksplat</span>,{' '}
              <span className="font-mono text-emerald-300">.sog</span>, and{' '}
              <span className="font-mono text-emerald-300">.rad</span> Gaussian splat assets.
            </p>
          </div>
        </div>
      )}

      {/* Spark RAD LOD master toggle */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Spark RAD / Auto-LODs
          </label>
          <span className={`text-xs font-mono font-bold ${splatLodOn ? 'text-emerald-300' : 'text-slate-500'}`}>
            {splatLodOn ? 'ON' : 'OFF'}
          </span>
        </div>
        <button
          onClick={() => onUpdateSettings({ splatLodEnabled: !splatLodOn })}
          className={`w-full btn btn-glass text-xs py-2 ${splatLodOn ? 'active bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold' : ''}`}
        >
          {splatLodOn ? '✓ Enabled — Spark RAD / Autogenerated LODs Active' : 'Click to enable Gaussian Splat LODs'}
        </button>
        {!compact && (
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Enables @sparkjsdev/spark RAD & autogenerated hierarchical LODs for Gaussian Splats.
            Drastically improves framerate and reduces memory bandwidth on large splat scenes.
          </p>
        )}
      </div>

      {/* LOD Distance / Quality Scale — only when LOD is on */}
      {splatLodOn && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-emerald-400" /> LOD Distance / Quality Multiplier
            </label>
            <span className="text-xs font-mono font-bold text-emerald-300">{(settings.splatLodScale ?? 1.0).toFixed(1)}x</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-white/5">
            {[0.5, 1.0, 1.5, 2.0].map((val) => (
              <button
                key={val}
                onClick={() => onUpdateSettings({ splatLodScale: val })}
                className={`py-1.5 rounded-lg text-xs font-bold border transition ${
                  (settings.splatLodScale ?? 1.0) === val
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                {val}x
              </button>
            ))}
          </div>
          {!compact && (
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Scales how aggressively Spark drops high-detail splat LODs at distance.{' '}
              <span className="font-mono text-slate-400">0.5x</span> = aggressive LOD (less detail
              off-screen), <span className="font-mono text-slate-400">2.0x</span> = preserve
              detail at distance.
            </p>
          )}
        </div>
      )}

      {/* Maximum Splats cap. This is the LIVE runtime control wired
          through `SparkRenderer.lodSplatCount` (see SceneEngine.updateSettings
          for the wire-through). Changes are picked up by Spark's
          `driveLod` on the very next frame — no re-import needed. */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-emerald-400" /> Maximum Splats
          </label>
          <span className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
              <Zap className="w-2.5 h-2.5" /> Live
            </span>
            <span className="text-xs font-mono font-bold text-emerald-300">{currentMaxLabel}</span>
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-white/5">
          {SPLAT_MAX_COUNT_PRESETS.map((preset) => {
            const isActive =
              (preset.value === undefined && currentMax === undefined) ||
              preset.value === currentMax;
            return (
              <button
                key={preset.label}
                onClick={() => onUpdateSettings({ splatMaxCount: preset.value, splatMaxCountUserTouched: true })}
                className={`py-1.5 rounded-lg text-[11px] font-bold border transition ${
                  isActive
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
                }`}
                title={
                  preset.value === undefined
                    ? 'No cap on this client — Spark uses its platform default (500K-2.5M depending on device tier).'
                    : `Cap the LoD budget at ${preset.value.toLocaleString()} splats across all splat assets.`
                }
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        {/* Custom Max Splats Number Input */}
        <div className="flex items-center gap-2 bg-slate-900/60 p-2 rounded-xl border border-white/5">
          <span className="text-xs text-slate-300 font-medium whitespace-nowrap">Custom Max Splats:</span>
          <input
            type="number"
            min={1000}
            max={20000000}
            step={10000}
            placeholder="Enter custom max number..."
            value={currentMax ?? ''}
            onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
              onUpdateSettings({ splatMaxCount: val && !isNaN(val) ? val : undefined, splatMaxCountUserTouched: true });
            }}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500 transition"
          />
          {currentMax !== undefined && (
            <button
              onClick={() => onUpdateSettings({ splatMaxCount: undefined, splatMaxCountUserTouched: true })}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-300 transition"
            >
              Reset
            </button>
          )}
        </div>
        {!compact && (
          <>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Live cap on the total # of splats the local client renders across every splat
              asset's LoD tree. Lower this on mobile VR or dense scenes to keep frame times
              stable; raise it for demo playthroughs on desktop. Changes take effect on the
              next frame — no re-import required.
            </p>
            {currentMax === undefined && platformDefault && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-200">
                <Info className="w-3.5 h-3.5 text-cyan-300 shrink-0 mt-0.5" />
                <p className="text-[10px] leading-relaxed">
                  <strong className="font-bold">No Limit</strong> uses Spark's platform default
                  of{' '}
                  <span className="font-mono text-cyan-300">
                    {platformDefault.toLocaleString()}
                  </span>{' '}
                  splats for this device tier (500K-750K WebXR, 1-1.5M mobile, 2.5M desktop).
                </p>
              </div>
            )}
            {currentMax && currentMax >= 500_000 && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-300 shrink-0 mt-0.5" />
                <p className="text-[10px] leading-relaxed">
                  <strong className="font-bold">High VRAM warning.</strong> Caps above{' '}
                  {currentMax.toLocaleString()} splats may out-of-memory crash mobile VR
                  headsets (Quest 2/3) when visiting dense scenes.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
