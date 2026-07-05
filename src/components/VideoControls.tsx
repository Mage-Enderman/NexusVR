import React, { useEffect, useRef } from 'react';
import type { VideoPlaybackState } from '../engine/AssetManager.ts';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Globe2,
  User,
  SkipBack,
  SkipForward,
  X,
  RotateCcw,
} from 'lucide-react';

export interface VideoControlsProps {
  /** Live playback state mirror. Read-only — the parent drives mutations via callbacks. */
  state: VideoPlaybackState;
  /** Set playing state. Element-level autoplay-rejection is handled inside the asset manager. */
  onPlay: () => void;
  onPause: () => void;
  /** Seek to a specific time (seconds). Clamped to [0, duration]. */
  onSeek: (time: number) => void;
  /** Step the playhead by `deltaSec` seconds (negative = backward). Internally clamps. */
  onStep: (deltaSec: number) => void;
  /** Adjust the volume that's currently "active" (per the volumeMode below). */
  onVolumeChange: (vol: number) => void;
  /** Toggle between global (broadcasts) and local (per-user only). */
  onVolumeModeToggle: (mode: 'global' | 'local') => void;
  /** Personal mute toggle. NEVER broadcasts. */
  onMuteToggle: () => void;
  /** Close the video — typically removes the asset. */
  onClose: () => void;
  /**
   * If true, render with no header / actions row (compact mode). Used
   * when the controls are embedded inside a section of another panel
   * like the inspector. Defaults to false (standalone panel mode).
   */
  compact?: boolean;
}

/**
 * Format `seconds` as `M:SS` (or `H:MM:SS` if ≥ 1h). Pure helper,
 * no allocation. Single-pass floor + pad.
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Desktop video controls pane.
 *
 * Driven by the parent's `state` prop (read-only mirror of the
 * asset's userData.videoState). The parent is responsible for
 * applying mutations through AssetManager.applyVideoState AND for
 * broadcasting through NetworkService.broadcastVideoState. This
 * component is a "dumb" UI — it doesn't own logic, just emits user
 * intent and trusts the parent to wire it up.
 *
 * Timeline progress is reflected imperatively via a rAF loop read
 * from the same source-of-truth object — that way scrubbing + the
 * network-applied seek + the actual playback position all stay
 * visually consistent without React having to re-render at 30Hz.
 */
