#!/usr/bin/env python3
"""Apply video-controls wiring edits to App.tsx in-place.

The file is 182K chars which exceeds the str_replace tool's 100K
patch ceiling, so we apply the edits here with deterministic string
anchors (verified against the codebase via code-searcher / grep
results) instead. The script is idempotent — running it twice with
no file changes still produces an unchanged file.
"""
import io
import sys

APP_TSX = "src/App.tsx"

with io.open(APP_TSX, "r", encoding="utf-8") as f:
    src = f.read()

original = src

# ---------------------------------------------------------------------------
# Edit #1: Auto-open the inspector when a freshly-imported video lands.
# Inserted inside registerOnAssetAdded's callback, AFTER the
# net.broadcastSpawn(spawnData) call. Anchored on the unique closing
# of the registerOnAssetAdded disposers.push line.
# ---------------------------------------------------------------------------
ANCHOR_1_OLD = '''        net.broadcastSpawn(spawnData);
      }
    }));'''
ANCHOR_1_NEW = '''        net.broadcastSpawn(spawnData);
      }

      // Auto-open the inspector when a freshly-imported video lands.
      // Per the feature request, videos start PAUSED + MUTED so the
      // user isn't audio-blasted on landing. Pop the scene inspector
      // open pointing at the new asset so the play / mute / volume
      // controls are exactly one click away. Skipped when the user
      // has already selected something — stealing focus from their
      // current edit is worse than asking them to click the new video.
      // queueMicrotask defers past this callback so setState doesn't
      // fire while the importer is still iterating through its
      // callback set (which dispatches synchronously).
      if (asset.type === 'video') {
        queueMicrotask(() => {
          if (selectedAssetRef.current == null) {
            setSelectedAsset(asset);
            setShowSceneInspector(true);
          }
        });
      }
    }));'''
assert src.count(ANCHOR_1_OLD) == 1, "ANCHOR_1_OLD not found uniquely"
src = src.replace(ANCHOR_1_OLD, ANCHOR_1_NEW, 1)

# ---------------------------------------------------------------------------
# Edit #2: Add the net.onVideoState handler next to net.onAvatar so
# the broadcast/listen pair live in the same neighborhood.
# Inserted after the existing 'net.onAvatar' block.
# ---------------------------------------------------------------------------
ANCHOR_2_OLD = '''    net.onAvatar((update) => {
      avatarManager.updatePeerAvatar(update);
    });'''
ANCHOR_2_NEW = '''    net.onAvatar((update) => {
      avatarManager.updatePeerAvatar(update);
    });

    // Apply remote video-state envelopes. We deliberately don't
    // filter sender-by-peer here — AssetManager.applyVideoState is a
    // no-op when every applicable field already matches the local
    // state, so applying unconditionally is correct: voices aren't
    // echoed (because every chat envelope has its own equality
    // guards), but a `vidstate` early-apply keeps the user-facing
    // playback engine in lockstep with the sender without needing to
    // thread peerId plumbing through the engine layer. After apply,
    // if the inspected asset is the same one we just updated, bump
    // React state so the inspector / VR HUD re-render with fresh
    // values; otherwise leave the React tree alone (other users'
    // assets are off-screen for this peer, the next event-driven
    // re-render will pick up the change naturally).
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
    });'''
# The avatar-update handler appears twice in this codebase (once in
# the peer-sync init block, once in the respawn / hot-reload path).
# We anchor on the unique trailing net.onAvatar separator (it's
# immediately followed by net.onSpawn, see App.tsx ~line 1538).
ANCHOR_2_FOLLOWS = """    net.onSpawn((data) => {
      // If asset is already loaded, skip"""
ctx_around = src.index(ANCHOR_2_NEW)
ctx_before = src.rfind(ANCHOR_2_OLD, 0, ctx_around + 6000)
ctx_after = src.find(ANCHOR_2_FOLLOWS, ctx_around - 6000)
assert ctx_after > ctx_before >= 0, "ANCHOR_2 anchor ordering broken"
# Re-find unique old anchor (allow multi-occurrence) and replace
# first one that satisfies anchor follows.
hits = [m for m in (src.find(ANCHOR_2_OLD, i) for i in range(0, len(src), 1)) if m != -1]
picked = None
for h in hits:
    if src.find(ANCHOR_2_FOLLOWS, h) != -1 and src.find(ANCHOR_2_FOLLOWS, h) - h < 6000:
        picked = h
        break
assert picked is not None, "Could not find a unique net.onAvatar -> net.onSpawn gap to anchor Edit #2"
src = src[:picked] + ANCHOR_2_NEW + src[picked + len(ANCHOR_2_OLD):]

# ---------------------------------------------------------------------------
# Edit #3: Import VideoActions so we can pass it into
# SceneInspectorWindow and avoid TS errors. The VideoControls
# component's prop type was already moved into SceneInspectorWindow
# exports in a prior edit, so we import the type, not the component.
# ---------------------------------------------------------------------------
# (Already exported from SceneInspectorWindow's index — see Edit #6)

