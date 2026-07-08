#!/usr/bin/env python3
"""Re-add Edit D (handleVideoAction + handleVideoClose useCallbacks) to App.tsx.

The prior run skipped Edit D because its skip-guard tripped on a
later edit. Re-running with a fresh anchor.
"""
import io

PATH = "src/App.tsx"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
original = src

D_NEW = """  /**
   * Single funnel for video control intents; wraps the local apply
   * call and the network broadcast so the React UI doesn't need to
   * know which fields are shared vs local-only.
   *   - play / pause / seek / step  -> broadcast (everyone syncs)
   *   - volume                      -> broadcast ONLY in 'global' mode
   *   - volumeMode / mute           -> local-only UI preference
   */
  const handleVideoAction = useCallback((assetId: string, kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute', payload?: number) => {
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
  }, []);

  /**
   * Close = remove from world. Reuses the deletion pipeline so
   * broadcast + undo/redo + selection-clear fire consistently across
   * VR and desktop close paths.
   */
  const handleVideoClose = useCallback((assetId: string) => {
    if (selectedAssetRef.current?.id === assetId) {
      handleDeleteSelected();
      return;
    }
    const am = assetManagerRef.current;
    if (!am) return;
    am.removeAsset(assetId);
    networkServiceRef.current?.broadcastRemove(assetId);
  }, [handleDeleteSelected]);

  """
# Use unique anchor: the existing arrow declaration of handleDeleteSelected
ANCHOR = "  const handleDeleteSelected"
if ANCHOR in src and "const handleVideoAction = useCallback" not in src:
    src = src.replace(ANCHOR, D_NEW + ANCHOR, 1)
    print("[ok] Edit D-retry: handleVideoAction + handleVideoClose useCallbacks added")
elif "const handleVideoAction = useCallback" in src:
    print("[skip] already applied")
else:
    print("[err] anchor missing")

if src != original:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] saved ({len(src) - len(original):+d} bytes)")
else:
    print("[noop] no changes")