export const VideoControls: React.FC<VideoControlsProps> = ({
  state,
  onPlay,
  onPause,
  onSeek,
  onStep,
  onVolumeChange,
  onVolumeModeToggle,
  onMuteToggle,
  onClose,
  compact = false,
}) => {
  // Refs for live sync of inputs that change continuously (timeline
  // fill, time labels). The component renders infrequently; an rAF
  // loop writes the values so the user sees smooth progress without
  // React thrash. Reads from `state` directly so it always reflects
  // the asset's actual playback engine state.
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const durationRef = useRef<HTMLSpanElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

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
      if (timeRef.current && timeRef.current.textContent !== formatTime(cur)) {
        timeRef.current.textContent = formatTime(cur);
      }
      if (durationRef.current && durationRef.current.textContent !== formatTime(dur)) {
        durationRef.current.textContent = formatTime(dur);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [state.duration, state.currentTime]);

  // Derive active volume for the slider from whichever mode the
  // user picked. Mute is a separate, orthogonal boolean that
  // multiplies the active volume to zero — the slider value tracks
  // the un-muted "remembered" level so unmuting restores the
  // user's previous listen level.
  const activeVolume = state.volumeMode === 'global' ? state.globalVolume : state.localVolume;
  const displayedVolume = state.muted ? 0 : activeVolume;

  // Track-drag seek handler. Calculates the offset from the click
  // point as a fraction of the visible track width, then converts
  // back to seconds. pointer capture ensures drag-outside-the-track
  // still tracks; pointerup finalizes the seek (the parent's apply
  // is fired once at the end so we don't spam a `vidstate`
  // broadcast frame-by-frame).
  const beginScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackRef.current || !(state.duration > 0)) return;
    const track = trackRef.current;
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

  // Volume slider handler. Pretty much identical to scrub but for
  // the active volume knob. The slider's `max=100` represents 0..1
  // scaled by 100 for integer step on the input element.
  const handleVolumeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseInt(e.target.value, 10) / 100;
    if (Number.isFinite(next)) onVolumeChange(next);
  };

  return (
    <div className={`flex flex-col gap-2 bg-gradient-to-br from-slate-900/90 via-slate-950/90 to-slate-900/90 rounded-xl border border-fuchsia-500/30 p-3 shadow-lg shadow-fuchsia-500/10 ${compact ? '' : 'mt-1'}`}>
      {/* Title row (hidden in compact mode — caller already has its own header) */}
      {!compact && (
        <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
          <span className="text-xs font-extrabold text-fuchsia-300 uppercase tracking-widest flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5" /> Video Controls
          </span>
          <button
            onClick={onClose}
            title="Remove video from world"
            className="p-1 rounded-md hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition border border-transparent hover:border-rose-500/40"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Playhead row — play/pause + skip-back/forward + timeline track */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onStep(-5)}
          disabled={state.duration <= 0}
          title="Skip back 5 seconds"
          className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 disabled:opacity-30 disabled:hover:bg-slate-800/80 disabled:hover:text-slate-300"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => (state.playing ? onPause() : onPlay())}
          title={state.playing ? 'Pause' : 'Play'}
          className={`p-2 rounded-lg transition border shadow-md ${
            state.playing
              ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40 hover:border-amber-500/60'
              : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40 hover:border-emerald-500/60'
          }`}
        >
          {state.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={() => onStep(5)}
          disabled={state.duration <= 0}
          title="Skip forward 5 seconds"
          className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 disabled:opacity-30 disabled:hover:bg-slate-800/80 disabled:hover:text-slate-300"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onSeek(0)}
          disabled={state.duration <= 0}
          title="Restart from beginning"
          className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 disabled:opacity-30 disabled:hover:bg-slate-800/80 disabled:hover:text-slate-300"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1 flex flex-col gap-1 ml-1.5">
          {/* Timeline track: imperatively updated width / thumb position via rAF */}
          <div
            ref={trackRef}
            onPointerDown={beginScrub}
            className="relative h-2.5 bg-slate-800/80 rounded-full cursor-pointer overflow-hidden border border-slate-700 hover:border-fuchsia-500/40 transition select-none touch-none"
            title="Click or drag to seek"
          >
            <div
              ref={fillRef}
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-fuchsia-500 to-cyan-400 rounded-full transition-[width] duration-100 ease-linear"
              style={{ width: '0%' }}
            />
            <div
              ref={thumbRef}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md shadow-fuchsia-500/40 transition-[left] duration-100 ease-linear pointer-events-none"
              style={{ left: '0%' }}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] font-mono">
            <span ref={timeRef} className="text-cyan-300 font-bold">{formatTime(state.currentTime)}</span>
            <span ref={durationRef} className="text-slate-400">{formatTime(state.duration)}</span>
          </div>
        </div>
      </div>

      {/* Volume row — slider + mute toggle + active volume readout */}
      <div className="flex items-center gap-2">
        <button
          onClick={onMuteToggle}
          title={state.muted ? 'Unmute audio' : 'Mute audio'}
          className={`p-1.5 rounded-lg transition border ${
            state.muted
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-cyan-500/20 hover:text-cyan-300 hover:border-cyan-500/40'
          }`}
        >
          {state.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <div className="flex-1 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(displayedVolume * 100)}
            onChange={handleVolumeInput}
            disabled={state.duration <= 0}
            className="flex-1 accent-fuchsia-400 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={`${state.volumeMode === 'global' ? 'Global' : 'Local'} volume`}
          />
          <span className="text-[11px] font-mono font-bold text-fuchsia-300 w-10 text-right">
            {Math.round(displayedVolume * 100)}%
          </span>
        </div>
      </div>

      {/* Mode toggle — below the slider per the user's request */}
      <div className="flex items-center gap-2 pt-1 border-t border-white/5">
        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Apply Volume</span>
        <button
          onClick={() => onVolumeModeToggle('global')}
          title="Volume changes broadcast to all peers (shared volume)"
          className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition border ${
            state.volumeMode === 'global'
              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
              : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-slate-300'
          }`}
        >
          <Globe2 className="w-3.5 h-3.5" />
          <span>Globally</span>
        </button>
        <button
          onClick={() => onVolumeModeToggle('local')}
          title="Volume changes only affect your playback"
          className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition border ${
            state.volumeMode === 'local'
              ? 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40 shadow-[0_0_10px_rgba(236,72,153,0.2)]'
              : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-slate-300'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Locally</span>
        </button>
      </div>
    </div>
  );
};
