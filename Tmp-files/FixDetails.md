# Prompt: Fix "Active" toggle not syncing to peers in Scene Inspector

## Symptom
Disabling an object via the "Active" checkbox in `SceneInspectorWindow.tsx` hides it locally but the object stays visible/enabled on other peers' clients.

## What's already confirmed correct (don't re-investigate these)
- `SceneInspectorWindow.tsx` (~line 1341): the Active checkbox correctly sets `selectedAsset.object3d.visible` locally AND calls `onBroadcastInspectorUpdate?.({ assetId, nodeUuid: undefined, active: e.target.checked })`.
- `NetworkService.broadcastInspectorUpdate()`: correctly builds an `'inspector'` envelope with `senderPeerId` and sends it over the reliable data channel to all connected peers.
- `NetworkService.handleEnvelopeFrom()`, `case 'inspector'`: correctly fires all `onInspectorUpdateCallbacks` with the received payload on the peer's end.

So the bug is NOT in the send/broadcast/receive plumbing — the envelope genuinely arrives at peers with the correct `active` value.

## Where to look
Find wherever `networkService.onInspectorUpdate(cb)` is subscribed (search the codebase — it is NOT in `AssetManager.ts`, which has no logic at all for consuming `InspectorUpdateData`). This is most likely in `App.tsx`. Check:

1. **Is it subscribed at all?** If there's no `networkService.onInspectorUpdate(...)` call anywhere, that's the whole bug — the update arrives but nothing applies it. Add a subscription that looks up the asset by `update.assetId` in `assetManager.assets`, resolves the target node (root `object3d`, or via `findObjectByUUID` if `update.nodeUuid` is set), and applies each present field — critically `object3d.visible = update.active` when `update.active !== undefined`.

2. **If it IS subscribed**, check for:
   - An echo-suppression check on `senderPeerId` that's too aggressive (e.g. comparing against the wrong id, or skipping the update entirely instead of just skipping *re-broadcasting* it).
   - The handler applying `name`/`persistent`/`meshEnabled` but missing the `active` field specifically (an easy field to drop when this handler was extended over time — check against the full `InspectorUpdateData` interface in `NetworkService.ts` line ~90 to see if `active` is actually handled).
   - The handler applying `active` to the wrong target (e.g. always root when `nodeUuid` should scope it, or vice versa).

## Fix requirements
- Every field in `InspectorUpdateData` that has a local-apply path in `SceneInspectorWindow.tsx` should have a matching remote-apply path in the `onInspectorUpdate` subscriber. Audit this side-by-side against the interface, not just `active` — likely other fields have quietly rotted the same way and just haven't been noticed yet.
- Do NOT re-broadcast an update that was just received from a peer (avoid echo loops) — this is what `senderPeerId` is for; use it to skip *sending*, never to skip *applying*.
- Keep this consistent with how `onSpawnCallbacks`/`onTransformCallbacks`/`onMaterialCallbacks` are already wired in `App.tsx`, since those channels apparently work correctly — match their pattern.

## Deliverable
The fix (in `App.tsx` or wherever the subscriber lives), plus a one-line note on which of the two failure modes above it turned out to be.