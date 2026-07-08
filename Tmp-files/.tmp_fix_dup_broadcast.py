#!/usr/bin/env python3
"""Fix the duplicate play/pause broadcast in handleVideoAction.

The `kind === 'pause' || kind === 'play'` tail block re-broadcasts
the same payload that the per-case 'play'/'pause' arms already emitted.
Removing the duplicate. The throttle map is still maintained so the
NEXT scrub continues to be throttled rather than bursts-once.
"""
import io
PATH = "src/App.tsx"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
original = src

OLD = '''    // Always flush any pending seek broadcast on pause/play/close to
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

NEW = '''    // Reset the throttle on play/pause so the NEXT scrub starts fresh,
    // but DO NOT re-broadcast here -- the play/pause arm already
    // emitted a broadcast with the full payload. Sending a second
    // identical envelope just doubles wire traffic for no benefit.
    // (Original implementation also flushed, which was a duplicate.)
    if (kind === 'pause' || kind === 'play') {
      videoSeekThrottleRef.current.set(assetId, Date.now());
    }
    const sel = selectedAssetRef.current;
    if (sel && sel.id === assetId) setSelectedAsset({ ...sel });
    vrHudRef.current?.redrawPanel();
  }, []);'''

if OLD in src:
    src = src.replace(OLD, NEW, 1)
    print("[ok] Removed duplicate play/pause broadcast")
else:
    print("[skip] Already applied or anchor missing")

if src != original:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] App.tsx saved ({len(src) - len(original):+d} bytes)")
else:
    print("[noop] unchanged")
