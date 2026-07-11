import React, { useEffect, useRef } from 'react';
import type { VideoPlaybackState } from '../engine/AssetManager.ts';
import { Film } from 'lucide-react';

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
  /** Sync mode: persistent chunk stream vs live watch party stream */
  syncMode?: 'persistent' | 'watch-party';
  /** Toggle sync mode */
  onSyncModeToggle?: (mode: 'persistent' | 'watch-party') => void;
  /** Whether the current user can toggle sync mode (must be host or file owner) */
  canToggleSyncMode?: boolean;
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
  syncMode,
  onSyncModeToggle,
  canToggleSyncMode = true,
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
    const getRatio = (clientX: number, offsetX?: number, target?: any) => {
      if (typeof offsetX === 'number' && track.clientWidth > 0 && target === track) {
        return Math.max(0, Math.min(1, offsetX / track.clientWidth));
      }
      const rect = track.getBoundingClientRect();
      const cx = Math.max(rect.left, Math.min(rect.right, clientX));
      return (cx - rect.left) / Math.max(1, rect.width);
    };
    onSeek(getRatio(e.clientX, e.nativeEvent?.offsetX, e.target) * state.duration);
    const move = (ev: PointerEvent) => {
      onSeek(getRatio(ev.clientX, ev.offsetX, ev.target) * state.duration);
    };
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
    const getRatio = (clientY: number, offsetY?: number, target?: any) => {
      if (typeof offsetY === 'number' && track.clientHeight > 0 && target === track) {
        return Math.max(0, Math.min(1, 1 - offsetY / track.clientHeight));
      }
      const rect = track.getBoundingClientRect();
      const cy = Math.max(rect.top, Math.min(rect.bottom, clientY));
      return 1 - (cy - rect.top) / Math.max(1, rect.height);
    };
    onVolumeChange(getRatio(e.clientY, e.nativeEvent?.offsetY, e.target));
    const move = (ev: PointerEvent) => {
      onVolumeChange(getRatio(ev.clientY, ev.offsetY, ev.target));
    };
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
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <div className="px-4 py-1.5 rounded-xl bg-[#181a20]/90 border border-slate-700/80 text-slate-300 text-sm italic inline-flex items-center gap-2 shadow-inner w-fit">
              <Film className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate max-w-[400px]">{assetName || 'Enter URL Here'}</span>
            </div>
            {syncMode && (
              canToggleSyncMode ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSyncModeToggle?.(syncMode === 'persistent' ? 'watch-party' : 'persistent');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all shadow-md ${
                    syncMode === 'watch-party'
                      ? 'bg-purple-500/30 text-purple-200 border border-purple-400/60 hover:bg-purple-500/40'
                      : 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 hover:bg-cyan-500/30'
                  }`}
                  title={syncMode === 'watch-party' ? 'Watch Party: Live WebRTC stream (Zero Quest RAM)' : 'Persistent: Independent chunk streaming & peer cache'}
                >
                  <span>{syncMode === 'watch-party' ? '📡 Watch Party Stream (Live)' : '💾 Persistent Chunk Stream'}</span>
                </button>
              ) : (
                <div
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-md cursor-default opacity-80 ${
                    syncMode === 'watch-party'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-400/40'
                      : 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                  }`}
                  title="Only the host or file owner can change the video sync mode"
                >
                  <span>{syncMode === 'watch-party' ? '📡 Watch Party Mode' : '💾 Persistent Mode'}</span>
                </div>
              )
            )}
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
            <span className="font-bold text-base">🗑</span>
          </button>
        )}
      </div>

      {/* Middle Row Overlay: Empty center clicks close UI; Right-side Vertical Volume Slider */}
      <div className="w-full flex-1 flex items-center justify-end px-8 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex flex-col items-center gap-3.5 py-6 px-4 rounded-3xl shadow-2xl cursor-default"
          style={{
            backgroundColor: 'rgba(24, 26, 32, 0.96)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(100, 116, 139, 0.8)',
            minWidth: '68px'
          }}
        >
          {/* Mute Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMuteToggle();
            }}
            title={state.muted ? 'Unmute audio' : 'Mute audio'}
            className="btn-dark-slate"
            style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="font-bold text-lg">{state.muted ? '🔇' : '🔊'}</span>
          </button>

          {/* Vertical Volume Slider Track (EXPLICIT INLINE STYLES FOR ZERO-TAILWIND FAILURE RISK) */}
          <div
            ref={volumeTrackRef}
            onPointerDown={beginVolumeScrub}
            onMouseDown={beginVolumeScrub as any}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.stopPropagation();
              const delta = e.deltaY < 0 ? 0.06 : -0.06;
              onVolumeChange(Math.max(0, Math.min(1, displayedVolume + delta)));
            }}
            style={{
              width: '28px',
              height: '210px',
              borderRadius: '9999px',
              backgroundColor: '#0a0d14',
              border: '2px solid rgba(148, 163, 184, 0.55)',
              position: 'relative',
              cursor: 'pointer',
              overflow: 'hidden',
              boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.8)'
            }}
            title={`Volume: ${Math.round(displayedVolume * 100)}% (Click or drag up/down)`}
          >
            {/* Filled Level Bar */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: `${displayedVolume * 100}%`,
                background: 'linear-gradient(0deg, #9333ea, #a855f7, #f59e0b)',
                borderRadius: '9999px',
                transition: 'height 75ms linear'
              }}
            />
            {/* Circular Glowing Thumb Handle */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                bottom: `calc(${Math.max(3, Math.min(97, displayedVolume * 100))}% - 10px)`,
                width: '20px',
                height: '20px',
                backgroundColor: '#ffffff',
                border: '3px solid #f59e0b',
                borderRadius: '50%',
                boxShadow: '0 0 10px rgba(245, 158, 11, 0.9)',
                pointerEvents: 'none',
                transition: 'bottom 75ms linear'
              }}
            />
          </div>

          {/* Volume Percentage Readout */}
          <span
            style={{
              fontSize: '13px',
              fontFamily: 'monospace',
              fontWeight: 800,
              color: '#fde047',
              textAlign: 'center'
            }}
          >
            {Math.round(displayedVolume * 100)}%
          </span>

          {/* Global / Local Mode Switcher Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVolumeModeToggle(state.volumeMode === 'global' ? 'local' : 'global');
            }}
            title={`Audio Mode: ${state.volumeMode === 'global' ? 'Global (broadcasts to room)' : 'Local (headset only)'}`}
            className="btn-dark-slate"
            style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="font-bold text-base">{state.volumeMode === 'global' ? '🌐' : '👤'}</span>
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
            onMouseDown={beginScrub as any}
            onClick={(e) => e.stopPropagation()}
            className="relative flex-1 h-3 bg-slate-800/80 rounded-full cursor-pointer overflow-hidden border border-slate-700/60"
          >
            <div
              ref={fillRef}
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-75"
              style={{ width: `${Math.min(100, Math.max(0, (state.currentTime / (state.duration || 1)) * 100))}%` }}
            />
          </div>

          <span className="text-base font-mono font-medium text-slate-400 min-w-[52px]">
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
              onPointerDown={(e) => e.stopPropagation()}
              disabled={state.duration <= 0}
              title={state.playing ? 'Pause' : 'Play'}
              className="btn-dark-slate-lg"
            >
              <span className="font-extrabold text-xl text-amber-300 pointer-events-none">
                {state.playing ? '⏸' : '▶'}
              </span>
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
              <span className="font-bold text-sm text-slate-200 pointer-events-none">⏪</span>
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
              <span className="font-bold text-sm text-slate-200 pointer-events-none">⏹</span>
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
              <span className="font-bold text-sm text-slate-200 pointer-events-none">⏩</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onSeek(0);
              }}
              title="Restart video"
              className="btn-dark-slate"
            >
              <span className="font-bold text-sm text-slate-200 pointer-events-none">🔁</span>
            </button>
          </div>

          {/* Right Controls: Audio Mode Indicator & Switcher */}
          <div className="flex items-center gap-3">
            {/* Global / Local Mode Switcher Pill Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVolumeModeToggle(state.volumeMode === 'global' ? 'local' : 'global');
              }}
              title={`Switch Audio Mode. Currently: ${state.volumeMode === 'global' ? 'Global (broadcasts to room)' : 'Local (headset only)'}`}
              className="px-4 py-2.5 rounded-xl bg-[#181a20] hover:bg-[#242833] border border-slate-700/80 hover:border-amber-500/60 text-slate-200 hover:text-white flex items-center gap-2.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
            >
              {state.volumeMode === 'global' ? (
                <span>🌐 Global Volume Mode</span>
              ) : (
                <span>👤 Local Volume Mode</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
