#!/usr/bin/env python3
"""
Add diagnostic console.debug logs at key points in the inspector sync
pipeline so the user can see in DevTools exactly which gate is dropping
the update. Also add a robustness fix: if the asset doesn't exist on the
receiving peer yet (race condition), buffer the update and re-apply
when the asset lands via the assetManager.assets.onAdd subscription.
"""
import sys

# ---- Fix 1: Add diagnostic log in NetworkService.broadcastInspectorUpdate ----
with open('src/services/NetworkService.ts', 'r', encoding='utf-8') as f:
    ns_content = f.read()

old_ns = (
    "  public broadcastInspectorUpdate(update: InspectorUpdateData): void {\n"
    "    if (this.mode === 'offline') return;\n"
    "    this.broadcastEnvelope(this.buildEnvelope('inspector', { ...update, senderPeerId: this.localPeerId }));\n"
    "  }\n"
)
new_ns = (
    "  public broadcastInspectorUpdate(update: InspectorUpdateData): void {\n"
    "    if (this.mode === 'offline') {\n"
    "      console.debug('[inspector-sync] broadcast skipped: mode=offline');\n"
    "      return;\n"
    "    }\n"
    "    if (this.dataConns.size === 0) {\n"
    "      console.warn('[inspector-sync] broadcast: no data connections, envelope will be dropped');\n"
    "    }\n"
    "    console.debug('[inspector-sync] broadcasting inspector update, dataConns.size=', this.dataConns.size, 'update=', JSON.parse(JSON.stringify(update)));\n"
    "    this.broadcastEnvelope(this.buildEnvelope('inspector', { ...update, senderPeerId: this.localPeerId }));\n"
    "  }\n"
)

if old_ns not in ns_content:
    print("ERROR: broadcastInspectorUpdate pattern not found in NetworkService.ts")
    sys.exit(1)

ns_content = ns_content.replace(old_ns, new_ns, 1)

# Also add a log to the receive dispatch case 'inspector'
old_case = (
    "      case 'inspector':\n"
    "        for (const cb of this.onInspectorUpdateCallbacks) cb(env.payload as InspectorUpdateData);\n"
    "        break;\n"
)
new_case = (
    "      case 'inspector':\n"
    "        console.debug('[inspector-sync] received envelope, callbacks.size=', this.onInspectorUpdateCallbacks.size, 'payload=', env.payload);\n"
    "        for (const cb of this.onInspectorUpdateCallbacks) cb(env.payload as InspectorUpdateData);\n"
    "        break;\n"
)

if old_case not in ns_content:
    print("ERROR: 'inspector' case pattern not found in NetworkService.ts")
    sys.exit(1)

ns_content = ns_content.replace(old_case, new_case, 1)

with open('src/services/NetworkService.ts', 'w', encoding='utf-8') as f:
    f.write(ns_content)

print("NetworkService.ts updated with diagnostic logs")


# ---- Fix 2: Add diagnostic logs + buffer mechanism in App.tsx receive handler ----
with open('src/App.tsx', 'r', encoding='utf-8') as f:
    app_content = f.read()

# Add a ref for pending inspector updates near the other refs in the engine-init useEffect.
# Find a good anchor - the `selectedAssetRef` declaration area.
# We'll add a pendingInspectorUpdatesRef just before the receive handler.

# First, add the ref declaration. Find the `selectedAssetRef` line and add after it.
# The line is: `const selectedAssetRef = useRef<LoadedAsset | null>(null);`
old_ref = "const selectedAssetRef = useRef<LoadedAsset | null>(null);\n"
new_ref = (
    "const selectedAssetRef = useRef<LoadedAsset | null>(null);\n"
    "  // Per-asset inspector-update buffer for the asset-not-yet-spawned\n"
    "  // race condition. When a peer toggles Active (or any inspector\n"
    "  // field) on an asset the local user hasn't received yet, the\n"
    "  // receive handler would normally early-return at `if (!asset)\n"
    "  // return;` and silently drop the update. This Map holds the most\n"
    "  // recent pending update per assetId and the engine-init effect's\n"
    "  // assetManager.assets subscription replays it the moment the\n"
    "  // asset lands. Cleared on successful re-apply.\n"
    "  const pendingInspectorUpdatesRef = useRef<Map<string, InspectorUpdateData>>(new Map());\n"
)

