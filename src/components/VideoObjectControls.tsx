import React, { useEffect, useRef } from 'react';
import type { VideoPlaybackState } from '../engine/AssetManager.ts';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Globe2,
  User,
} from 'lucide-react';

export interface VideoObjectControlsProps {
  /** Live playback state mirror. Read-only — the parent drives mutations via callbacks. */
  state: VideoPlaybackState;
  onPlay: () => void;
  onPause: () => void;
  /** Seek to a specific time (seconds). Clamped to [0, duration]. */
  onSeek: (time: number) => void;
  /** Step the playhead by `deltaSec` seconds. */
  onStep: (deltaSec: number) => void;
  /** Adjust the currently active volume (per volumeMode). */
  onVolumeChange: (vol: number) => void;
  /** Toggle between global (broadcasts) and local (per-user only). */
  onVolumeModeToggle: (mode: 'global' | 'local') => void;
  /** Personal mute toggle. NEVER broadcasts. */
  onMuteToggle: () => void;
}

/**
 * Format `seconds` as `M:SS`. Pure helper.
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Compact in-world video controls rendered as a 3D panel attached to the
 * video object itself. Layout (per user request):
 *   • timeline strip on the BOtTOM edge
 *   • play/pause button at the bottom-LEFT corner
 *   • vertical volume bar on the RIGHT
 *   • Global / Local toggle beneath the volume bar (right-bottom corner)
 *
 * Same callback contract as `VideoControls.tsx` so App.tsx can wire this
 * through the existing `handleVideoAction` / `handleVideoClose`
 * pipeline. Reads `state.playing / state.currentTime / state.duration /
 * state.globalVolume / state.localVolume / state.volumeMode / state.muted`
 * directly. Timeline progress is animated imperatively via a rAF loop
 * reading the currentTime so the bar moves smoothly without React
 * re-renders 4x/sec.
 */
