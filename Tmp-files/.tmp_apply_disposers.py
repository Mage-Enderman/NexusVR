#!/usr/bin/env python3
"""
Apply App.tsx engine-init subscription cleanup + isImporting guards.

Robust against mixed CRLF/LF line endings (the file uses CRLF overall
but read_text() converts to LF in memory via universal-newlines mode)
and against partial-application (skips anchors that don't match — for
example, the cleanup-loop anchor is unique and non-colliding, but
other anchors can drift if earlier edits change the file).

Each (old, new) pair uses LF-only anchors. Read with universal
newlines (LF) and write back as LF — most modern editors close the
file as CRLF again on save, but that's a no-op semantic-wise here.
"""
import sys
from pathlib import Path

SRC = Path("src/App.tsx")
text = SRC.read_text(encoding="utf-8")  # universal newlines: CRLF->LF in memory
print(f"[INFO] Read {SRC} ({len(text)} chars in memory).")

EDITS: list[tuple[str, str, str]] = []  # (label, old, new)

# ----------------------------------------------------------------------------
# Edit 1: Define disposers + wrap registerOnSelectionChange.
# ----------------------------------------------------------------------------
EDITS.append((
    "disposers decl + selection wrap",
    """    const net = networkServiceRef.current;

    // Connect selection events
    manipulationManager.registerOnSelectionChange((asset) => {
      setSelectedAsset(asset);
      if (asset && asset.type === 'misc') {
        setInspectedMiscAsset(asset);
      }
    });""",
    """    const net = networkServiceRef.current;

    // Subscription accumulator. Every `registerOn*` / `net.on*` call
    // returns a cleanup that removes the listener from the owning
    // engine's internal Set; collected here so useEffect cleanup can
    // drop them all at once.
    //
    // Without this, React.StrictMode's dev double-mount (main.tsx wraps
    // <App> in <StrictMode>) runs engine-init effect after the sync
    // first-mount -> cleanup cycle. Mount 1's listeners stay attached
    // to the stable NetworkService's callback Sets AND close over
    // mount 2's fresh AssetManager/ManipulationManager, but mount 2
    // re-registers them -- every callback fires 2x per event. The
    // user-facing symptom: client imports a 3D model, host drags it
    // up, client tab freezes and ends up with giant duplicate meshes.
    // Each duplicate-listener broadcastSpawn sends 2 envelopes per
    // import; each envelope's base64 fileData forces a synchronous
    // atob() on the JS thread, freezing the renderer; each receiver's
    // importFile then races past `assets.has(id)` (Map is empty
    // pre-resolve) and does its own worldRoot.add(...) -> overlapping
    // duplicate meshes. Only the LAST entry persisted in the Map
    // receives subsequent `applyRemoteTransform` updates so the FIRST
    // visually stays put during host drag.
    const disposers: Array<() => void> = [];

    // Connect selection events
    disposers.push(manipulationManager.registerOnSelectionChange((asset) => {
      setSelectedAsset(asset);
      if (asset && asset.type === 'misc') {
        setInspectedMiscAsset(asset);
      }
    }));"""
))

# ----------------------------------------------------------------------------
# Edit 2: Wrap registerOnGrabBegin.
# ----------------------------------------------------------------------------
EDITS.append((
    "grabBegin wrap",
    """    manipulationManager.registerOnGrabBegin((asset) => {
      if (asset && asset.type === 'misc') {
        setInspectedMiscAsset(asset);
      }
    });""",
    """    disposers.push(manipulationManager.registerOnGrabBegin((asset) => {
      if (asset && asset.type === 'misc') {
        setInspectedMiscAsset(asset);
      }
    }));"""
))

# ----------------------------------------------------------------------------
# Edit 3: Wrap registerOnTransformChange.
# ----------------------------------------------------------------------------
EDITS.append((
    "transformChange wrap",
    """    manipulationManager.registerOnTransformChange((update) => {
      net.broadcastTransform(update);
    });""",
    """    disposers.push(manipulationManager.registerOnTransformChange((update) => {
      net.broadcastTransform(update);
    }));"""
))

