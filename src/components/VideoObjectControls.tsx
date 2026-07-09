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
  Trash2,
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
  /** Optional close overlay handler (triggered when clicking empty space) */
  onClose?: () => void;
  /** Destroy / remove the video asset from the scene */
  onRemoveVideo?: () => void;
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
  onRemoveVideo,
}) => {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const durationRef = useRef<HTMLSpanElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const volumeTrackRef = useRef<HTMLDivElement | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const dur = stateRef.current.duration || 0;
      const cur = stateRef.current.currentTime || 0;
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
  }, []);

  const beginScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
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
    e.stopPropagation();
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
    <div
      onClick={() => onClose?.()}
      className="w-full h-full flex flex-col justify-between bg-transparent text-white font-sans select-none overflow-hidden pointer-events-auto cursor-pointer"
      title="Click empty space to close overlay"
    >
      {/* Top Bar Overlay */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full flex items-start justify-between p-6 bg-gradient-to-b from-slate-950/95 via-slate-950/70 to-transparent cursor-default"
      >
        <div className="flex flex-col">
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-md flex items-center gap-2.5">
            <span>VideoPlayer</span>
          </h1>
          <div className="mt-2.5 px-4 py-1.5 rounded-xl bg-[#181a20]/90 border border-slate-700/80 text-slate-300 text-sm italic inline-flex items-center gap-2 shadow-inner w-fit">
            <Film className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate max-w-[400px]">{assetName || 'Enter URL Here'}</span>
          </div>
        </div>

        {onRemoveVideo && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveVideo();
            }}
            title="Destroy Video Asset"
            className="btn-dark-slate"
            style={{ borderColor: 'rgba(244,63,94,0.6)', color: '#fda4af' }}
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Middle Row Overlay: Empty center clicks close UI, Right-side Audio Controls don't */}
      <div className="w-full flex-1 flex items-center justify-end px-6 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex flex-col items-center gap-3 py-4 px-3 rounded-full bg-[#181a20]/95 backdrop-blur-md border border-slate-700/80 shadow-2xl cursor-default"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMuteToggle();
            }}
            title={state.muted ? 'Unmute audio' : 'Mute audio'}
            className="btn-dark-slate"
          >
            {state.muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5 text-amber-400" />}
          </button>

          {/* Vertical Volume Slider Track */}
          <div
            ref={volumeTrackRef}
            onPointerDown={beginVolumeScrub}
            className="h-32 w-4 rounded-full bg-[#0a0d14] border border-slate-700 overflow-hidden relative cursor-pointer shadow-inner"
            title={`Volume: ${Math.round(displayedVolume * 100)}%`}
          >
            <div
              className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-amber-500 via-amber-400 to-yellow-300 transition-[height] duration-75 ease-linear rounded-full"
              style={{ height: `${displayedVolume * 100}%` }}
            />
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onVolumeModeToggle(state.volumeMode === 'global' ? 'local' : 'global');
            }}
            title={`Audio Mode: ${state.volumeMode === 'global' ? 'Global (broadcast)' : 'Local (headset only)'}`}
            className="btn-dark-slate"
          >
            {state.volumeMode === 'global' ? <Globe2 className="w-5 h-5" /> : <User className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Bottom Bar Overlay: Timeline Row & Playback Controls Row */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full flex flex-col gap-4 p-6 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-transparent cursor-default"
      >
        {/* Row 1: Scrub Timeline */}
        <div className="flex items-center gap-4">
          <span ref={timeRef} className="text-base font-mono font-medium text-slate-200 min-w-[52px]">
            {formatTime(state.currentTime)}
          </span>

          <div
            ref={timelineRef}
            onPointerDown={beginScrub}
            className="flex-1 relative cursor-pointer"
            style={{
              backgroundColor: '#0a0d14',
              height: '14px',
              borderRadius: '9999px',
              border: '1px solid rgba(51, 65, 85, 0.85)',
              boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.6)'
            }}
            title="Click or drag to seek"
          >
            <div
              ref={fillRef}
              style={{
                width: '0%',
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                background: 'linear-gradient(90deg, #f59e0b, #fbbf24, #fde047)',
                borderRadius: '9999px',
                boxShadow: '0 0 10px rgba(251, 191, 36, 0.5)',
                transition: 'width 75ms linear'
              }}
            />
            <div
              ref={thumbRef}
              style={{
                left: '0%',
                position: 'absolute',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '20px',
                height: '20px',
                backgroundColor: '#ffffff',
                border: '3px solid #fbbf24',
                borderRadius: '50%',
                boxShadow: '0 0 14px rgba(251, 191, 36, 0.9)',
                pointerEvents: 'none'
              }}
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
              onClick={(e) => {
                e.stopPropagation();
                state.playing ? onPause() : onPlay();
              }}
              disabled={state.duration <= 0}
              title={state.playing ? 'Pause' : 'Play'}
              className="btn-dark-slate-lg"
            >
              {state.playing ? <Pause className="w-6 h-6 fill-amber-300" /> : <Play className="w-6 h-6 fill-amber-300 ml-0.5" />}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onStep(-5);
              }}
              disabled={state.duration <= 0}
              title="Rewind 5 seconds"
              className="btn-dark-slate"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onSeek(0);
                onPause();
              }}
              disabled={state.duration <= 0}
              title="Stop playback"
              className="btn-dark-slate"
            >
              <Square className="w-5 h-5" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onStep(5);
              }}
              disabled={state.duration <= 0}
              title="Fast forward 5 seconds"
              className="btn-dark-slate"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onSeek(0);
              }}
              title="Restart video"
              className="btn-dark-slate"
            >
              <Repeat className="w-5 h-5" />
            </button>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
              }}
              title="Video Source"
              className="btn-dark-slate"
            >
              <LinkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