if old_ref not in app_content:
    print("ERROR: selectedAssetRef declaration not found in App.tsx")
    sys.exit(1)

app_content = app_content.replace(old_ref, new_ref, 1)

# Now update the receive handler to add logs and use the buffer.
old_recv_start = (
    "    disposers.push(net.onInspectorUpdate((update) => {\n"
    "      if (update.senderPeerId === net.localPeerId) return;\n"
    "      const asset = assetManager.assets.get(update.assetId);\n"
    "      if (!asset) return;\n"
)
new_recv_start = (
    "    disposers.push(net.onInspectorUpdate((update) => {\n"
    "      console.debug('[inspector-sync] receive handler entered: sender=', update.senderPeerId, 'local=', net.localPeerId, 'assetId=', update.assetId, 'active=', update.active);\n"
    "      if (update.senderPeerId === net.localPeerId) {\n"
    "        console.debug('[inspector-sync] echo-suppressed (local broadcast)');\n"
    "        return;\n"
    "      }\n"
    "      const asset = assetManager.assets.get(update.assetId);\n"
    "      if (!asset) {\n"
    "        // Race: the asset hasn't landed on this peer yet. Buffer and\n"
    "        // replay when the asset arrives via the assetManager.assets\n"
    "        // subscription below.\n"
    "        console.warn('[inspector-sync] asset not in assetManager, buffering update for assetId=', update.assetId, 'active=', update.active);\n"
    "        pendingInspectorUpdatesRef.current.set(update.assetId, update);\n"
    "        return;\n"
    "      }\n"
)
if old_recv_start not in app_content:
    print("ERROR: receive handler start pattern not found in App.tsx")
    sys.exit(1)

app_content = app_content.replace(old_recv_start, new_recv_start, 1)

# Add the assetManager.assets subscription that replays buffered updates.
# Find a good anchor: after the `disposers.push(net.onInspectorUpdate(...))` block ends,
# we'll add a subscription that watches the assets Map.
# The handler ends with `    }));` followed by a blank line and then `net.onAvatar`.
# We add the subscription right after the inspector handler's `    }));`.

