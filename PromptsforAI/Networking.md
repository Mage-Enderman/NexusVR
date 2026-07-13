# Prompt: Fix large-asset transfer in NetworkService.ts

## Context
`NetworkService.ts` is a PeerJS-based P2P networking layer for a WebXR/Quest app. Assets get broadcast as `AssetSpawnData` envelopes. Small files are base64-encoded and sent as JSON; oversized files are meant to fall back to a peer-to-peer chunk-request system (`hostedAssets` / `p2preq` / `p2pdata`), but that fallback is broken and architecturally wrong for large files anyway.

## Bugs to fix
1. **`p2pdata` envelopes lose their payload.** `buildEnvelope()` only base64-encodes `ArrayBuffer` fields for `'spawn'` and `'syncresp'` types. The `'p2preq'` handler builds a `'p2pdata'` envelope with a raw `ArrayBuffer` in `data`, which `JSON.stringify` serializes to `{}`. Fix by either (a) adding a matching encode/decode branch, or — preferred — replacing this whole path per the redesign below.
2. **`p2pdata` replies are broadcast to all peers** instead of being sent only to the requester (`fromPeerId`). `requestAssetChunk` targets a specific peer; the reply must too.
3. **`sendChunked`'s `CHUNK_SIZE` (128KB) contradicts the documented/enforced 64KB safety ceiling** (`sendEnvelopeTo` triggers chunking at 64KB, comments throughout cite 64KB as the safe max for Quest's browser). Either raise the threshold to match or shrink `CHUNK_SIZE` to 64KB — pick one and make it consistent.

## Core problem: JSON/base64 is the wrong transport for large files
Everything above rides the JSON envelope path (base64 string → `JSON.stringify` → string-sliced "chunks" → `JSON.parse` on receipt). That's ~33% size overhead plus holding a giant string in memory before parsing — this is what crashes Quest on large payloads, and it's the wrong path for anything above `MAX_INLINED_FILE_BYTES`.

There's already a working raw-binary path in this file: `openBinaryChannel` / `binaryConns` (`serialization: 'binary'`, no JSON, no base64), currently used only for live video streaming. **Generalize this into the large-asset transfer mechanism and retire the JSON-based `p2preq`/`p2pdata` pair.**

## Requested design
- Keep the JSON/base64 path only for assets under `MAX_INLINED_FILE_BYTES` — that's fine as-is.
- For assets over that cutoff, transfer them over a binary `DataConnection` (reuse/extend `openBinaryChannel`) using a small fixed header per chunk (chunk index, total count/size, asset id) followed by raw bytes — no JSON, no base64.
- Reuse/generalize the existing `bufferedAmount` backpressure check in `sendChunked` so large binary sends don't overrun the SCTP buffer, same as needed for JSON chunking today.
- **Incremental/streaming loading where the asset type supports it**: as chunks arrive, feed them directly into a streaming/incremental parser or `MediaSource`-style consumer instead of buffering the full file before decode. This is the main lever for handling very large files (e.g. gaussian splats) without a memory spike on Quest.
- **Where incremental decode isn't feasible for a given asset type** (e.g. formats that require the full file before parsing, like some GLB/FBX/OBJ variants), fall back to buffer-then-decode over the same binary channel — still far better than the JSON/base64 path, just not streaming. Make this a per-asset-type decision point (e.g. a capability flag or callback the receiver provides), not a hardcoded branch.
- Preserve existing public API shape (`broadcastSpawn`, `onSpawn`, `sendSceneSnapshot`, etc.) as much as possible so calling code doesn't need to change — the transport swap should be internal.
- Clean up related state consistently on `disconnect()`/`becomeHost()` (this file has existing gaps there — check `hostedAssets`, `pendingEnvelopes`, `chunkedMessages`, `binaryConns`, and `this.peers` aren't leaking stale entries across sessions/host migrations while you're in this code).

## Deliverable
Updated `NetworkService.ts` (and any small companion module you introduce for the streaming receiver logic) that:
- Transfers large assets over raw binary DataChannels with backpressure-aware chunking.
- Supports incremental/streaming decode for asset types that allow it, with a clean fallback for those that don't.
- Removes the broken JSON-based `p2preq`/`p2pdata` fallback (or fixes it only as an interim step before the binary path lands).