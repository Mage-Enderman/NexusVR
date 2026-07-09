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
  Film,
  X,
  Square,
  Repeat,
  Link as LinkIcon,
} from 'lucide-react';

export interface VideoObjectControlsProps {
  /** Live playback state mirror. Read-only — the parent drives mutations via callbacks. */
  state: VideoPlaybackState;
  /** Optional asset name displayed in the top bar */
  assetName?: string;
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
  /** Optional close overlay handler */
  onClose?: () => void;
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
 * Polished, accessible overlay UI for video playback.
 * Renders directly over the video player screen as a frameless spatial overlay.
 */
export const VideoObjectControls: React.FC<VideoObjectControlsProps> = ({
  state,
  assetName,
  onPlay,
  onPause,
  onSeek,
  onStep,
  onVolumeChange,
  onVolumeModeToggle,
  onMuteToggle,
  onClose,
}) => {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const durationRef = useRef<HTMLSpanElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const volumeTrackRef = useRef<HTMLDivElement | null>(null);

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
  }, [state.duration]);

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

  const beginVolumeScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!volumeTrackRef.current) return;
    const track = volumeTrackRef.current;
    try { track.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const update = (clientY: number) => {
      const rect = track.getBoundingClientRect();
      const cy = Math.max(rect.top, Math.min(rect.bottom, clientY));
      const ratio = 1 - (cy - rect.top) / Math.max(1, rect.height);
      onVolumeChange(Math.max(0, Math.min(1, ratio)));
    };
    update(e.clientY);
    const move = (ev: PointerEvent) => update(ev.clientY);
    const up = (ev: PointerEvent) => {
      try { track.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  };

  const activeVolume = state.volumeMode === 'global' ? state.globalVolume : state.localVolume;
  const displayedVolume = state.muted ? 0 : activeVolume;

  return (
    <div className="w-full h-full flex flex-col justify-between bg-transparent text-white font-sans select-none overflow-hidden pointer-events-none">
      {/* Top Bar Overlay */}
      <div className="w-full flex items-start justify-between p-6 bg-gradient-to-b from-slate-950/95 via-slate-950/70 to-transparent pointer-events-auto">
        <div className="flex flex-col">
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-md flex items-center gap-2.5">
            <span>VideoPlayer</span>
          </h1>
          <div className="mt-2.5 px-4 py-1.5 rounded-xl bg-slate-900/85 border border-slate-800/80 text-slate-300 text-sm italic inline-flex items-center gap-2 shadow-inner w-fit">
            <Film className="w-4 h-4 text-purple-400 shrink-0" />
            <span className="truncate max-w-[400px]">{assetName || 'Enter URL Here'}</span>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            title="Close Overlay"
            className="w-11 h-11 rounded-full bg-rose-500/25 hover:bg-rose-500/40 border border-rose-500/50 text-rose-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shadow-lg"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Middle Row Overlay: Transparent center with Right-side Vertical Audio Controls */}
      <div className="w-full flex-1 flex items-center justify-end px-6 pointer-events-none">
        <div className="pointer-events-auto flex flex-col items-center gap-3 py-4 px-3 rounded-full bg-slate-950/85 backdrop-blur-md border border-slate-800/80 shadow-2xl">
          <button
            onClick={onMuteToggle}
            title={state.muted ? 'Unmute audio' : 'Mute audio'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              state.muted
                ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            {state.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-purple-400" />}
          </button>

          {/* Vertical Volume Slider Track */}
          <div
            ref={volumeTrackRef}
            onPointerDown={beginVolumeScrub}
            className="h-32 w-4 rounded-full bg-slate-900/95 border border-slate-800 overflow-hidden relative cursor-pointer shadow-inner"
            title={`Volume: ${Math.round(displayedVolume * 100)}%`}
          >
            <div
              className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-purple-600 via-fuchsia-500 to-pink-400 transition-[height] duration-75 ease-linear rounded-full"
              style={{ height: `${displayedVolume * 100}%` }}
            />
          </div>

          <button
            onClick={() => onVolumeModeToggle(state.volumeMode === 'global' ? 'local' : 'global')}
            title={`Audio Mode: ${state.volumeMode === 'global' ? 'Global (broadcast)' : 'Local (headset only)'}`}
            className="w-9 h-9 rounded-full bg-purple-500/20 hover:bg-purple-500/40 border border-purple-500/40 text-purple-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
          >
            {state.volumeMode === 'global' ? <Globe2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Bottom Bar Overlay: Timeline Row & Playback Controls Row */}
      <div className="w-full flex flex-col gap-4 p-6 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-transparent pointer-events-auto">
        {/* Row 1: Scrub Timeline */}
        <div className="flex items-center gap-4">
          <span ref={timeRef} className="text-base font-mono font-medium text-slate-200 min-w-[52px]">
            {formatTime(state.currentTime)}
          </span>

          <div
            ref={timelineRef}
            onPointerDown={beginScrub}
            className="flex-1 h-3.5 bg-slate-900/90 rounded-full border border-slate-800 relative cursor-pointer group shadow-inner"
            title="Click or drag to seek"
          >
            <div
              ref={fillRef}
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-600 via-fuchsia-500 to-pink-400 rounded-full transition-[width] duration-75 ease-linear"
              style={{ width: '0%' }}
            />
            <div
              ref={thumbRef}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full border-2 border-purple-400 shadow-[0_0_12px_rgba(192,132,252,0.8)] opacity-95 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ left: '0%' }}
            />
          </div>

          <span ref={durationRef} className="text-base font-mono font-medium text-slate-300 min-w-[52px] text-right">
            {formatTime(state.duration)}
          </span>
        </div>

        {/* Row 2: Playback Controls Row */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => (state.playing ? onPause() : onPlay())}
              disabled={state.duration <= 0}
              title={state.playing ? 'Pause' : 'Play'}
              className="w-13 h-13 px-4 py-3 rounded-2xl bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white flex items-center justify-center shadow-[0_0_25px_rgba(168,85,247,0.5)] transition-all cursor-pointer disabled:opacity-30"
            >
              {state.playing ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-0.5" />}
            </button>

            <button
              onClick={() => onStep(-5)}
              disabled={state.duration <= 0}
              title="Rewind 5 seconds"
              className="w-11 h-11 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-30"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              onClick={() => {
                onSeek(0);
                onPause();
              }}
              disabled={state.duration <= 0}
              title="Stop playback"
              className="w-11 h-11 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-30"
            >
              <Square className="w-5 h-5" />
            </button>

            <button
              onClick={() => onStep(5)}
              disabled={state.duration <= 0}
              title="Fast forward 5 seconds"
              className="w-11 h-11 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-30"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              onClick={() => onSeek(0)}
              title="Restart video"
              className="w-11 h-11 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            >
              <Repeat className="w-5 h-5" />
            </button>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                // Future copy link or open URL modal
              }}
              title="Video Source"
              className="w-11 h-11 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            >
              <LinkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