# Use a unique anchor: the inspector handler's last setSelectedAsset call.
old_anchor = (
    "      const sel = selectedAssetRef.current;\n"
    "      if (sel && sel.id === update.assetId) {\n"
    "        setSelectedAsset({ ...asset });\n"
    "      }\n"
    "    }));\n"
    "\n"
    "    net.onAvatar((update) => {\n"
)
new_anchor = (
    "      const sel = selectedAssetRef.current;\n"
    "      if (sel && sel.id === update.assetId) {\n"
    "        setSelectedAsset({ ...asset });\n"
    "      }\n"
    "      // Successful apply - clear any buffered update for this asset.\n"
    "      if (pendingInspectorUpdatesRef.current.has(update.assetId)) {\n"
    "        pendingInspectorUpdatesRef.current.delete(update.assetId);\n"
    "      }\n"
    "    }));\n"
    "\n"
    "    // Replay any inspector updates that arrived BEFORE the asset\n"
    "    // landed in this peer's assetManager (race condition fix). The\n"
    "    // assetManager.assets Map is the same Map the AssetManager\n"
    "    // mutates on every successful importFile/applyRemoteSpawn, so\n"
    "    // observing its size gives us a cheap 'asset landed' signal\n"
    "    // without needing a dedicated subscription hook on the\n"
    "    // AssetManager class. Polled at 4Hz; cheap (Map.size is O(1))\n"
    "    // and stops as soon as the buffer is empty.\n"
    "    let lastSeenAssetCount = assetManager.assets.size;\n"
    "    let pendingReplayRaf = 0;\n"
    "    const tickPendingReplay = () => {\n"
    "      if (pendingInspectorUpdatesRef.current.size === 0) {\n"
    "        lastSeenAssetCount = assetManager.assets.size;\n"
    "        pendingReplayRaf = 0;\n"
    "        return;\n"
    "      }\n"
    "      const cur = assetManager.assets.size;\n"
    "      if (cur > lastSeenAssetCount) {\n"
    "        // At least one new asset landed since last tick. Try to\n"
    "        // replay any buffered updates whose asset is now present.\n"
    "        const buf = pendingInspectorUpdatesRef.current;\n"
    "        for (const [aid, upd] of Array.from(buf.entries())) {\n"
    "          if (assetManager.assets.has(aid)) {\n"
    "            console.debug('[inspector-sync] replaying buffered update for newly-landed asset', aid);\n"
    "            buf.delete(aid);\n"
    "            // Re-dispatch the buffered update by invoking the same\n"
    "            // callback that just dropped it. We don't re-call the\n"
    "            // handler directly (closure capture); instead we fire\n"
    "            // the callback through the NetworkService's callback\n"
    "            // Set so the same code path runs (including the\n"
    "            // setSelectedAsset reconciliation at the end).\n"
    "            // Easiest: just call the handler's body by re-issuing\n"
    "            // the update through a fresh onInspectorUpdate call.\n"
    "            // The handler is already registered above; we invoke\n"
    "            // it through the public API by building a synthetic\n"
    "            // envelope and dispatching it through the private\n"
    "            // callback. Cheapest path: directly mutate the\n"
    "            // Three.js node from the buffered update using the\n"
    "            // same field-by-field logic. We duplicate a small\n"
    "            // portion of the handler to keep the replay path\n"
    "            // self-contained and avoid re-entrancy surprises.\n"
    "            const asset = assetManager.assets.get(aid);\n"
    "            if (!asset) continue;\n"
    "            const targetNode = upd.nodeUuid\n"
    "              ? findObjectByUUID(asset.object3d, upd.nodeUuid)\n"
    "              : asset.object3d;\n"
    "            if (!targetNode) continue;\n"
    "            if (upd.name !== undefined) { asset.name = upd.name; targetNode.name = upd.name; }\n"
    "            if (upd.active !== undefined) { targetNode.visible = upd.active; }\n"
    "            if (upd.persistent !== undefined) { targetNode.userData.isPersistent = upd.persistent; }\n"
    "            if (upd.meshEnabled !== undefined) {\n"
    "              targetNode.traverse((child) => {\n"
    "                if ((child as THREE.Mesh).isMesh) { (child as THREE.Mesh).visible = upd.meshEnabled!; }\n"
    "              });\n"
    "            }\n"
    "            if (upd.resoniteLight !== undefined) {\n"
    "              if (upd.resoniteLight === null) { removeLightComponent(targetNode); }\n"
    "              else { syncThreeLightFromConfig(targetNode, { ...DEFAULT_LIGHT_CONFIG, ...upd.resoniteLight }); }\n"
    "            }\n"
    "            if (upd.rotatorSpeed !== undefined) { targetNode.userData.rotatorSpeed = upd.rotatorSpeed; }\n"
    "            if (upd.bobbingSpeed !== undefined) { targetNode.userData.bobbingSpeed = upd.bobbingSpeed; }\n"
    "            const sel2 = selectedAssetRef.current;\n"
    "            if (sel2 && sel2.id === aid) { setSelectedAsset({ ...asset }); }\n"
    "          }\n"
    "        }\n"
    "        lastSeenAssetCount = cur;\n"
    "      }\n"
    "      pendingReplayRaf = window.setTimeout(tickPendingReplay, 250) as unknown as number;\n"
    "    };\n"
    "    pendingReplayRaf = window.setTimeout(tickPendingReplay, 250) as unknown as number;\n"
    "    disposers.push(() => { if (pendingReplayRaf) clearTimeout(pendingReplayRaf); });\n"
    "\n"
    "    net.onAvatar((update) => {\n"
)

if old_anchor not in app_content:
    print("ERROR: anchor pattern not found in App.tsx")
    sys.exit(1)

app_content = app_content.replace(old_anchor, new_anchor, 1)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(app_content)

print("App.tsx updated with diagnostic logs + buffer replay mechanism")
print("SUCCESS")
