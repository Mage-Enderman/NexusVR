#!/usr/bin/env python3
"""
Fix critical issues in the pendingInspectorUpdates buffer replay:
1. Stale entries: add buf.delete(aid) to the continue paths so deleted
   assets don't leave entries in the Map forever.
2. Max-age eviction: evict entries older than 30s so an asset that
   never lands doesn't leak the buffer forever.
3. Drop the unnecessary 'as unknown as number' cast on setTimeout.
"""
import sys
import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# --- Fix 1 & 2: Change the Map type to store timestamp + update, and add
# eviction + stale-entry handling. The simplest path: keep the Map type
# as Map<string, InspectorUpdateData> but add a parallel Map<aid, ts>
# for eviction. Actually simpler: change the Map value to {ts, update}.
#
# But that would require updating all the .set() / .get() / .delete()
# call sites. To keep the diff small, I'll just add a timestamp check
# inside the replay tick and evict old entries there.

# Find the replay tick function and add eviction logic.
old_tick_start = (
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
)
new_tick_start = (
    "    let lastSeenAssetCount = assetManager.assets.size;\n"
    "    let pendingReplayTimer: number | null = null;\n"
    "    // Map<assetId, {ts, update}> - ts lets us evict entries for\n"
    "    // assets that never land (originating peer deleted them\n"
    "    // before this peer ever received the spawn broadcast).\n"
    "    // We swap the ref's Map out for a richer one below; the\n"
    "    // receive-handler set() call is updated to match.\n"
    "    const tickPendingReplay = () => {\n"
    "      const buf = pendingInspectorUpdatesRef.current as Map<string, { ts: number; update: InspectorUpdateData }>;\n"
    "      // Evict entries older than 30s (asset never landed).\n"
    "      const now = Date.now();\n"
    "      const MAX_AGE_MS = 30_000;\n"
    "      for (const [aid, entry] of Array.from(buf.entries())) {\n"
    "        if (now - entry.ts > MAX_AGE_MS) {\n"
    "          console.debug('[inspector-sync] evicting stale buffered update for', aid, '(asset never landed within', MAX_AGE_MS, 'ms)');\n"
    "          buf.delete(aid);\n"
    "        }\n"
    "      }\n"
    "      if (buf.size === 0) {\n"
    "        lastSeenAssetCount = assetManager.assets.size;\n"
    "        pendingReplayTimer = null;\n"
    "        return;\n"
    "      }\n"
    "      const cur = assetManager.assets.size;\n"
    "      if (cur > lastSeenAssetCount) {\n"
)
if old_tick_start not in content:
    print("ERROR: tickPendingReplay start not found")
    sys.exit(1)
content = content.replace(old_tick_start, new_tick_start, 1)

# Update the setTimeout call to use the new var name and drop the cast.
old_set_timeout_1 = "      pendingReplayRaf = window.setTimeout(tickPendingReplay, 250) as unknown as number;\n"
new_set_timeout_1 = "      pendingReplayTimer = window.setTimeout(tickPendingReplay, 250);\n"
if old_set_timeout_1 not in content:
    print("ERROR: first setTimeout call not found")
    sys.exit(1)
content = content.replace(old_set_timeout_1, new_set_timeout_1, 1)

old_set_timeout_2 = "    pendingReplayRaf = window.setTimeout(tickPendingReplay, 250) as unknown as number;\n    disposers.push(() => { if (pendingReplayRaf) clearTimeout(pendingReplayRaf); });\n"
new_set_timeout_2 = "    pendingReplayTimer = window.setTimeout(tickPendingReplay, 250);\n    disposers.push(() => { if (pendingReplayTimer !== null) clearTimeout(pendingReplayTimer); });\n"
if old_set_timeout_2 not in content:
    print("ERROR: second setTimeout call not found")
    sys.exit(1)
content = content.replace(old_set_timeout_2, new_set_timeout_2, 1)

# Update the receive-handler set() call to include the timestamp wrapper.
old_set = "        pendingInspectorUpdatesRef.current.set(update.assetId, update);\n"
new_set = "        (pendingInspectorUpdatesRef.current as Map<string, { ts: number; update: InspectorUpdateData }>).set(update.assetId, { ts: Date.now(), update });\n"
if old_set not in content:
    print("ERROR: pendingInspectorUpdatesRef.set call not found")
    sys.exit(1)
