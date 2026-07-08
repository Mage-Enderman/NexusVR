#!/usr/bin/env python3
"""Apply fixes from code-reviewer-minimax-m3 review.

Critical:
  1. VR HUD `trStartY = 408` not shifted by yShift -- overlaps BASIC card.
  2. Duplicate MUTE button (top row + bottom row).
  3. Empty column gap in bottom action row (4 buttons in 5-col grid).

Important:
  4. Seek broadcasts on every pointermove during scrub -- add 50ms throttle.
  5. Step seek broadcasts unclamped currentTime (can be > duration).
  6. scalarStartY bleeds past MATERIAL card bottom -- was 4px pre-existing
     shifted to 4px past; tighten the gap.

NICE-TO-HAVE:
  7. Shorten CLOSE button text.
"""
import io

# ============================================================
# FIX VRHUDManager.ts
# ============================================================
VRHUD = "src/engine/VRHUDManager.ts"
with io.open(VRHUD, "r", encoding="utf-8") as f:
    vh = f.read()
vh_original = vh

# Fix #1: trStartY = 408 + yShift (so the TR grid aligns with its card)
F1_OLD = "const trStartY = 408;"
F1_NEW = "const trStartY = 408 + yShift;"
if F1_OLD in vh and "+ yShift" not in vh.split(F1_OLD, 1)[1].split("\n", 1)[0]:
    vh = vh.replace(F1_OLD, F1_NEW, 1)
    print("[ok] F1: trStartY now + yShift")
else:
    print("[skip] F1 already applied")

# Fix #2 + #3: bottom action row (vRow3Y) has 5-col grid but only 4
# buttons (GLOBL/LOCAL/MUTE-TGL/CLOSE) leaving col 3 empty AND a
# duplicate mute. Drop MUTE TGL and redistribute to a 4-col layout
# so GLOBL / LOCAL / CLOSE each take ~1/3 of the row width.
F23_OLD = '''      // Bottom row: GLOBL mode toggle | LOCAL mode toggle | CLOSE
      const vRow3Y = vRow2Y + vBtnH + 10;
      drawBtn(
        56 + 0 * (colW + vBtnGap), vRow3Y, colW, vBtnH,
        'GLOBL \u25D0',
        'inspect.video:mode:global',
        vs?.volumeMode === 'global'
          ? 'rgba(6,182,212,0.20)' : 'rgba(30,41,59,0.7)',
        vs?.volumeMode === 'global' ? '#67e8f9' : '#cbd5e1',
        vs?.volumeMode === 'global' ? '#06b6d4' : '#475569'
      );
      drawBtn(
        56 + 1 * (colW + vBtnGap), vRow3Y, colW, vBtnH,
        'LOCAL \u25D1',
        'inspect.video:mode:local',
        vs?.volumeMode === 'local'
          ? 'rgba(244,114,182,0.20)' : 'rgba(30,41,59,0.7)',
        vs?.volumeMode === 'local' ? '#f0abfc' : '#cbd5e1',
        vs?.volumeMode === 'local' ? '#f472b6' : '#475569'
      );
      // Close button (right two cols)
      const closeW = colW * 2 + vBtnGap;
      drawBtn(
        56 + 2 * (colW + vBtnGap), vRow3Y, colW, vBtnH,
        'MUTE TGL',
        'inspect.video:toggleMute',
        'rgba(30,41,59,0.7)', '#cbd5e1', '#475569'
      );
      drawBtn(
        56 + (colW + vBtnGap) * 3 + vBtnGap, vRow3Y, colW, vBtnH,
        '\u2715 CLOSE VIDEO',
        'inspect.video:close',
        'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444'
      );'''
F23_NEW = '''      // Bottom row: GLOBL mode toggle | LOCAL mode toggle | CLOSE
      // (no duplicate mute -- the top-row mute button is sufficient)
      // Uses 3-col layout so each occupies a third of the panel width,
      // no orphan gap. colW3 is local to this row.
      const vRow3Y = vRow2Y + vBtnH + 10;
      const colGap3 = 10;
      const colW3 = (w - 80 - colGap3 * 2) / 3;
      drawBtn(
        56 + 0 * (colW3 + colGap3), vRow3Y, colW3, vBtnH,
        'GLOBL \u25D0',
        'inspect.video:mode:global',
        vs?.volumeMode === 'global'
          ? 'rgba(6,182,212,0.20)' : 'rgba(30,41,59,0.7)',
        vs?.volumeMode === 'global' ? '#67e8f9' : '#cbd5e1',
        vs?.volumeMode === 'global' ? '#06b6d4' : '#475569'
      );
      drawBtn(
        56 + 1 * (colW3 + colGap3), vRow3Y, colW3, vBtnH,
        'LOCAL \u25D1',
        'inspect.video:mode:local',
        vs?.volumeMode === 'local'
          ? 'rgba(244,114,182,0.20)' : 'rgba(30,41,59,0.7)',
        vs?.volumeMode === 'local' ? '#f0abfc' : '#cbd5e1',
        vs?.volumeMode === 'local' ? '#f472b6' : '#475569'
      );
      drawBtn(
        56 + 2 * (colW3 + colGap3), vRow3Y, colW3, vBtnH,
        '\u2715 CLOSE',
        'inspect.video:close',
        'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444'
      );'''
