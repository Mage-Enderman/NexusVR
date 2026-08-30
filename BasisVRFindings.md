# BasisVR Architectural Analysis - Lessons for NexusVR

> Purpose: Document noteworthy patterns, systems, and design decisions from BasisVR source code that could inform NexusVR evolution.
> Source: BasisVR developer branch (Unity 6, C#). Read directly from GitHub raw source.
> Date: August 30, 2026

---

## Overview

BasisVR is a Unity/C# social VR framework built on URP, targeting IL2CPP across Windows, Linux, Android, and iOS. Its architecture is organized into approximately 40 Unity packages under Basis/Packages/, with clean separation between:

- com.basis.framework - Core runtime (networking, avatar, audio, interactions, UI)
- com.basis.sdk - Creator-facing tools for avatars, worlds, and props
- com.basis.server - Dedicated .NET server (cross-platform, headless mode)
- Add-on packages - Vehicles, pool table, snap controls, mediapipe tracking, etc.

The framework philosophy ("framework not platform") is enforced architecturally: the core ships primitives, not a fixed social experience. Everything is extensible and replaceable.

---

## 1. Networking Architecture

### Transport Layer

BasisVR uses LiteNetLib (reliable UDP) as the default transport, with a pluggable backend system (BasisNetworkStackRegistry). The transport can be swapped without touching game code.

Key files:
- BasisNetworkManagement.cs - Static centralized manager for connection lifecycle, simulation ticks, time sync
- BasisNetworkConnection.cs - Session management, server runner, time utilities, send helpers
- BasisNetworkEvents.cs - Channel-based message dispatch

### Notable Patterns

#### Static Centralized Manager
Uses a static class (not a singleton MonoBehaviour). This avoids Unity DontDestroyOnLoad and makes the API callable from anywhere.

#### Channel-Based Message Dispatch
Every message type is registered on a dedicated channel with a handler. Channels are numbered constants. A plugin channel system lets third-party code register additional channels without modifying core code.

#### Two-Phase Network Compute (Pipelined)
The network update loop is split into phases that overlap with rendering:
1. Phase 1 (main thread): Unity object validation, cache lookup, lightweight pre-compute
2. Phase 2 (background worker): Per-receiver audio decode, packet processing, interpolation
3. Phase 3 (main thread): AudioSource apply, profiler update

When receiver count is 4 or fewer, it skips the background thread and runs synchronously.

### Client-Host vs. Dedicated Server

BasisVR supports both modes from the same codebase:
- Host mode: Client spins up an embedded server on localhost, then connects to it
- Dedicated server: Cross-platform .NET app with first-boot setup wizard, headless mode

---

## 2. Avatar Sync Protocol

### Overview

BasisVR avatar sync handles:
- Full-body bone rotation sync across arbitrary rigs
- Blendshape sync
- End-effector IK anchoring (hands/feet with trackers)
- Distance-based LOD for sync rate
- Idle/deadband suppression (skip sending when nothing changed)
- Uplink delta compression (keyframes + deltas)

### Generic Bone Rotation Encoding

Key insight: Bone rotations are encoded in a rig-neutral "generic rotation space" rather than in each avatar's local bone space. The formula is:

    generic = encodePre[bone] x currentLocal x encodePost[bone]

The encodePre/encodePost pairs are built once during calibration from the avatar's T-pose. Receivers rebuild their own rig's local rotations from the generic deltas using their own rest frames.

Wire format: "Smallest three" quaternion encoding - only the three smallest components of each quaternion are sent (the largest is reconstructed). This saves 25% of quaternion bandwidth.

### Bone Packet Structure

1. Hips world position (high precision)
2. 21 wire bone rotations (smallest-three encoded, with restricted-DOF tables)
3. 20 finger scalars (10 curl + 10 splay percentages)
4. Scale
5. Hips world rotation
6. Hips local-position delta (vs T-pose, for seated mode)
7. Hips local-rotation delta (generic space)
8. End-effector block (4 effector positions + rotations + mask)
9. Additional data (blendshapes, custom params - optional, sent on separate channels)

### Quality Tiers

Avatar data is sent on different channels based on quality level: VeryLow (distant), Low (medium), Medium (close), High (very close). Each tier has a separate byte budget.

### Idle Suppression

Two mechanisms prevent redundant sends:
1. Byte-identical suppression: If the serialized payload is identical to the last sent frame, it is dropped
2. Deadband suppression: Even if VR sensor noise causes different bytes, if every raw field is within its sub-visibility threshold, the frame is dropped

Thresholds: sub-degree bone rotation, sub-centimeter position, sub-percentage finger change, sub-unit scale change. An idle heartbeat is sent periodically (default ~0.5s) even when suppressed.

### Uplink Delta Compression

- A full keyframe is sent every 0.5 seconds
- Between keyframes, per-field deltas against the baseline are sent
- If the delta is larger than the keyframe, it is promoted to a keyframe automatically
- Receivers that miss a keyframe can request one

### Distance-Based LOD

Remote players are assigned LOD levels (0-3) based on distance. Higher LOD = less frequent updates via a PoseSkipByLod array.

---

## 3. Compression & Bandwidth Optimization

### LZ4 Compression
Used across the codebase for data channels: avatar bundle compression, server library messages, content share payloads.

### Deflate Compression
Used for heavier payloads: remote player spawn batches (up to 32KB compressed), avatar bundle transfers.

### Bit Packing
The BasisAvatarBitPacking system provides quality-dependent bit budgets: 21 wire bone slots, 10 finger channels (x2 for curl+splay), with RotationBytes(quality) varying by tier.

### Byte Allocation for Avatar Packets
Full packet layout: [hipsWorldPos] [21 bone rotations] [20 finger scalars] [scale] [hipsWorldRot] [hipsDelta] [hipsRotDelta] [4 effector positions] [4 effector rotations] [effectorMask].

---

## 4. Object Sync & Ownership

### Ownership System
Full ownership model with async request/response: TakeOwnershipAsync, RemoveOwnershipAsync, RequestCurrentOwnershipAsync, plus fast local validation via IsOwnerLocalValidation.

Ownership is tracked per unique network ID. Transfer messages use reliable ordered delivery.

### Object Sync Components
- BasisObjectSyncNetworking.cs - General object sync
- BasisPickupSyncNetworking.cs - Physics pickup sync (grab/throw)
- BasisSeatSync.cs - Seat occupancy sync
- BasisSyncedTransform.cs - Transform synchronization
- BasisSyncedRigidbody.cs - Rigidbody state sync

Uses a batch collector pattern: BasisSyncBatch, BasisSyncBatchCollector, BasisSyncDriver.

### Interpolation
Transform interpolation is Burst-compiled: BasisSyncInterpolationJobs, BasisSyncReductionJob (distance-based), BasisSyncCodec, BasisSyncPool.

---

## 5. Audio Pipeline

### Voice Chat
Opus (48 kHz) with forward error correction, jitter buffer + packet-loss concealment, RNNoise neural noise suppression, per-player volume and mute with personal block lists.

### Audio Channels
Standard voice, large voice packets, non-spatialized broadcast voice (shout).

### Spatial Audio
3D positional audio with distance attenuation, per-player volume controls, talk modes (proximity, targeted, private-group, P2P-direct, admin shout).

### AudioLink Integration
Audio-reactive data for shaders - voice and music drive visual effects on avatars and worlds.

### Mic Processing Suite
Automatic gain control, noise gate, voice-activity detection, input limiter, per-device input selection.

---

## 6. Moderation & Permissions

### UUID-Based Identity
Players identified by UUID, not session IDs. Enables persistent bans and cross-session identity.

### Permission Groups
Hierarchical groups with parent inheritance. Individual users can have additional permission nodes.

### Global Lock System
Server can push lock flags to all clients: avatar lock, prop lock, world lock, third-person disable, text chat lock, voice chat lock, media player lock, camera capture lock, prop grabbing lock, P2P lock, Cilbox (script) lock, image sharing lock.

### Moderation Actions
Kick/Ban/IP-Ban, Unban, Force avatar change, Locomotion overrides, Shout mode, Server name/MOTD, Allowlist management, Default library items, Log bundle streaming, Full-quality broadcast override.

---

## 7. Event System & Channel Architecture

### Channel Registry
Approximately 30+ predefined channels: avatar sync (per quality tier x large/small), voice (normal/large/shout), scene/object sync, admin, chat, content share, P2P, events (multiplexed with event type byte).

### Plugin Channel System
Third-party code registers additional channels. Channel IDs above PluginChannelStart route to the plugin registry.

### Events Channel
Multiplexed channel where first byte selects event type: camera shutter/countdown, temp-block, avatar rate change, chat typing, talk mode change, mute state, voice record request/consent, jiggle grab events.

### Message Validation & Reader Recycling
Every handler validates message size. All NetDataReader instances recycled after use to avoid GC pressure. Heavy decode work offloaded to background threads.

---

## 8. Performance & Profiling

### Built-in Profiler
Comprehensive in-app profiler with per-frame counters: LocalAvatarSync, OutboundAvatarServer, PlayerAvatar, ShoutVoice, ContentShare, Admin, Chat, ServerSideSyncPlayer, NetIDAssign (20+ categories total).

### Burst Jobs
Performance-critical paths: avatar bone compression, transform interpolation, remote bone job system, distance-based reduction.

### Thread Management
Dedicated background thread for network compute with MaxDegreeOfParallelism = ProcessorCount - 2.

### Memory Management
NativeArray for zero-GC data, ArrayPool for temp buffers, persistent allocations reused across frames, TransformAccessArray for batch reads.

---

## 9. Content Management (BEE Bundles)

### BEE File Format
Multi-platform asset bundles in a single file, optional password protection, range request support, LZ4 compression, client-side cache keyed per password.

### Content Validation
Pre-build validation: poly/bone/material/light/particle/collider/jiggle-rig limits for avatars, scene validation, prop validation.

### Bundle Management
Content packaging, loading/unloading, addressable dependency tools, build size and asset stats.

### NDMF Pipeline
Non-destructive avatar build hook with automatic viseme/eye mapping for VRChat-compatible avatar tools.

---

## 10. Cross-Cutting Concerns

### Thread Safety
IsMainThread() checks, ManualResetEventSlim for synchronization, volatile flags, Interlocked.Increment for atomic counters.

### Resource Management
Avatar model caching, asset lifecycle management, async scene loading, platform-specific handling.

### Device Management
Centralized device lifecycle, headless mode, input device enumeration, Quest/PCVR/desktop handling.

### Security
UUID-based identity (BasisDID), ChaCha20-Poly1305 encryption for P2P, server-side auth, client-side validation on all channels.

---

## 11. Actionable Recommendations for NexusVR

### Priority 1: Avatar Sync Protocol Design
What BasisVR does: Rig-neutral generic space encoding, smallest-three quaternions, quality tiers, deadband suppression, delta compression.
NexusVR adaptation:
- Design a rig-neutral avatar protocol for different VRM avatars
- Implement smallest-three quaternion encoding (25% bandwidth savings)
- Add quality tiers (3-4 levels) based on distance
- Implement deadband suppression
- Consider delta compression (keyframe every 0.5s, deltas between)

### Priority 2: Network Architecture
What BasisVR does: Channel-based dispatch, pluggable transport, pipelined compute, reader recycling.
NexusVR adaptation:
- Adopt channel-based message system (replacing ad-hoc envelope types)
- Implement reader recycling for GC reduction
- Design for pluggable transport

### Priority 3: Ownership Model
What BasisVR does: Full async ownership system with local validation.
NexusVR adaptation:
- Implement proper object ownership
- Add ownership transfer messages
- Support take/release ownership semantics

### Priority 4: Compression
What BasisVR does: LZ4, Deflate, bit packing.
NexusVR adaptation:
- Add LZ4 via fflate/lz-string to WebRTC data channels
- Implement bit packing for frequently-sent data
- Compress spawn envelopes

### Priority 5: Profiling & Diagnostics
NexusVR adaptation:
- Add network counters (bytes sent/received per category)
- Track avatar update rates and sizes
- Add debug overlay showing network stats

### Priority 6: Moderation System
What BasisVR does: UUID identity, hierarchical permission groups, global locks.
NexusVR adaptation:
- Adopt UUID-based player identity
- Implement permission groups
- Add global lock flags
- Support persistent kick/ban

### Priority 7: Audio Improvements
NexusVR adaptation:
- Add per-player volume controls
- Implement talk modes (proximity, whisper, shout)
- Explore reactive audio for shaders

### Priority 8: Content Validation
NexusVR adaptation:
- Validate VRM avatars on import (poly count, bone count, texture size)
- Warn about oversized assets
- Implement content limits per room

---

## Appendix: Key Source Files Reference

| File | Purpose |
|------|---------|
| BasisNetworkManagement.cs | Centralized network manager (static class) |
| BasisNetworkConnection.cs | Connection/session management |
| BasisNetworkEvents.cs | Channel-based message dispatch |
| BasisNetworkAvatarCompressor.cs | Avatar bone compression + encoding |
| BasisNetworkOwnership.cs | Object ownership system |
| BasisNetworkModeration.cs | Admin/moderation actions |
| BasisConnectionHealth.cs | Connection health states |
| BasisNetworkConnectionWatchdog.cs | Reconnection logic |
| BasisSyncDriver.cs | Object sync driver |
| BasisSyncInterpolationJobs.cs | Burst-compiled interpolation |
| BasisRemoteNetworkDriver.cs | Remote player driver |
| BasisNetworkPlayer.cs | Player state management |
| BasisNetworkPlayers.cs | Player collection + lookup |
| BasisNetworkProfiler.cs | Performance counters |
| BasisNetworkHandleVoice.cs | Voice chat handling |
| BasisNetworkHandleAvatar.cs | Avatar sync handling |
| BasisNetworkHandleChat.cs | Chat message handling |
| BasisP2PManager.cs | Peer-to-peer direct connections |
| BasisAvatarLoadThread.cs | Async avatar loading |
| BasisContentShareManager.cs | Content sharing system |
| BasisTalkModeManager.cs | Talk mode (proximity/whisper/shout) |

---

Document generated by analyzing BasisVR developer branch source code.
For questions, refer to the original repository: https://github.com/BasisVR/Basis
