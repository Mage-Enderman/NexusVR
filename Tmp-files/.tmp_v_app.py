#!/usr/bin/env python3
"""Apply video wiring edits to App.tsx via simple unique anchors.

Idempotent: reruns are no-ops if edits already applied.
"""
import io, sys

PATH = "src/App.tsx"

with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
original = src

# ============ EDIT A: Auto-open inspector on video import ============
A_OLD = '''        net.broadcastSpawn(spawnData);
      }
    }));'''
A_NEW = '''        net.broadcastSpawn(spawnData);
      }

      // Auto-open the inspector when a freshly-imported video lands.
      // Per the feature request, videos start PAUSED + MUTED so the
      // user isn't audio-blasted on landing. Pop the scene inspector
      // open pointing at the new asset so the play/mute/volume
      // controls are exactly one click away. Skipped when something
      // is already selected so we don't steal focus. queueMicrotask
      // defers past this callback so setState doesn't fire inside
      // the importer's synchronous callback dispatch.
      if (asset.type === 'video') {
        queueMicrotask(() => {
          if (selectedAssetRef.current == null) {
            setSelectedAsset(asset);
            setShowSceneInspector(true);
          }
        });
      }
    }));'''
if A_OLD in src and A_NEW not in src:
    assert src.count(A_OLD) == 1, "Edit A anchor not unique"
    src = src.replace(A_OLD, A_NEW, 1)
    print("[ok] Edit A: auto-open on video import")
else:
    print("[skip] Edit A already applied or anchor missing")

# ============ EDIT B: Add net.onVideoState handler ============
# This block appears next to other 'net.on...' listeners.
# Anchor on the unique net.onAvatar(...) -> (blank line) -> dispose sentinel.
B_OLD = '''    net.onAvatar((update) => {
      avatarManager.updatePeerAvatar(update);
    });

    net.onSpawn((data) => {
      // If asset is already loaded, skip'''
B_NEW = '''    net.onAvatar((update) => {
      avatarManager.updatePeerAvatar(update);
    });

    // Apply remote video-state envelopes. AssetManager.applyVideoState
    // is a no-op when every applicable field already matches local
    // state, so we apply unconditionally rather than threading peerId
    // plumbing through. After apply, bump selectedAsset if it matches
    // and force-redraw the VR HUD panel so visible values sync without
    // waiting for the next setDataContext round-trip.
    net.onVideoState((data) => {
      const am = assetManagerRef.current;
      if (!am) return;
      am.applyVideoState(data.assetId, {
        playing: data.playing,
        currentTime: data.currentTime,
        globalVolume: data.globalVolume
      });
      const sel = selectedAssetRef.current;
      if (sel && sel.id === data.assetId) {
        setSelectedAsset({ ...sel });
      }
      vrHudRef.current?.redrawPanel();
    });

    net.onSpawn((data) => {
      // If asset is already loaded, skip'''
if B_OLD in src and B_NEW not in src:
    src = src.replace(B_OLD, B_NEW, 1)
    print("[ok] Edit B: net.onVideoState handler")
else:
    print("[skip] Edit B already applied or anchor missing")

# ============ EDIT C: Pass videoActions into SceneInspectorWindow ============
C_OLD = '''        assetManager={assetManagerRef.current || undefined}
        spatialPanelManager={sceneEngineRef.current?.spatialPanelManager}
      />'''
C_NEW = '''        assetManager={assetManagerRef.current || undefined}
        spatialPanelManager={sceneEngineRef.current?.spatialPanelManager}
        videoActions={(selectedAsset && selectedAsset.type === 'video') ? {
          onPlay: () => handleVideoAction(selectedAsset.id, 'play'),
          onPause: () => handleVideoAction(selectedAsset.id, 'pause'),
          onSeek: (t) => handleVideoAction(selectedAsset.id, 'seek', t),
          onStep: (d) => handleVideoAction(selectedAsset.id, 'step', d),
          onVolumeChange: (v) => handleVideoAction(selectedAsset.id, 'volume', v),
          onVolumeModeToggle: (m) => handleVideoAction(selectedAsset.id, 'volumeMode', m),
          onMuteToggle: () => handleVideoAction(selectedAsset.id, 'mute'),
          onClose: () => handleVideoClose(selectedAsset.id)
        } : null}
      />'''
if C_OLD in src and C_NEW not in src:
    assert src.count(C_OLD) == 1, "Edit C anchor not unique"
    src = src.replace(C_OLD, C_NEW, 1)
    print("[ok] Edit C: videoActions prop wiring")