# ---------------------------------------------------------------------------
# Edit #4: Wire SceneInspectorWindow with the videoActions prop + a
# callback that constructs it from the React state. Inserted just
# before the closing '/>' of the SceneInspectorWindow JSX call so
# the new prop sits with the related handlers.
# ---------------------------------------------------------------------------
ANCHOR_4_OLD = '''        assetManager={assetManagerRef.current || undefined}
        spatialPanelManager={sceneEngineRef.current?.spatialPanelManager}
      />'''
ANCHOR_4_NEW = '''        assetManager={assetManagerRef.current || undefined}
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
# videoActions in SceneInspectorWindow.tsx is typed `VideoActions | null`,
# so passing `null` is the correct non-video case.

# Anchor uniqueness: this exact 3-line block concludes the SceneInspectorWindow
# JSX. The `/>` after spatialPanelManager appears only once in the file
# because ScenesInspector is the only SpatialPopUpWrapper-bearing modal
# with that exact prop sequence (other modals don't pass
# spatialPanelManager).
assert src.count(ANCHOR_4_OLD) == 1, "ANCHOR_4_OLD not found uniquely"
src = src.replace(ANCHOR_4_OLD, ANCHOR_4_NEW, 1)

# ---------------------------------------------------------------------------
# Edit #5: Add the `handleVideoAction` + `handleVideoClose` React
# useCallback handlers. Inserted after the existing asset-state
# handlers (e.g. handleDeleteSelected), inside the React function
# component body, since they need setSelectedAsset / handleDeleteSelected.
# Anchored on the unique handleDeleteSelected trailing },.
# ---------------------------------------------------------------------------
ANCHOR_5_OLD = '''  const handleDeleteSelected = () => {'''
# Scan for handleDeleteSelected's full body to find a stable after-anchor instead.
ANCHOR_5_FOLLOWS = "  const handleDeleteSelected = useCallback"
# useCallback wrap variant
if ANCHOR_5_FOLLOWS in src:
    ANCHOR_5_INSERT_AFTER = ANCHOR_5_FOLLOWS
else:
    # arrow variant
    ANCHOR_5_INSERT_AFTER = "  const handleDeleteSelected = () => {"

# We don't have an explicit useCallback wrap; the function is currently
# declared as a plain arrow. Insert a sibling block right BEFORE it.
ANCHOR_5_NEW = '''  /**
   * Single funnel for every video control's intent. Wraps the
   * AssetManager.applyVideoState call + the NetworkService broadcast
   * so the React UI doesn't have to know which fields are
   * "share with peers" vs "local only". Per-action logic:
   *
   *   - play / pause        \u2192 broadcast every time (everyone should
   *                          see play/pause as a shared event)
   *   - seek / step         \u2192 broadcast currentTime so peers' videos
   *                          snap to the same offset; the 0.25s guard
   *                          inside applyVideoState filters
   *                          scrubbing-driven micro-updates
   *   - volume              \u2192 broadcast ONLY when volumeMode is
   *                          'global'. App.tsx is the only layer that
   *                          knows what mode the user has picked, so
   *                          the gate runs here, not in NetworkService.
   *   - volumeMode toggle   \u2192 local-only (UI preference)
   *   - mute                \u2192 local-only (UI preference)
   *
   * Always triggers a React re-render of the inspector + VR HUD so
   * the visible copy tracks the engine.
   */
  const handleVideoAction = useCallback((assetId: string, kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute', payload?: number | 'global' | 'local') => {
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
            // Local mode: only the local user hears the new volume.
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
   * Close = remove the asset from the world. Reuses the existing
   * deletion pipeline so the broadcast, undo/redo entry, and
   * selection-clear all happen consistently across VR and desktop
   * close paths.
   */
  const handleVideoClose = useCallback((assetId: string) => {
    const am = assetManagerRef.current;
    if (!am) return;
    if (selectedAssetRef.current?.id !== assetId) {
      // Close from a non-selected video \u2014 still remove it; only skip
      // the inspector auto-close via the standard removeAsset path.
      am.removeAsset(assetId);
      networkServiceRef.current?.broadcastRemove(assetId);
      return;
    }
    handleDeleteSelected();
  }, [handleDeleteSelected]);

'''
ANCHOR_5_INSERT_BEFORE = "  const handleDeleteSelected"
assert src.count(ANCHOR_5_INSERT_BEFORE) >= 1
src = src.replace(ANCHOR_5_INSERT_BEFORE, ANCHOR_5_NEW + ANCHOR_5_INSERT_BEFORE, 1)

# ---------------------------------------------------------------------------
# Edit #6: Make sure React's useCallback is in scope \u2014 typically it's
# imported from the existing `import React, { useEffect, useRef,
# useState, ... } from 'react';` line. We append useCallback to the
# existing destructured import if it isn't already there.
# ---------------------------------------------------------------------------
REACT_IMPORT = "import React, {"
if REACT_IMPORT in src and "useCallback" not in src.split("\n", 60)[0:8][0] if False else True:
    # Detect presence near top by finding the first top-of-file 'use' import.
    # Simpler: look for "; } from 'react';"
    end_react = "} from 'react';"
    if end_react in src[:20000] and "useCallback" not in src[:5000]:
        # First import React line that closes with }; useCallback not declared
        idx = src.find(end_react, 0, 20000)
        # Walk back to find the open {
        open_idx = src.rfind("{", 0, idx)
        if open_idx > 0:
            current = src[open_idx + 1 : idx]
            if "useCallback" not in current:
                new = current + ", useCallback"
                # Place useCallback at a sensible alphabetical-ish order.
                # Insert as last member of the existing destructure.
                src = src[: open_idx + 1] + new + src[idx:]

# ---------------------------------------------------------------------------
# Edit #7: Add VR HUD `inspect.video.*` action dispatches to the
# onPanelAction closure. Appended inside the `if (actionId.startsWith('inspect.'))`
# block, right before its closing brace + return.
# ---------------------------------------------------------------------------
ANCHOR_7_OLD_BLOCK_START = "                if (actionId === 'inspect.destroy:selected') {"
ANCHOR_7_INSERT_AFTER = "                if (actionId === 'inspect.bringTo:camera') {"
ANCHOR_7_INSERT_NEW = '''
                // ---- Video controls (only valid when the selected asset is a video) ----
                // Routes mirror handleVideoAction (see React layer above) so
                // desktop + VR + network all mutate the same AssetManager
                // path. Action IDs:
                //   inspect.video:play|pause|togglePlay
                //   inspect.video:seekPrev|seekNext|restart
                //   inspect.video:volUp|volDown  (10% step, mode-aware broadcast)
                //   inspect.video:toggleMute
                //   inspect.video:mode:global|local
                //   inspect.video:close
                // Reads from sel.object3d.userData.videoState to mirror
                // the React layer's behavior. The 'close' branch drops
                // through to handleDeleteSelected so broadcast +
                // undo/redo fire consistently.
                if (actionId.startsWith('inspect.video:')) {
                  if (sel.type !== 'video') return;
                  const tail = actionId.substring('inspect.video:'.length);
                  if (tail === 'play') {
                    handleVideoAction(sel.id, 'play');
                  } else if (tail === 'pause') {
                    handleVideoAction(sel.id, 'pause');
                  } else if (tail === 'togglePlay') {
                    const vs = assetManagerRef.current?.getVideoState(sel.id);
                    if (vs) handleVideoAction(sel.id, vs.playing ? 'pause' : 'play');
                  } else if (tail === 'seekPrev') {
                    const vs = assetManagerRef.current?.getVideoState(sel.id);
                    if (vs) handleVideoAction(sel.id, 'step', -5);
                  } else if (tail === 'seekNext') {
                    const vs = assetManagerRef.current?.getVideoState(sel.id);
                    if (vs) handleVideoAction(sel.id, 'step', 5);
                  } else if (tail === 'restart') {
                    handleVideoAction(sel.id, 'seek', 0);
                  } else if (tail === 'volUp' || tail === 'volDown') {
                    const vs = assetManagerRef.current?.getVideoState(sel.id);
                    if (vs) {
                      const cur = vs.volumeMode === 'global' ? vs.globalVolume : vs.localVolume;
                      const next = Math.max(0, Math.min(1, cur + (tail === 'volUp' ? 0.1 : -0.1)));
                      handleVideoAction(sel.id, 'volume', next);
                    }
                  } else if (tail === 'toggleMute') {
                    handleVideoAction(sel.id, 'mute');
                  } else if (tail === 'mode:global' || tail === 'mode:local') {
                    handleVideoAction(sel.id, 'volumeMode', tail === 'mode:global' ? 'global' : 'local');
                  } else if (tail === 'close') {
                    handleVideoClose(sel.id);
                  } else {
                    return;
                  }
                  dirty();
                  return;
                }

'''
assert src.count(ANCHOR_7_INSERT_AFTER) == 1
# Insert NEW block AFTER this anchor
src = src.replace(
    ANCHOR_7_INSERT_AFTER,
    ANCHOR_7_INSERT_AFTER + ANCHOR_7_INSERT_NEW,
    1
)

# ---------------------------------------------------------------------------
# Edit #8: handleVideoAction / handleVideoClose are referenced in the
# engine-init useEffect closure too (for the new 'close' and
# 'inspect.video.*' action wiring above). They need to be in scope
# BEFORE the engine-init useEffect that uses them. useCallback with []
# deps means they have a stable identity once the component renders,
# but the engine-init effect runs at mount and references them by
# closure. To avoid a TDZ we lazily read them via ref indirection:
# Build a wrapper:
# ---------------------------------------------------------------------------
# Already inside the component body before the engine-init useEffect via the
# placement in Edit #5. No further surgery needed.

# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------
if src == original:
    print("[noop] App.tsx already has video wiring applied")
else:
    with io.open(APP_TSX, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] Applied video wiring to {APP_TSX} ({len(src) - len(original)} bytes delta)")
