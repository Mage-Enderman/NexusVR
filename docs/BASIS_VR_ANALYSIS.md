# BasisVR Comprehensive Architecture & Technical Analysis
> **Lessons and Actionable Blueprints for NexusVR (WebXR / Three.js / WebRTC)**
> **Source:** BasisVR Developer Branch (Unity 6 / C# / URP / Burst IL2CPP)
> **Date:** August 30, 2026

---

## Table of Contents
1. [Executive Summary & Architectural Pillars](#1-executive-summary--architectural-pillars)
2. [Avatar IK, Embodiment & Constellation Tracking](#2-avatar-ik-embodiment--constellation-tracking)
3. [Avatar Sync Protocol & Bandwidth Compression](#3-avatar-sync-protocol--bandwidth-compression)
4. [Networking Core & Transport Layer](#4-networking-core--transport-layer)
5. [Physics Authority, Interaction & Locomotion](#5-physics-authority-interaction--locomotion)
6. [Spatial Audio, Voice & Acoustics](#6-spatial-audio-voice--acoustics)
7. [Security, Performance & Avatar Sandboxing](#7-security-performance--avatar-sandboxing)
8. [Moderation, Identity & Global Permissions](#8-moderation-identity--global-permissions)
9. [Content Management (BEE Bundles & NDMF)](#9-content-management-bee-bundles--ndmf)
10. [Synchronized Media Player](#10-synchronized-media-player)
11. [Cross-Cutting Architecture & Memory Management](#11-cross-cutting-architecture--memory-management)
12. [Actionable Recommendations & NexusVR Implementation Plan](#12-actionable-recommendations--nexusvr-implementation-plan)
13. [Appendix: Key Source Files Reference](#13-appendix-key-source-files-reference)

---

## 1. Executive Summary & Architectural Pillars

BasisVR is an open-source, high-concurrency Social VR framework designed around the philosophy of **"Framework not Platform"**—the core runtime ships composable primitives rather than a rigid, locked-in social experience. Everything is extensible, modular, and replaceable.

The architecture is structured across ~40 packages under `Basis/Packages/`:
* `com.basis.framework`: Core runtime (networking, avatar, audio, interactions, UI, math)
* `com.basis.sdk`: Creator-facing tooling for avatars, worlds, and props
* `com.basis.server`: Dedicated cross-platform headless .NET server
* `com.basis.eeriemovement`: High-performance Burst-compiled avatar IK & skeletal motion
* `com.basis.addon.*`: Add-ons including vehicles, snap controls, media playback, and hardware integrations

### Core Pillars
1. **Embodiment**: A tight, continuous loop between raw player tracking, inverse kinematics, anatomical compensation curves, and avatar skeletal representation.
2. **Spatialization**: Realistic acoustics (HRTF / SOFA binaural profiles), direct physical touch, and authored interaction grips.
3. **Presence & Efficiency**: Low-latency transport, bit-packed delta compression, deadband suppression, and rigorous sandboxing against malicious or unoptimized user content.

While BasisVR is written in **Unity / C#** (targeting URP and Burst-compiled IL2CPP across PC, Quest/Android, and iOS), its mathematical foundations, packet layouts, and architectural patterns translate directly to NexusVR's **TypeScript / Three.js / WebXR** stack.

---

## 2. Avatar IK, Embodiment & Constellation Tracking

BasisVR includes one of the most sophisticated open-source full-body IK solvers in social VR (`com.basis.eeriemovement`).

### A. The 22-Slot Flat Skeletal Model (`BasisEerieMovement.cs`)
* **Slot-Based Architecture**: Instead of traversing dynamic transform hierarchy trees every frame, the solver maps any humanoid skeleton to 22 standardized slots:
  `Hips`, `Spine`, `Chest`, `UpperChest`, `Neck`, `Head`, `LeftShoulder`, `RightShoulder`, `LeftArm`, `RightArm`, `LeftForearm`, `RightForearm`, `LeftHand`, `RightHand`, `LeftThigh`, `RightThigh`, `LeftCalf`, `RightCalf`, `LeftFoot`, `RightFoot`, `LeftToe`, `RightToe` (plus auxiliary twist bones).
* **Burst-Compiled Job Solver**: Operates entirely over flat, pre-allocated memory structures (`FixedList512Bytes<Vector3>`, `FixedList512Bytes<Quaternion>`) to eliminate garbage collection and maximize CPU cache locality.

### B. Anatomical Realism & Secondary Curves
Traditional social VR IK systems stretch straight CCD/FABRIK chains between tracked points, creating rigid "action figure" poses. BasisVR introduces bio-mechanical curve compensation:
* **Cervical Lordosis & Gaze Distribution**: Calculates natural lordosis curve gains for the neck and upper chest when the player tilts or looks around, rather than pivoting purely at the head bone.
* **Hip Hinge & Trunk Counterbalance**: When leaning forward or crouching, hips automatically translate backward (`hipHingeStartDeg`, `trunkCounterbalance`, `crouchDepth`) to maintain the physical center of mass and prevent knees from awkwardly protruding forward.
* **Clavicle Shrug & Slide**: Clavicle joints dynamically elevate and slide forward/backward (`shoulderElevationFactor`, `shoulderProtractionFactor`) as hands reach upward or across the chest.
* **Fractional Twist Bone Distribution**: Rotational twist is split across intermediate twist joints (`lowerArmTwistFraction`, `upperArmTwistFraction`), preventing mesh collapse and "candy wrapper" pinching at wrists and shoulders.

### C. Jitter Reduction & Noise Filtering
* **One-Euro / Adaptive Cutoff Filtering**: Implements adaptive frequency filtering (`trackedKneeSwivelMinCutoffHz`, `trackedKneeSwivelBeta`) on leg swivels and elbow hints. High-speed controller movements pass through uninhibited with zero perceptual latency, while low-speed micro-tremors and sensor noise are filtered out.

### D. Multi-Tracker Constellation (`BasisConstellationClassifier.cs`)
* Automatically detects, classifies, and calibrates connected tracking hardware at runtime:
  - 3-point: HMD + 2 Controllers (Head + Hands)
  - 6-point: Head + Hands + Hips + Feet
  - 8-point / 11-point: Chest, Elbows, Knees, Toes (including direct integrations for SlimeVR and Meta Body Tracking).

---

## 3. Avatar Sync Protocol & Bandwidth Compression

BasisVR achieves high avatar concurrency through multi-layered serialization optimizations.

### A. Generic Bone Rotation Encoding (Rig-Neutral Space)
Instead of syncing avatar rotations in each model's arbitrary local bone orientations, rotations are converted into a rig-neutral **generic rotation space**:

$$\text{generic} = \text{encodePre}[\text{bone}] \times \text{currentLocal} \times \text{encodePost}[\text{bone}]$$

* `encodePre` and `encodePost` matrices are computed once during avatar T-pose calibration.
* Receivers re-project the generic rotations onto their local instance of the sender's avatar rig using their own rest-pose frames, ensuring cross-rig consistency.

### B. Smallest-Three Quaternion Bit-Packing
* Because unit quaternions satisfy $x^2 + y^2 + z^2 + w^2 = 1$, only the 3 smallest absolute components need to be transmitted along with a 2-bit index identifying the largest component. The receiver reconstructs the omitted component:

$$\text{largest} = \sqrt{1 - (a^2 + b^2 + c^2)}$$

* This delivers a **25% reduction** in raw quaternion wire footprint before secondary compression.

### C. Wire Packet Layout
Standard avatar sync packets follow a compact, deterministic binary structure:
1. `Hips World Position` (32-bit float vector)
2. `21 Wire Bone Rotations` (smallest-three quantized, restricted-DOF tables)
3. `20 Finger Scalars` (10 curl + 10 splay normalized percentages)
4. `Scale Factor`
5. `Hips World Rotation`
6. `Hips Local Position Delta` (offset relative to T-pose for seated adjustment)
7. `Hips Local Rotation Delta`
8. `End-Effector Block` (4 effector positions + rotations + mask for IK anchoring)
9. `Auxiliary Channel Data` (blendshapes, eye gaze, custom visemes)

### D. Idle & Deadband Suppression
To prevent unnecessary bandwidth usage when players are still:
1. **Byte-Identical Suppression**: Drops outgoing frames if the serialized binary payload exactly matches the previous frame.
2. **Deadband Suppression**: If tracking hardware reports micro-movements below perceptual visibility thresholds (sub-degree bone angles, sub-centimeter positions, sub-percent finger curls), the packet is suppressed.
3. **Heartbeat Sync**: If continuously suppressed, a low-frequency baseline heartbeat (~0.5s) is emitted to prevent remote client desynchronization.

### E. Uplink Delta Compression & Quality Tiers
* **Keyframes vs. Deltas**: Full baseline keyframes are emitted periodically (~0.5s); intervening ticks transmit only altered bone deltas. If a delta payload exceeds keyframe size, it is promoted to a full keyframe. Receivers can request missing keyframes on demand.
* **Tiered Quality & Distance LOD**:
  - `High` (close proximity): Full bone fidelity & high tick rate.
  - `Medium` / `Low`: Reduced bit allocation (`RotationBytes(quality)`).
  - `VeryLow` (distant): Distance-based update skipping (`PoseSkipByLod`).

---

## 4. Networking Core & Transport Layer

### A. Transport Architecture (`BasisNetworkManagement.cs`)
* **Pluggable Network Backend (`BasisNetworkStackRegistry`)**: Decouples network logic from the underlying socket implementation. Ships with **LiteNetLib** (reliable UDP) for native builds, with support for WebRTC DataChannels / WebSockets.
* **Static Centralized Lifecycle**: Network lifecycle and tick loops are hosted in static managers rather than MonoBehaviour singletons, preventing lifecycle destruction during scene transitions and enabling headless execution.
* **Dual Topology Support**:
  - **Host Mode**: Client hosts an internal local server instance and loops back.
  - **Dedicated Server**: Standalone, headless .NET runtime with interactive setup wizards and server config.

### B. Dual-Channel Protocol Strategy
* **Unreliable / Low-Latency (UDP / WebRTC Unreliable DataChannel)**:
  - Avatar skeletal transforms & finger poses
  - 3D spatialized voice audio frames
  - Object physics & velocity updates
* **Reliable / Ordered (TCP / WebRTC Reliable DataChannel)**:
  - Room lifecycle & permission state
  - Avatar change requests (`ClientAvatarChangeMessage`)
  - Chat, text events, and media player synchronization

### C. Channel Registry & Pipelined Compute
* **Channel Numbering & Plugin Extension**: Over 30 core channels exist for dedicated subsystems (`AvatarSync`, `Voice`, `ObjectSync`, `Admin`, `Events`, `ContentShare`). IDs above `PluginChannelStart` allow add-on packages to register custom payload handlers.
* **Three-Phase Compute Pipeline**:
  1. *Phase 1 (Main Thread)*: Object validation, cache lookup, lightweight pre-compute.
  2. *Phase 2 (Background Worker)*: Per-receiver audio decompression, packet decoding, Hermite/Slerp interpolation (`MaxDegreeOfParallelism = ProcessorCount - 2`).
  3. *Phase 3 (Main Thread)*: Transform/audio sink application and profiler metric aggregation.

---

## 5. Physics Authority, Interaction & Locomotion

BasisVR solves the most common physics artifacts in networked VR (`com.basis.framework/Interactions`):

### A. Hand Bone Welding (`WeldToHand`)
* **The Problem**: If an interactable object is parented to the raw XR controller tracking target, discrepancies between the controller pose and the IK-solved avatar hand cause the object to visibly float or disconnect from the avatar's fingers.
* **The Solution**: BasisVR anchors held objects to the **final IK-solved hand bone** transform (`VRMHumanBoneName.RightHand`), ensuring visual coherence in both 1st-person and 3rd-person mirrors.

### B. Authored Grip Points vs. Dynamic Snapping
* Objects can supply explicit `GripPoint` coordinate frames (e.g. tool handles, weapon grips, mugs).
* For objects without authored grip points, the grab system seats the closest collider contact surface without snapping the orientation.

### C. Throw Velocity Sampling Buffer
* Tracks a sliding-window circular buffer of linear and angular velocities across previous frames.
* Applies a smoothed release trajectory with velocity gating (`minLinearVelocity`), preventing single-frame tracking glitches from ruining throws.

### D. Ownership Transfer & Hand Stealing
* **Self-Stealing**: Allows a player to grab an object from their left hand into their right hand seamlessly without dropping it or triggering state desync.
* **Peer Authority Handoff**: Clean asynchronous ownership negotiations (`TakeOwnershipAsync`, `RemoveOwnershipAsync`, `RequestCurrentOwnershipAsync`) backed by local fast-path validation (`IsOwnerLocalValidation`).

### E. Desktop Interaction Parity ("Zoop")
* Desktop players can manipulate held objects:
  - **"Zoop"**: Mouse wheel adjusts the hold distance along the view ray.
  - **Inspection / Orientation**: Right-click drag rotates the held object in place.
  - **Action**: Left-click fires primary use actions.

### F. Networked Seating (`BasisSeat.cs`, `BasisSeatFit.cs`)
* Handles player seating with automatic avatar scale compensation, smooth entry/exit camera transitions, and locomotion input locking while seated.

---

## 6. Spatial Audio, Voice & Acoustics

BasisVR incorporates a production-grade audio pipeline:
* **Binaural HRTF & 3D Spatialization**: Integrates Steam Audio and SOFA datasets with bilinear interpolation across elevation and azimuth for realistic above/below sound localization.
* **RNNoise Neural Suppression**: Integrates real-time neural noise reduction on incoming microphone streams prior to Opus encoding, stripping fan noise and keyboard clicks.
* **Mic Processing Suite**: Integrated Automatic Gain Control (AGC), noise gate, Voice Activity Detection (VAD), and input limiting.
* **Talk Modes & Distance Attenuation**:
  - `Proximity`: Standard distance-attenuated 3D spatial voice.
  - `Whisper`: Tight radius.
  - `Admin Shout`: Global non-spatialized broadcast channel.
  - `P2P Direct / Private Group`: Direct audio channels.
* **AudioLink Integration**: World materials and avatar shaders react to live spatial voice and music audio frequency bands.

---

## 7. Security, Performance & Avatar Sandboxing

To prevent client crashes from malicious or unoptimized user-generated avatars, BasisVR enforces a **3-Stage Defense Pipeline** (`BasisAvatarPerformanceLimits.cs`):

```
User Avatar Loading
        │
        ▼
[ Stage 1: Metadata Pre-Evaluation ]  ── Violates Limits ──► Reject / Abort Download
        │ (Polycount, VRAM, Bone count)
        ▼ Passes
[ Stage 2: Physics Rig Hook ]         ── Excess Springs  ──► Cap / Destroy Extra Springs
        │ (Dynamic bones, colliders)
        ▼
[ Stage 3: Component Stripping ]       ── Dangerous Comps ──► Strip Lights, Particles, Audio
        │ (Post-instantiation cleanup)
        ▼
Render Safe Avatar
```

| Stage | Name | Timing | Action |
|---|---|---|---|
| **Stage 1** | **Metadata Pre-Evaluation** | Pre-download / Pre-instantiation | Reads GLTF/BEE header metadata (triangle count, texture VRAM, material slots, bone count, bounding box). Rejects assets exceeding configured safety thresholds. |
| **Stage 2** | **Physics Rig Hook** | Avatar initialization | Caps or strips excess spring bones / jiggle physics components to protect the CPU frame budget. |
| **Stage 3** | **Component Stripping** | Post-instantiation | Strips runaway particle emitters, real-time light sources, audio sources, line renderers, and excess colliders. |

---

## 8. Moderation, Identity & Global Permissions

### A. Cryptographic & UUID Identity (`BasisDID`)
* Players are identified by persistent UUIDs rather than transient connection IDs, enabling persistent bans, role assignments, and cross-session identity.
* P2P data channels utilize **ChaCha20-Poly1305** encryption.

### B. Hierarchical Permissions & Global Lockout Flags
* Hierarchical permission groups with inheritance and individual permission node overrides.
* Server can broadcast instant global lock flags across 12 distinct capabilities:
  1. `Avatar Lock`
  2. `Prop Lock`
  3. `World Lock`
  4. `Third-Person Camera Lock`
  5. `Text Chat Lock`
  6. `Voice Chat Lock`
  7. `Media Player Lock`
  8. `Camera Capture Lock`
  9. `Prop Grabbing Lock`
  10. `P2P Direct Lock`
  11. `Scripting (Cilbox) Lock`
  12. `Image Sharing Lock`

---

## 9. Content Management (BEE Bundles & NDMF)

* **BEE Archive Format**: Encapsulates multi-platform asset bundles in a single container with optional encryption, range-request streaming, and LZ4 compression.
* **NDMF Pipeline Hook**: Non-Destructive Modular Framework avatar build pipeline with automated viseme, eye-tracking, and blendshape re-mapping for VRChat-compatible avatar rigs.

---

## 10. Synchronized Media Player

BasisVR’s media subsystem (`com.basis.mediaplayer`):
* **Networked Playback Sync**: Server-authoritative timeline synchronization with client-side drift correction and smooth volume curves.
* **`yt-dlp` Streaming Backend**: Dynamically resolves online video streams, multi-format switching, and live streams.
* **Live Caption Overlay (`BasisMediaCaptionOverlay.cs`)**: Synchronized subtitle and caption cue rendering across remote peers.

---

## 11. Cross-Cutting Architecture & Memory Management

* **Zero-Allocation Burst Jobs**: Transform interpolation, bone compression, and remote player updates utilize `NativeArray<T>`, flat structs, and `ArrayPool<T>` recycling to eliminate GC spikes during gameplay.
* **Reader & Buffer Recycling**: All network packet readers (`NetDataReader`) are pooled and recycled after execution.
* **Built-in Performance Profiler**: Real-time profiler with 20+ frame telemetry counters (`LocalAvatarSync`, `OutboundAvatarServer`, `PlayerAvatar`, `ContentShare`, `ShoutVoice`, `ServerSideSyncPlayer`).

---

## 12. Actionable Recommendations & NexusVR Implementation Plan

Here is the direct implementation strategy for translating BasisVR’s proven patterns into NexusVR's TypeScript / Three.js / WebXR architecture:

| BasisVR Subsystem | NexusVR WebXR Equivalent | Target Module | Implementation Details |
|---|---|---|---|
| **`BasisEerieMovement` IK & Curves** | VRM IK & Spine Solver | `src/engine/ik/` | Implement anatomical cervical lordosis curves, hip hinge crouch counterbalance, and One-Euro jitter filters on Three.js VRM rigs. |
| **`WeldToHand` Grip Anchor** | Hand-Bone Attachment | `src/engine/interaction/` | Anchor held interactable objects directly to the resolved VRM hand bone (`VRMHumanBoneName.RightHand`) rather than the raw WebXR controller ray. |
| **Throw Velocity Buffer** | Physics Release Sampler | `src/engine/physics/` | Implement a circular velocity history buffer with threshold gating for natural VR/Desktop throwing physics. |
| **Desktop "Zoop" & Inspect** | Desktop Interaction Controls | `src/engine/controls/` | Add mouse wheel depth scrolling ("zoop") and right-click rotation for desktop prop manipulation. |
| **Smallest-Three Bone Compression** | Bit-Packed Avatar Packets | `src/services/network/` | Implement smallest-three quaternion encoding and delta compression over PeerJS WebRTC DataChannels to cut avatar bandwidth by 25-50%. |
| **3-Stage Avatar Defense** | VRM / GLTF Validator & Sanitizer | `src/services/avatar/` | Parse GLTF/VRM JSON chunks pre-render to enforce triangle, texture resolution, spring bone, and light limits before scene insertion. |
| **RNNoise Microphone Worklet** | AudioWorklet Processor | `src/services/audio/` | Implement an RNNoise WASM `AudioWorkletNode` in the Web Audio graph to suppress background noise before WebRTC transmission. |
| **Channel-Based Protocol** | Typed Channel Dispatcher | `src/services/network/` | Replace unstructured JSON envelopes with indexed binary channel handlers and object pooling to eliminate JavaScript garbage collection overhead. |
| **Global Permission & Lock Flags** | Room Capability Flags | `src/services/room/` | Add hierarchical room permission nodes and server-broadcasted capability lock flags (voice, props, avatars). |

---

## 13. Appendix: Key Source Files Reference

| File Path in BasisVR | Core Responsibility |
|---|---|
| `BasisNetworkManagement.cs` | Centralized network manager (static lifecycle, tick loops, time sync) |
| `BasisNetworkConnection.cs` | Session management, transport abstractions, send helpers |
| `BasisNetworkEvents.cs` | Channel-based message registry and dispatch |
| `BasisEerieMovement.cs` | 22-slot flat skeletal IK solver, Burst-compiled math |
| `BasisConstellationClassifier.cs` | Multi-tracker hardware classification (3-point to 11-point FBT) |
| `BasisNetworkAvatarCompressor.cs`| Rig-neutral generic bone rotation encoding & smallest-three packing |
| `BasisAvatarBitPacking.cs` | Bit-budget allocations across quality tiers (High down to VeryLow) |
| `BasisPickupInteractable.cs` | Hand bone welding (`WeldToHand`), grip points, throw velocity buffer |
| `BasisSeat.cs` / `BasisSeatFit.cs` | Networked avatar seating, scale compensation, and locomotion locking |
| `BasisNetworkOwnership.cs` | Asynchronous object authority negotiation & hand-stealing |
| `BasisSyncInterpolationJobs.cs` | Burst-compiled transform interpolation and dead reckoning |
| `BasisAvatarPerformanceLimits.cs`| 3-Stage avatar sandboxing (metadata check, rig hook, component stripper) |
| `BasisNetworkModeration.cs` | Moderation actions, UUID identity (`BasisDID`), and global lock flags |
| `BasisNetworkProfiler.cs` | Frame performance telemetry across 20+ network categories |
| `BasisMediaCaptionOverlay.cs` | Networked video stream synchronization and subtitle cue rendering |
| `BasisTalkModeManager.cs` | Multi-mode spatial voice routing (proximity, whisper, admin shout, P2P) |

---

*This document consolidates and supersedes previous individual BasisVR analysis notes.*
