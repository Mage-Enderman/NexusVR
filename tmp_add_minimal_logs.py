#!/usr/bin/env python3
"""
Add ONLY minimal, non-functional console.debug diagnostic logs at 3
key points in the inspector sync pipeline. No buffer replay, no other
behavior changes. The logs are pure observability - they cannot break
local functionality.
"""
import sys

# ---- 1. NetworkService.broadcastInspectorUpdate: log the broadcast attempt ----
with open('src/services/NetworkService.ts', 'r', encoding='utf-8') as f:
    ns = f.read()

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
    "    console.debug('[inspector-sync] broadcasting update, dataConns.size=', this.dataConns.size, 'assetId=', update.assetId, 'active=', update.active);\n"
    "    this.broadcastEnvelope(this.buildEnvelope('inspector', { ...update, senderPeerId: this.localPeerId }));\n"
    "  }\n"
)
if old_ns not in ns:
    print("ERROR: broadcastInspectorUpdate pattern not found")
    sys.exit(1)
ns = ns.replace(old_ns, new_ns, 1)

old_case = (
    "      case 'inspector':\n"
    "        for (const cb of this.onInspectorUpdateCallbacks) cb(env.payload as InspectorUpdateData);\n"
    "        break;\n"
)
new_case = (
    "      case 'inspector':\n"
    "        console.debug('[inspector-sync] envelope received, callbacks.size=', this.onInspectorUpdateCallbacks.size, 'payload=', env.payload);\n"
    "        for (const cb of this.onInspectorUpdateCallbacks) cb(env.payload as InspectorUpdateData);\n"
    "        break;\n"
)
if old_case not in ns:
    print("ERROR: 'inspector' case not found")
    sys.exit(1)
ns = ns.replace(old_case, new_case, 1)

with open('src/services/NetworkService.ts', 'w', encoding='utf-8') as f:
    f.write(ns)
print("NetworkService.ts: added 2 diagnostic logs")


# ---- 2. App.tsx receive handler: log entry + early-return gates ----
with open('src/App.tsx', 'r', encoding='utf-8') as f:
    app = f.read()

# The receive handler starts with the disposers.push call. Add a single
# log at the top of the callback body and one at each gate.
old_recv = (
    "    disposers.push(net.onInspectorUpdate((update) => {\n"
    "      if (update.senderPeerId === net.localPeerId) return;\n"
    "      const asset = assetManager.assets.get(update.assetId);\n"
    "      if (!asset) return;\n"
    "      const targetNode = update.nodeUuid\n"
    "        ? findObjectByUUID(asset.object3d, update.nodeUuid)\n"
    "        : asset.object3d;\n"
    "      if (!targetNode) return;\n"
    "\n"
    "      if (update.name !== undefined) {\n"
    "        asset.name = update.name;\n"
    "        targetNode.name = update.name;\n"
    "      }\n"
    "      if (update.active !== undefined) {\n"
    "        targetNode.visible = update.active;\n"
    "      }\n"
)
new_recv = (
    "    disposers.push(net.onInspectorUpdate((update) => {\n"
    "      console.debug('[inspector-sync] handler entered: sender=', update.senderPeerId, 'local=', net.localPeerId, 'assetId=', update.assetId, 'active=', update.active);\n"
    "      if (update.senderPeerId === net.localPeerId) {\n"
    "        console.debug('[inspector-sync] gate: echo-suppressed');\n"
    "        return;\n"
    "      }\n"
    "      const asset = assetManager.assets.get(update.assetId);\n"
    "      if (!asset) {\n"
    "        console.debug('[inspector-sync] gate: asset not in assetManager, assetId=', update.assetId);\n"
    "        return;\n"
    "      }\n"
    "      const targetNode = update.nodeUuid\n"
    "        ? findObjectByUUID(asset.object3d, update.nodeUuid)\n"
    "        : asset.object3d;\n"
    "      if (!targetNode) {\n"
    "        console.debug('[inspector-sync] gate: targetNode not found, nodeUuid=', update.nodeUuid);\n"
    "        return;\n"
    "      }\n"
    "\n"
    "      if (update.name !== undefined) {\n"
    "        asset.name = update.name;\n"
    "        targetNode.name = update.name;\n"
    "      }\n"
    "      if (update.active !== undefined) {\n"
    "        console.debug('[inspector-sync] APPLYING active=', update.active, 'to', asset.name);\n"
    "        targetNode.visible = update.active;\n"
    "      }\n"
)
if old_recv not in app:
    print("ERROR: receive handler pattern not found")
    sys.exit(1)
app = app.replace(old_recv, new_recv, 1)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(app)
print("App.tsx: added 5 diagnostic logs in receive handler")

print("SUCCESS")