content = content.replace(old_set, new_set, 1)

# Update the replay loop to read the wrapped {ts, update} entries and
# delete on stale paths. The current loop body uses `upd.X` directly
# and has `if (!asset) continue;` and `if (!targetNode) continue;`
# without deleting the entry.
old_replay_loop = (
    "        for (const [aid, upd] of Array.from(buf.entries())) {\n"
    "          if (assetManager.assets.has(aid)) {\n"
    "            console.debug('[inspector-sync] replaying buffered update for newly-landed asset', aid);\n"
    "            buf.delete(aid);\n"
    "            // Re-dispatch the buffered update by invoking the same\n"
)
new_replay_loop = (
    "        for (const [aid, entry] of Array.from(buf.entries())) {\n"
    "          const upd = entry.update;\n"
    "          if (!assetManager.assets.has(aid)) {\n"
    "            // Asset still missing - leave in buffer, will retry\n"
    "            // next tick or be evicted by the age check above.\n"
    "            continue;\n"
    "          }\n"
    "          {\n"
    "            console.debug('[inspector-sync] replaying buffered update for newly-landed asset', aid);\n"
    "            buf.delete(aid);\n"
    "            // Re-dispatch the buffered update by invoking the same\n"
)
if old_replay_loop not in content:
    print("ERROR: replay loop start not found")
    sys.exit(1)
content = content.replace(old_replay_loop, new_replay_loop, 1)

# Add a `buf.delete(aid)` on the !asset and !targetNode paths inside
# the replay block so a deleted asset doesn't leave a stale entry.
old_no_asset = (
    "            const asset = assetManager.assets.get(aid);\n"
    "            if (!asset) continue;\n"
    "            const targetNode = upd.nodeUuid\n"
    "              ? findObjectByUUID(asset.object3d, upd.nodeUuid)\n"
    "              : asset.object3d;\n"
    "            if (!targetNode) continue;\n"
)
new_no_asset = (
    "            const asset = assetManager.assets.get(aid);\n"
    "            if (!asset) { buf.delete(aid); continue; }\n"
    "            const targetNode = upd.nodeUuid\n"
    "              ? findObjectByUUID(asset.object3d, upd.nodeUuid)\n"
    "              : asset.object3d;\n"
    "            if (!targetNode) { buf.delete(aid); continue; }\n"
)
if old_no_asset not in content:
    print("ERROR: !asset / !targetNode guard not found")
    sys.exit(1)
content = content.replace(old_no_asset, new_no_asset, 1)

# Update the successful-apply delete in the receive handler to use the
# wrapped Map (the receive handler's apply path is the first arrival,
# not the replay; but if a buffered update and a new update arrive for
# the same asset, the new one overwrites the buffer entry, and the
# receive handler clears the buffer on success).
old_recv_delete = (
    "      // Successful apply - clear any buffered update for this asset.\n"
    "      if (pendingInspectorUpdatesRef.current.has(update.assetId)) {\n"
    "        pendingInspectorUpdatesRef.current.delete(update.assetId);\n"
    "      }\n"
)
new_recv_delete = (
    "      // Successful apply - clear any buffered update for this asset.\n"
    "      pendingInspectorUpdatesRef.current.delete(update.assetId);\n"
)
if old_recv_delete not in content:
    print("ERROR: receive handler successful-apply delete not found")
    sys.exit(1)
content = content.replace(old_recv_delete, new_recv_delete, 1)

# Also update the ref's type to use the wrapper. The original ref
# declaration was Map<string, InspectorUpdateData>; we now want
# Map<string, { ts: number; update: InspectorUpdateData }>. Change the
# declaration to `Map<string, any>` to keep the ref's type flexible
# (the cast at the use sites keeps it type-safe).
old_ref_decl = (
    "  const pendingInspectorUpdatesRef = useRef<Map<string, InspectorUpdateData>>(new Map());\n"
)
new_ref_decl = (
    "  const pendingInspectorUpdatesRef = useRef<Map<string, { ts: number; update: InspectorUpdateData }>>(new Map());\n"
)
if old_ref_decl not in content:
    print("ERROR: pendingInspectorUpdatesRef declaration not found")
    sys.exit(1)
content = content.replace(old_ref_decl, new_ref_decl, 1)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("App.tsx buffer replay mechanism hardened (stale eviction + delete-on-missing)")
print("SUCCESS")