# ----------------------------------------------------------------------------
# Edit 4: Wrap registerOnDragChange.
# ----------------------------------------------------------------------------
EDITS.append((
    "dragChange wrap",
    """    manipulationManager.registerOnDragChange((dragging) => {
      // Capture the asset that's actually moving. For TC gizmo drags it
      // is `selectedAsset` (TC is attached to the gizmo of the selected
      // asset); for RMB-grabs it is `grabbedAsset`, since RMB-grab no
      // longer mutates selection state. If we read only `selectedAsset`,
      // RMB-grabs on non-selected assets would silently skip undo capture
      // because the "moved" comparison would be against the (unchanged)
      // selected asset's transform.
      const asset = manipulationManager.grabbedAsset ?? manipulationManager.selectedAsset;""",
    """    disposers.push(manipulationManager.registerOnDragChange((dragging) => {
      // Capture the asset that's actually moving. For TC gizmo drags it
      // is `selectedAsset` (TC is attached to the gizmo of the selected
      // asset); for RMB-grabs it is `grabbedAsset`, since RMB-grab no
      // longer mutates selection state. If we read only `selectedAsset`,
      // RMB-grabs on non-selected assets would silently skip undo capture
      // because the "moved" comparison would be against the (unchanged)
      // selected asset's transform.
      const asset = manipulationManager.grabbedAsset ?? manipulationManager.selectedAsset;"""
))

# ----------------------------------------------------------------------------
# Edit 5: Wrap registerOnAssetAdded.
# ----------------------------------------------------------------------------
EDITS.append((
    "assetAdded wrap",
    """    // Connect asset additions -> save locally or broadcast
    assetManager.registerOnAssetAdded((asset) => {""",
    """    // Connect asset additions -> save locally or broadcast
    disposers.push(assetManager.registerOnAssetAdded((asset) => {"""
))

# ----------------------------------------------------------------------------
# Edit 6: Wrap onPeerJoin.
# ----------------------------------------------------------------------------
EDITS.append((
    "peerJoin wrap",
    """    // Network listeners
    net.onPeerJoin(() => setPeerCount(net.peers.size));""",
    """    // Network listeners
    disposers.push(net.onPeerJoin(() => setPeerCount(net.peers.size)));"""
))

# ----------------------------------------------------------------------------
# Edit 7: Wrap onPeerLeave.
# ----------------------------------------------------------------------------
EDITS.append((
    "peerLeave wrap",
    """    net.onPeerLeave((peerId) => {
      setPeerCount(net.peers.size);
      avatarManager.removePeerAvatar(peerId);
    });""",
    """    disposers.push(net.onPeerLeave((peerId) => {
      setPeerCount(net.peers.size);
      avatarManager.removePeerAvatar(peerId);
    }));"""
))

# ----------------------------------------------------------------------------
# Edit 8: Wrap onHostChange.
# ----------------------------------------------------------------------------
EDITS.append((
    "hostChange wrap",
    """    net.onHostChange((_newHostId, selfHost) => {
      setIsHost(selfHost);
    });""",
    """    disposers.push(net.onHostChange((_newHostId, selfHost) => {
      setIsHost(selfHost);
    }));"""
))

# ----------------------------------------------------------------------------
# Edit 9: Wrap onTransform + onAvatar + onSpawn (with isImporting guard).
# ----------------------------------------------------------------------------
EDITS.append((
    "transform/avatar/spawn wrap + guard",
    """    net.onTransform((update) => {
      manipulationManager.applyRemoteTransform(update, assetManager.assets);
    });

    net.onAvatar((update) => {
      avatarManager.updatePeerAvatar(update);
    });

    net.onSpawn((data) => {
      // If asset is already loaded, skip
      if (assetManager.assets.has(data.id)) return;

      const pos = new THREE.Vector3(...data.position);""",
    """    disposers.push(net.onTransform((update) => {
      manipulationManager.applyRemoteTransform(update, assetManager.assets);
    }));

    disposers.push(net.onAvatar((update) => {
      avatarManager.updatePeerAvatar(update);
    }));

    disposers.push(net.onSpawn((data) => {
      // If asset is already loaded, skip
      if (assetManager.assets.has(data.id)) return;
      // Belt + braces: skip if a previous duplicate listener already
      // started an in-flight import for this id. AssetManager.importFile
      // has its own dedup short-circuit that returns the in-flight
      // Promise, but skipping here saves the async setup overhead
      // per duplicate reception.
      if (assetManager.isImporting(data.id)) return;

      const pos = new THREE.Vector3(...data.position);"""
))