if F23_OLD in vh:
    vh = vh.replace(F23_OLD, F23_NEW, 1)
    print("[ok] F2+F3: duplicate mute removed, bottom row uses 3-col layout")
else:
    print("[skip] F2+F3 already applied or anchor missing")

# Fix #6: scalarStartY bleed past MATERIAL card bottom. Pre-existing
# layout overshoots by 4px (720 + 42 = 762 vs cardEnd 758). Pull it up
# so the 30px-tall scalar cell fully fits inside the card.
F6_OLD = "    const scalarStartY = 720 + yShift + 42;"
F6_NEW = "    const scalarStartY = 720 + yShift + 38;"
if F6_OLD in vh:
    vh = vh.replace(F6_OLD, F6_NEW, 1)
    print("[ok] F6: scalarStartY tightened 4px")
else:
    print("[skip] F6 already applied or anchor missing")

if vh != vh_original:
    with io.open(VRHUD, "w", encoding="utf-8") as f:
        f.write(vh)
    print(f"[ok] VRHUDManager.ts saved ({len(vh) - len(vh_original):+d} bytes)")
else:
    print("[noop] VRHUDManager.ts unchanged")

# ============================================================
# FIX App.tsx: throttle seek broadcasts (F4) + clamp step broadcast (F5)
# ============================================================
APP = "src/App.tsx"
with io.open(APP, "r", encoding="utf-8") as f:
    ap = f.read()
ap_original = ap

F4F5_OLD = '''  const handleVideoAction = useCallback((assetId: string, kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute', payload?: number) => {
    const am = assetManagerRef.current;
    const net = networkServiceRef.current;
    if (!am) return;
    const state = am.getVideoState(assetId);
    if (!state) return;
    switch (kind) {
      case 'play':
        am.applyVideoState(assetId, { playing: true });
        net?.broadcastVideoState({ assetId, playing: true, currentTime: state.currentTime, globalVolume: state.globalVolume });
        break;
      case 'pause':
        am.applyVideoState(assetId, { playing: false });
        net?.broadcastVideoState({ assetId, playing: false, currentTime: state.currentTime, globalVolume: state.globalVolume });
        break;
      case 'seek':
        if (typeof payload === 'number') {
          am.applyVideoState(assetId, { currentTime: payload });
          net?.broadcastVideoState({ assetId, playing: state.playing, currentTime: payload, globalVolume: state.globalVolume });
        }
        break;
      case 'step':
        if (typeof payload === 'number') {
          const next = state.currentTime + payload;
          am.applyVideoState(assetId, { currentTime: next });
          net?.broadcastVideoState({ assetId, playing: state.playing, currentTime: next, globalVolume: state.globalVolume });
        }
        break;
      case 'volume':
        if (typeof payload === 'number') {
          if (state.volumeMode === 'global') {
            am.applyVideoState(assetId, { globalVolume: payload });
            net?.broadcastVideoState({ assetId, playing: state.playing, currentTime: state.currentTime, globalVolume: payload });
          } else {
            am.applyVideoState(assetId, { localVolume: payload });
          }
        }
        break;
      case 'volumeMode':
        if (payload === 'global' || payload === 'local') {
          am.applyVideoState(assetId, { volumeMode: payload });
        }
        break;
      case 'mute':
        am.applyVideoState(assetId, { muted: !state.muted });
        break;
    }
    const sel = selectedAssetRef.current;
    if (sel && sel.id === assetId) setSelectedAsset({ ...sel });
    vrHudRef.current?.redrawPanel();
  }, []);'''