export const VideoObjectControls: React.FC<VideoObjectControlsProps> = ({
  state,
  onPlay,
  onPause,
  onSeek,
  // onStep kept in the prop surface for parity with VideoControls but
  // unused at the moment — the in-world UI exposes Play/Pause + Scrub
  // + Volume + Mode which cover the common cases without a skip control.
  onStep: _onStep,
  onVolumeChange,
  onVolumeModeToggle,
  onMuteToggle,
}) => {
  // Refs for live timeline sync (the only animating element on the panel).
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const durationRef = useRef<HTMLSpanElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // Drive the timeline-track imperatively so scrubbing + timeupdate produce
  // smooth motion without React thrash. Reads `state` directly via the
  // captured object reference (the live VideoPlaybackState object is
  // MUTATED in place by AssetManager's timeupdate listener — not
  // re-assigned — so .currentTime reads back the live value every
  // animation frame).
  // CRITICAL: dependency array deliberately omits `state.currentTime`.
  // Including it would re-run this effect and restart the rAF every
  // time `timeupdate` fires (~4 Hz in browsers), tearing down + re-
  // creating the animation loop ~4 times per second. The result is
  // a choppy timeline rather than the smooth rAF-driven progress this
  // effect is meant to provide. `state.duration` is included because
  // a new asset's duration can flip 0 → real after `loadedmetadata`
  // fires, and a fresh tick setup ensures the imperative render of
  // the 0/0 → X/Y progress starts on the right foot.
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const dur = state.duration || 0;
      const cur = state.currentTime || 0;
      const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
      if (fillRef.current) fillRef.current.style.width = `${ratio * 100}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${ratio * 100}%`;
      const nextTimeText = formatTime(cur);
      if (timeRef.current && timeRef.current.textContent !== nextTimeText) {
        timeRef.current.textContent = nextTimeText;
      }
      const nextDurText = formatTime(dur);
      if (durationRef.current && durationRef.current.textContent !== nextDurText) {
        durationRef.current.textContent = nextDurText;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- currentTime is read live
  }, [state.duration]);

  // Timeline-scrub drag handler. Clicking or dragging anywhere on the
  // strip seeks to that time. Pointer capture keeps the drag alive
  // even if the cursor leaves the strip.
  const beginScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !(state.duration > 0)) return;
    const track = timelineRef.current;
    try { track.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const update = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const cx = Math.max(rect.left, Math.min(rect.right, clientX));
      const ratio = (cx - rect.left) / Math.max(1, rect.width);
      onSeek(ratio * state.duration);
    };
    update(e.clientX);
    const move = (ev: PointerEvent) => update(ev.clientX);
    const up = (ev: PointerEvent) => {
      try { track.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  };

  // Vertical volume-slider renderer. Reads/writes via spread onChange
  // (range input is 0..100 mapped to 0..1).
  const activeVolume = state.volumeMode === 'global' ? state.globalVolume : state.localVolume;
  const displayedVolume = state.muted ? 0 : activeVolume;

  return (
    /* Outer panel — relative positioning contains the absolute-positioned
       child controls. pointer-events-auto so the in-world panel DOM
       receives clicks (combo'd with the SpatialPanelManager's
       domContainer pointer-events fix, this routes clicks to the
       buttons / sliders whereas empty panel space falls through). */
    <div
      className="relative w-full h-full bg-gradient-to-br from-slate-900/85 via-slate-950/85 to-slate-900/85 rounded-lg border border-fuchsia-500/40 shadow-[0_0_18px_rgba(236,72,153,0.25)] overflow-hidden select-none touch-none"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Mute toggle — top-LEFT corner so it doesn't conflict with
          play/pause-bottom-left and volume-vertical-right. */}
      <button
        onClick={onMuteToggle}
        title={state.muted ? 'Unmute audio' : 'Mute audio'}
        className={`absolute top-1.5 left-1.5 p-1 rounded-md transition border text-[10px] ${
          state.muted
            ? 'bg-rose-500/30 text-rose-200 border-rose-500/50 hover:bg-rose-500/40'
            : 'bg-slate-800/80 text-slate-200 border-slate-700 hover:bg-cyan-500/20 hover:text-cyan-200 hover:border-cyan-500/40'
        }`}
      >
        {state.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
      </button>

      {/* Play/Pause — bottom-LEFT corner per the user's spec. */}
      <button
        onClick={() => (state.playing ? onPause() : onPlay())}
        disabled={state.duration <= 0}
        title={state.playing ? 'Pause' : 'Play'}
        className={`absolute bottom-2 left-2 p-2 rounded-lg transition border shadow-md ${
          state.playing
            ? 'bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 border-amber-500/50 hover:border-amber-500/70'
            : 'bg-emerald-500/25 hover:bg-emerald-500/40 text-emerald-200 border-emerald-500/50 hover:border-emerald-500/70'
        } disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        {state.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>

      {/* Timeline strip — bottom edge spanning from play/pause to volume.
          Uses pointer capture so drag-outside the strip still tracks.
          Imperative rAF fills progress without React render churn. */}
      <div
        ref={timelineRef}
        onPointerDown={beginScrub}
        className="absolute bottom-2 left-12 right-12 h-2.5 bg-slate-800/80 rounded-full border border-slate-700 cursor-pointer hover:border-fuchsia-500/50 transition overflow-hidden"
        title="Click or drag to seek"
        style={{ pointerEvents: 'auto' }}
      >
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-fuchsia-500 to-cyan-400 rounded-full transition-[width] duration-100 ease-linear"
          style={{ width: '0%' }}
        />
        <div
          ref={thumbRef}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow shadow-fuchsia-500/50 transition-[left] duration-100 ease-linear pointer-events-none"
          style={{ left: '0%' }}
        />
      </div>

      {/* Timeline labels (current / duration) — bottom row under the strip.
          They visually show M:SS / M:SS. `flex justify-between` keeps them
          pinned to the same x-extent as the strip above. */}
      <div className="absolute bottom-0 left-12 right-12 flex justify-between items-center text-[8px] font-mono text-slate-300 pointer-events-none">
        <span ref={timeRef} className="text-cyan-300 font-bold">{formatTime(state.currentTime)}</span>
        <span ref={durationRef} className="text-slate-400">{formatTime(state.duration)}</span>
      </div>

      {/* Vertical volume slider — right edge, full inner height. Custom
          writing-mode + appearance slider so a standard <input type=range>
          renders vertically. Easier to maintain than a custom grabber
          surface, and we already lean on `accent-fuchsia-400` for the
          other inline players' styling. */}
      <div
        className="absolute top-2 right-1.5 bottom-10 w-3 flex items-center justify-center"
        title={`${state.volumeMode === 'global' ? 'Global' : 'Local'} volume`}
      >
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(displayedVolume * 100)}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10) / 100;
            if (Number.isFinite(next)) onVolumeChange(next);
          }}
          disabled={state.duration <= 0}
          aria-label={`${state.volumeMode === 'global' ? 'Global' : 'Local'} volume`}
          className="accent-fuchsia-400 cursor-pointer disabled:opacity-30"
          style={{
            writingMode: 'vertical-lr' as any,
            WebkitAppearance: 'slider-vertical' as any,
            width: '14px',
            height: '100%',
            minHeight: '60px',
          } as React.CSSProperties}
        />
      </div>

      {/* Volume percentage readout — pinched into the top-right so the
          vertical slider label is readable even when the panel is small. */}
      <div className="absolute top-1.5 right-7 text-[8px] font-mono font-bold text-fuchsia-300 pointer-events-none">
        {Math.round(displayedVolume * 100)}%
      </div>

      {/* Global / Local toggle — beneath the volume bar at the bottom-right
          corner per the user's spec. Two stacked mini-buttons; the active
          mode is highlighted. */}
      <div className="absolute bottom-1.5 right-1.5 flex flex-col gap-1">
        <button
          onClick={() => onVolumeModeToggle('global')}
          title="Volume changes broadcast to all peers (shared volume)"
          className={`p-0.5 rounded-sm transition border text-[8px] font-bold flex items-center justify-center ${
            state.volumeMode === 'global'
              ? 'bg-cyan-500/30 text-cyan-200 border-cyan-500/50'
              : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-cyan-300 hover:border-cyan-500/40'
          }`}
        >
          <Globe2 className="w-2.5 h-2.5" />
        </button>
        <button
          onClick={() => onVolumeModeToggle('local')}
          title="Volume changes only affect your playback (per-user)"
          className={`p-0.5 rounded-sm transition border text-[8px] font-bold flex items-center justify-center ${
            state.volumeMode === 'local'
              ? 'bg-fuchsia-500/30 text-fuchsia-200 border-fuchsia-500/50'
              : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-fuchsia-300 hover:border-fuchsia-500/40'
          }`}
        >
          <User className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
};