# ----------------------------------------------------------------------------
# Edit 10: Wrap onRemove.
# ----------------------------------------------------------------------------
EDITS.append((
    "remove wrap",
    """    net.onRemove((id) => {
      assetManager.removeAsset(id);
      if (manipulationManager.selectedAsset?.id === id) {
        manipulationManager.selectAsset(null);
      }""",
    """    disposers.push(net.onRemove((id) => {
      assetManager.removeAsset(id);
      if (manipulationManager.selectedAsset?.id === id) {
        manipulationManager.selectAsset(null);
      }"""
))

# ----------------------------------------------------------------------------
# Edit 11: Wrap onPendingSpawn / onPendingCancel / onChat / onStream.
# ----------------------------------------------------------------------------
EDITS.append((
    "pending/chat/stream wrap",
    """    net.onPendingSpawn((data: PendingSpawnData) => {
      if (pendingAssetsRef.current.has(data.id)) return;
      const pos = new THREE.Vector3(...data.position);
      const { group, dispose } = createLoadingPlaceholder(
        data.name,
        data.requesterName,
        pos
      );
      sceneEngine.worldRoot.add(group);
      pendingAssetsRef.current.set(data.id, { group, dispose });
    });

    net.onPendingCancel((id: string) => {
      const entry = pendingAssetsRef.current.get(id);
      if (!entry) return;
      sceneEngine.worldRoot.remove(entry.group);
      entry.dispose();
      pendingAssetsRef.current.delete(id);
    });

    net.onChat((_msg) => {
      if (!showChatPanel) {
        setUnreadChatCount((prev) => prev + 1);
      }
    });

    net.onStream((stream, peerId) => {
      avatarManager.attachPeerAudio(peerId, stream);
    });""",
    """    disposers.push(net.onPendingSpawn((data: PendingSpawnData) => {
      if (pendingAssetsRef.current.has(data.id)) return;
      const pos = new THREE.Vector3(...data.position);
      const { group, dispose } = createLoadingPlaceholder(
        data.name,
        data.requesterName,
        pos
      );
      sceneEngine.worldRoot.add(group);
      pendingAssetsRef.current.set(data.id, { group, dispose });
    }));

    disposers.push(net.onPendingCancel((id: string) => {
      const entry = pendingAssetsRef.current.get(id);
      if (!entry) return;
      sceneEngine.worldRoot.remove(entry.group);
      entry.dispose();
      pendingAssetsRef.current.delete(id);
    }));

    disposers.push(net.onChat((_msg) => {
      if (!showChatPanel) {
        setUnreadChatCount((prev) => prev + 1);
      }
    }));

    disposers.push(net.onStream((stream, peerId) => {
      avatarManager.attachPeerAudio(peerId, stream);
    }));"""
))

# ----------------------------------------------------------------------------
# Edit 12: Wrap onRoleUpdate + onModerationAction + registerOnScaleSelf.
# ----------------------------------------------------------------------------
EDITS.append((
    "role/mod/scaleSelf wrap",
    """    net.onRoleUpdate((data) => {
      if (data.targetPeerId === net.localPeerId) {
        setLocalRole(data.newRole);
      }
    });

    net.onModerationAction((data) => {
      if (data.targetPeerId === net.localPeerId) {
        if (data.action === 'kick') {
          alert(`You have been temporarily kicked from the room: ${data.reason || 'No reason provided.'}`);
          net.disconnect();
          setMode('offline');
          setRoomId(null);
        } else if (data.action === 'ban') {
          alert(`You have been permanently banned from this session: ${data.reason || 'Banned by Admin.'}`);
          net.disconnect();
          setMode('offline');
          setRoomId(null);
        } else if (data.action === 'respawn') {
          sceneEngine.camera.position.set(0, 1.6, 3);
          sceneEngine.controls.target.set(0, 1, 0);
          sceneEngine.controls.update();
        }
      }
    });

    manipulationManager.registerOnScaleSelf((factor) => {
      sceneEngine.camera.position.y = Math.max(0.4, sceneEngine.camera.position.y * factor);
      sceneEngine.controls.target.y = Math.max(0.2, sceneEngine.controls.target.y * factor);
      sceneEngine.controls.update();
    });""",
    """    disposers.push(net.onRoleUpdate((data) => {
      if (data.targetPeerId === net.localPeerId) {
        setLocalRole(data.newRole);
      }
    }));

    disposers.push(net.onModerationAction((data) => {
      if (data.targetPeerId === net.localPeerId) {
        if (data.action === 'kick') {
          alert(`You have been temporarily kicked from the room: ${data.reason || 'No reason provided.'}`);
          net.disconnect();
          setMode('offline');
          setRoomId(null);
        } else if (data.action === 'ban') {
          alert(`You have been permanently banned from this session: ${data.reason || 'Banned by Admin.'}`);
          net.disconnect();
          setMode('offline');
          setRoomId(null);
        } else if (data.action === 'respawn') {
          sceneEngine.camera.position.set(0, 1.6, 3);
          sceneEngine.controls.target.set(0, 1, 0);
          sceneEngine.controls.update();
        }
      }
    }));

    disposers.push(manipulationManager.registerOnScaleSelf((factor) => {
      sceneEngine.camera.position.y = Math.max(0.4, sceneEngine.camera.position.y * factor);
      sceneEngine.controls.target.y = Math.max(0.2, sceneEngine.controls.target.y * factor);
      sceneEngine.controls.update();
    }));"""
))