else:
    print("[skip] Edit C already applied or anchor missing")

# ============ EDIT D: handleVideoAction + handleVideoClose useCallbacks ============
# Inserted RIGHT BEFORE const handleDeleteSelected's declaration line.
D_INSERT_BEFORE = "  const handleDeleteSelected"
D_NEW = """  /**
   * Single funnel for video control intents; wraps the local apply
   * call and the network broadcast so the React UI doesn't need to
   * know which fields are shared vs local-only.
   *   - play / pause / seek / step  -> broadcast (everyone syncs)
   *   - volume                      -> broadcast ONLY in 'global' mode
   *   - volumeMode / mute           -> local-only UI preference
   * React re-render is always triggered so the inspector + VR HUD
   * read fresh values from the engine.
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
if D_INSERT_BEFORE in src and "handleVideoAction" not in src:
    src = src.replace(D_INSERT_BEFORE, D_NEW + D_INSERT_BEFORE, 1)
    print("[ok] Edit D: handleVideoAction + handleVideoClose useCallbacks")
else:
    print("[skip] Edit D already applied or anchor missing")

# ============ EDIT E: useCallback in React imports ============
# Ensure useCallback is destructured. The first React import line is at top of file.
end_react = "} from 'react';"
idx = src.find(end_react, 0, 20000)
if idx > 0:
    open_idx = src.rfind("{", 0, idx)
    if open_idx > 0:
        current = src[open_idx + 1 : idx]
        if "useCallback" not in current:
            new_imports = current + ", useCallback"
            src = src[: open_idx + 1] + new_imports + src[idx:]
            print("[ok] Edit E: useCallback added to React import")

# ============ EDIT F: inspect.video.* dispatchers in onPanelAction ============
# Insert BEFORE the 'inspect.bringTo:camera' branch ends (inside the
# inspect.* block). We anchor on the unique inspect.bringTo:camera open.
F_ANCHOR_OLD = "                if (actionId === 'inspect.bringTo:camera') {\n                  // Move the asset to the camera's world position."
F_NEW_PREFIX = "                if (actionId === 'inspect.bringTo:camera') {\n                  // Move the asset to the camera's world position."
F_INSERT_BLOCK = '''
                // ---- Video controls (only valid when sel.type === 'video') ----
                // Mirror of handleVideoAction + handleVideoClose above so
                // desktop + VR + network all mutate through the same path.
                if (actionId.startsWith('inspect.video:')) {
                  if (sel.type !== 'video') return;
                  const tail = actionId.substring('inspect.video:'.length);
                  if (tail === 'play') handleVideoAction(sel.id, 'play');
                  else if (tail === 'pause') handleVideoAction(sel.id, 'pause');
                  else if (tail === 'togglePlay') {
                    const vs = assetManagerRef.current?.getVideoState(sel.id);
                    if (vs) handleVideoAction(sel.id, vs.playing ? 'pause' : 'play');
                  }
                  else if (tail === 'seekPrev' || tail === 'seekNext') {
                    handleVideoAction(sel.id, 'step', tail === 'seekPrev' ? -5 : 5);
                  }
                  else if (tail === 'restart') handleVideoAction(sel.id, 'seek', 0);
                  else if (tail === 'volUp' || tail === 'volDown') {
                    const vs = assetManagerRef.current?.getVideoState(sel.id);
                    if (vs) {
                      const cur = vs.volumeMode === 'global' ? vs.globalVolume : vs.localVolume;
                      handleVideoAction(sel.id, 'volume', Math.max(0, Math.min(1, cur + (tail === 'volUp' ? 0.1 : -0.1))));
                    }
                  }
                  else if (tail === 'toggleMute') handleVideoAction(sel.id, 'mute');
                  else if (tail === 'mode:global' || tail === 'mode:local') {
                    handleVideoAction(sel.id, 'volumeMode', tail === 'mode:global' ? 'global' : 'local');
                  }
                  else if (tail === 'close') handleVideoClose(sel.id);
                  else return;
                  dirty();
                  return;
                }

'''
if F_ANCHOR_OLD in src and F_INSERT_BLOCK.strip() not in src:
    src = src.replace(F_ANCHOR_OLD, F_INSERT_BLOCK + F_NEW_PREFIX, 1)
    print("[ok] Edit F: inspect.video.* dispatchers")
else:
    print("[skip] Edit F already applied or anchor missing")

# ============ SAVE ============
if src == original:
    print("[noop] no changes applied")
else:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] saved ({len(src) - len(original):+d} bytes)")