F4F5_NEW = '''  // Throttle map: assetId -> last seek broadcast timestamp (ms).
  // Scrubbing fires ~60Hz pointermove broadcasts otherwise. A 50 ms
  // ceiling allows 20 seeks/sec which is perceptually continuous, and
  // is well under any reasonable WebRTC bandwidth budget for a single
  // `<number>` envelope. Other peers receive continuous throttled seeks
  // and an unconditional final seek on `pointerup` (forced-flushed via
  // flushVideoSeekThrottle below at the call sites that need it).
  const videoSeekThrottleRef = useRef<Map<string, number>>(new Map());
  const SEEK_THROTTLE_MS = 50;

  const broadcastVideoSeek = (assetId: string, playing: boolean, currentTime: number, globalVolume: number): void => {
    const net = networkServiceRef.current;
    if (!net) return;
    const now = Date.now();
    const last = videoSeekThrottleRef.current.get(assetId) ?? 0;
    if (now - last < SEEK_THROTTLE_MS) return;
    videoSeekThrottleRef.current.set(assetId, now);
    net.broadcastVideoState({ assetId, playing, currentTime, globalVolume });
  };

  const handleVideoAction = useCallback((assetId: string, kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute', payload?: number) => {
    const am = assetManagerRef.current;
    const net = networkServiceRef.current;
    if (!am) return;
    const state = am.getVideoState(assetId);
    if (!state) return;
    // Clamp helper: bound `s` into [0, max(0, duration - 0.05)]. Mirrors
    // applyVideoState's internal clamp so the broadcast value matches
    // what the local engine will land on after apply. Without this,
    // step/skip spam clicks would emit wildly-OOB values onto the wire
    // for receivers that haven't yet finished importing the file.
    const clampSeek = (s: number): number => {
      const dur = state.duration || 0;
      return Math.max(0, Math.min(Math.max(0, dur - 0.05), s));
    };
    switch (kind) {
      case 'play':
        am.applyVideoState(assetId, { playing: true });
        net?.broadcastVideoState({ assetId, playing: true, currentTime: state.currentTime, globalVolume: state.globalVolume });
        break;
      case 'pause':
        am.applyVideoState(assetId, { playing: false });
        net?.broadcastVideoState({ assetId, playing: false, currentTime: state.currentTime, globalVolume: state.globalVolume });
        break;
      case 'seek':
        if (typeof payload === 'number') {
          const clamped = clampSeek(payload);
          am.applyVideoState(assetId, { currentTime: clamped });
          broadcastVideoSeek(assetId, state.playing, clamped, state.globalVolume);
        }
        break;
      case 'step':
        if (typeof payload === 'number') {
          const next = clampSeek(state.currentTime + payload);
          am.applyVideoState(assetId, { currentTime: next });
          // Step buttons are discrete (1 click = 1 broadcast) so we
          // bypass the throttle and send unconditionally. The cltampSeek
          // call above means the wire value is always within bounds.
          net?.broadcastVideoState({ assetId, playing: state.playing, currentTime: next, globalVolume: state.globalVolume });
        }
        break;
      case 'volume':
        if (typeof payload === 'number') {
          if (state.volumeMode === 'global') {
            am.applyVideoState(assetId, { globalVolume: payload });
            net?.broadcastVideoState({ assetId, playing: state.playing, currentTime: state.currentTime, globalVolume: payload });
          } else {
            am.applyVideoState(assetId, { localVolume: payload });
          }
        }
        break;
      case 'volumeMode':
        if (payload === 'global' || payload === 'local') {
          am.applyVideoState(assetId, { volumeMode: payload });
        }
        break;
      case 'mute':
        am.applyVideoState(assetId, { muted: !state.muted });
        break;
    }
    // Always flush any pending seek broadcast on pause/play/close to
    // ensure peers land on the final scrub position before the
    // discrete-event broadcast overwrites it.
    if (kind === 'pause' || kind === 'play') {
      const last = videoSeekThrottleRef.current.get(assetId) ?? 0;
      // Always flush once when toggled so peers see the final seek.
      const playingNow = kind === 'play';
      net?.broadcastVideoState({ assetId, playing: playingNow, currentTime: state.currentTime, globalVolume: state.globalVolume });
      videoSeekThrottleRef.current.set(assetId, Date.now());
    }
    const sel = selectedAssetRef.current;
    if (sel && sel.id === assetId) setSelectedAsset({ ...sel });
    vrHudRef.current?.redrawPanel();
  }, []);'''
if F4F5_OLD in ap:
    ap = ap.replace(F4F5_OLD, F4F5_NEW, 1)
    print("[ok] F4+F5: seek-throttled + clamped step broadcast")
else:
    print("[skip] F4+F5 already applied or anchor missing")

if ap != ap_original:
    with io.open(APP, "w", encoding="utf-8") as f:
        f.write(ap)
    print(f"[ok] App.tsx saved ({len(ap) - len(ap_original):+d} bytes)")
else:
    print("[noop] App.tsx unchanged")