# ----------------------------------------------------------------------------
# Edit 13: Wrap onSyncReq opening.
# ----------------------------------------------------------------------------
EDITS.append((
    "syncReq opening wrap",
    """    net.onSyncReq((fromPeerId) => {
      if (net.isHost) {""",
    """    disposers.push(net.onSyncReq((fromPeerId) => {
      if (net.isHost) {"""
))

# ----------------------------------------------------------------------------
# Edit 14: Wrap onSyncResp opening + add isImporting guard inside snapshot
# forEach (closes with `// Animation Loop sync`).
# ----------------------------------------------------------------------------
EDITS.append((
    "syncResp wrap + guard",
    """    net.onSyncResp((snapshot) => {
      snapshot.assets.forEach((data) => {""",
    """    disposers.push(net.onSyncResp((snapshot) => {
      snapshot.assets.forEach((data) => {
        // Belt + braces: skip late-join snapshot items whose import
        // is already in-flight from a separate listener (mirrors the
        // onSpawn guard above). Without this, two near-simultaneous
        // delivery paths (e.g. a 'spawn' envelope immediately
        // followed by a sync-resp snapshot containing the same id)
        // could each race past `assets.has(id)` and start their own
        // importFile Promise for the same id.
        if (assetManager.isImporting(data.id)) return;"""
))

# ----------------------------------------------------------------------------
# Edit 15: Add disposer-teardown loop in cleanup function (must run BEFORE
# net.disconnect()).
# ----------------------------------------------------------------------------
EDITS.append((
    "cleanup disposer loop",
    """      pendingCleanup.clear();
      net.disconnect();
      manipulationManager.dispose();
      sceneEngine.dispose();
    };""",
    """      pendingCleanup.clear();
      // Drop every captured subscription FIRST so StrictMode dev
      // double-mount (or any HMR cycle) doesn't leave duplicate
      // listeners attached to NetworkService / AssetManager /
      // ManipulationManager Sets. Per-disposer try/catch so a single
      // closure referencing a torn-down engine doesn't abort the rest.
      for (const d of disposers) {
        try { d(); } catch { /* noop */ }
      }
      net.disconnect();
      manipulationManager.dispose();
      sceneEngine.dispose();
    };"""
))

# ----------------------------------------------------------------------------
# Apply each edit. Skip if anchor missing (it may already be migrated by
# an earlier run); abort with a clear error if anchor matches >1.
# ----------------------------------------------------------------------------
applied = skipped = failed = 0
for label, old, new in EDITS:
    count = text.count(old)
    if count == 1:
        text = text.replace(old, new, 1)
        print(f"[OK]   {label}: applied.")
        applied += 1
    elif count == 0:
        print(f"[SKIP] {label}: anchor missing (may be already applied or whitespace diverges).")
        skipped += 1
    else:
        print(f"[ERR]  {label}: anchor matched {count} times (expected 0 or 1). Aborting.")
        sys.exit(1)

SRC.write_text(text, encoding="utf-8")
print(f"\n[DONE] Applied={applied}, skipped={skipped}, failed={failed}. Wrote {SRC} ({len(text)} chars).")
