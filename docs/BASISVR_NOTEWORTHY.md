# BasisVR Architecture & Noteworthy Systems Analysis

This document provides a deep architectural and technical analysis of the **BasisVR** framework, highlighting key concepts, implementations, and actionable takeaways for **NexusVR** (WebXR / Three.js / WebRTC).

---

## 1. Executive Summary

BasisVR is an open-source, high-concurrency Social VR framework designed around three core pillars:
1. **Embodiment**: A tight, continuous loop between player movement, tracking data, and avatar skeletal representation.
2. **Spatialization**: Physicalized space with realistic spatial audio (HRTF/SOFA), direct touch, and physics interactions.
3. **Presence**: Low-latency networking, smooth interpolation, and robust avatar/world synchronization without vendor lock-in.

Even though BasisVR is written in **Unity / C#** (targeting URP and Burst-compiled IL2CPP) and NexusVR is built with **TypeScript / Three.js / WebXR**, the algorithmic patterns in BasisVR are directly applicable and adaptable to our WebXR stack.

---

## 2. Avatar IK & Embodiment (`com.basis.eeriemovement` & `Avatar`)

BasisVR has one of the most advanced open-source IK solvers and calibration pipelines in the social VR ecosystem.

### A. The 22-Slot Skeletal Model (`BasisEerieMovement.cs`)
* **Slot-based Architecture**: Instead of traversing dynamic hierarchy trees every frame, the solver maps the skeleton to 22 fixed slots (`Hips`, `Spine`, `Chest`, `UpperChest`, `Neck`, `Head`, shoulders, arms, forearms, hands, upper legs, lower legs, feet, toes, and twist bones).
* **Burst-Compiled Job Solver**: Operates on flat memory structures (`FixedList512Bytes<Vector3>`, `FixedList512Bytes<Quaternion>`) to eliminate GC allocations and maximize cache locality.

### B. Anatomical Realism & Secondary Curves
* **Cervical Lordosis & Spine Bending**: Calculates natural lordosis curve gains and neck gaze follow rather than simply stretching a straight CCD/FABRIK chain.
* **Hip Hinge & Trunk Counterbalance**: When crouching or leaning forward, the hips shift back proportionally (`hipHingeStartDeg`, `trunkCounterbalance`, `crouchDepth`) to keep the avatar grounded and prevent knees from awkwardly protruding.
* **Shoulder Shrug & Slide**: Clavicle bones automatically elevate and slide (`shoulderElevationFactor`, `shoulderProtractionFactor`) as arms reach upward.
* **Twist Bone Distribution**: Forearm and thigh rotations are fractionally distributed across twist bones (`lowerArmTwistFraction`, `upperArmTwistFraction`) to eliminate mesh pinching at wrist and shoulder joints.

### C. Jitter Reduction & Noise Filtering
* **One-Euro / Adaptive Filtering**: Uses adaptive cutoff frequencies (`trackedKneeSwivelMinCutoffHz`, `trackedKneeSwivelBeta`) on leg swivel and elbow hints. Fast movements react immediately with zero lag, while idle/slow movements filter out tracking jitter.

### D. Multi-Tracker Constellation (`BasisConstellationClassifier.cs`)
* Automatically detects and classifies connected trackers (from basic 3-point HMD+Hands to 6-point, 8-point, or 11-point full-body tracking including SlimeVR and Meta Body Tracking).

---

## 3. Interaction & Physics Authority (`com.basis.framework/Interactions`)

BasisVR’s interaction system (`BasisPickupInteractable.cs`, `BasisPlayerInteract.cs`, `BasisDirectTouch.cs`) addresses the common edge cases in multiplayer VR physics:

### A. Hand Bone Welding vs. Raw Controller Tracking
* **The Problem**: If a held prop follows the raw controller position, any IK difference between the player's controller and the rendered avatar hand makes the object float or slide out of the avatar’s grip.
* **The BasisVR Solution (`WeldToHand`)**: Held objects follow the **final IK-solved hand bone** rather than the raw XR input target, ensuring objects look perfectly anchored to the avatar from both 1st-person and 3rd-person perspectives.

### B. Authored Grip Points vs. Dynamic Snapping
* Objects can specify an authored `GripPoint` transform (e.g. gun grip, sword handle, mug handle).
* When no grip point exists, it falls back to seating the closest collider contact surface without snapping the orientation.

### C. Throw Velocity Sampling Buffer
* Tracks a sliding window of linear and angular velocities before release.
* Filters out frame-drop spikes and applies smoothed release momentum (`minLinearVelocity` gating) for intuitive throwing physics.

### D. Ownership Transfer & Hand Stealing
* Explicit support for:
  - **Self-Stealing**: Swapping an object smoothly from left hand to right hand without dropping it.
  - **Peer Authority Handoff**: Clean network handoff when a peer grabs an object held or owned by another player.

### E. Desktop Interaction Parity ("Zoop")
* Desktop players can manipulate held objects using the mouse wheel to adjust hold distance (**"Zoop"**), right-click drag to inspect/rotate, and left-click to use.

### F. Networked Seating System (`BasisSeat.cs`, `BasisSeatFit.cs`)
* Handles player seating with custom avatar scale fitting, entry/exit transitions, and locking player locomotion while seated.

---

## 4. Network Replication & Protocol (`BasisNetworkCore`)

The networking subsystem in BasisVR is split into `BasisNetworkCore`, `BasisNetworkClient`, and `BasisNetworkServer`.

### A. Packet Serialization & Quantization
* **Bit-Packing & Half-Precision**: Avatar bone rotations and blendshapes are quantized into compressed byte streams rather than raw 32-bit floats.
* **Delta Sync**: Unchanged bones or zero-velocity transforms are omitted from high-frequency packets.

### B. Dual Channel Strategy (High-Frequency vs. State)
* **Unreliable / Low Latency (UDP / WebRTC DataChannel)**:
  - Avatar transforms & bone poses
  - Voice audio frames
  - Object velocity & physics state
* **Reliable / Ordered (TCP / WebRTC Reliable DataChannel)**:
  - Avatar load/switch events (`ClientAvatarChangeMessage`)
  - Permission requests & room state
  - Chat and player metadata
  - Synchronized media player state

### C. Client-Side Smoothing & Dead Reckoning
* Maintains a small adaptive jitter buffer for remote players, using cubic Hermite or spherical linear interpolation (Slerp) to smooth network fluctuations without introducing noticeable latency.

---

## 5. Security, Performance & Avatar Sandboxing (`BasisAvatarPerformanceLimits.cs`)

One of the biggest hazards in open Social VR is malicious or unoptimized user-generated content (huge polygon counts, thousands of draw calls, runaway particle systems, crashes).

BasisVR implements a **3-Stage Defense Pipeline**:

| Stage | Name | When it Runs | What it Does |
|---|---|---|---|
| **Stage 1** | **Metadata Pre-Evaluation** | *Before asset download/instantiation* | Inspects header metadata (poly count, texture VRAM, material slots, bone count, bounding box size). Rejects or skips downloading avatars that violate client safety limits. |
| **Stage 2** | **Physics Rig Hook** | *During avatar initialization* | Destroys or caps excess jiggle physics / spring bones so CPU physics budgets cannot be overwhelmed. |
| **Stage 3** | **Component Stripping / Trimming** | *Post-instantiation* | Strips excess lights, particle systems, audio sources, line/trail renderers, and excessive colliders, allowing the avatar visual to render safely without crashing the client. |

---

## 6. Spatial Audio & Acoustics (`HRTF.md`, `com.steam.steamaudio`, `com.xiph.rnnoise`)

* **Binaural HRTF Profiles**: Incorporates Steam Audio / SOFA datasets with bilinear interpolation across elevation and azimuth for precise 3D spatialization (above/below head localization).
* **RNNoise Suppression**: Integrates neural noise reduction (`RNNoise`) directly on input audio to remove background mic noise before Opus encoding.
* **AudioLink Integration**: World environments and avatar materials react to live spatial voice or music channels using standard AudioLink frequency bands.

---

## 7. Synchronized Media Player (`com.basis.mediaplayer`)

* **Networked Video Sync**: Implements server/peer synchronized timestamps, play/pause drift correction, and volume curves.
* **Media URL Resolution**: Uses `yt-dlp` backend integration to dynamically resolve streaming URLs and format switching.
* **Subtitle / Caption Cue Support**: Live caption overlay support (`BasisMediaCaptionOverlay.cs`) with timed cue rendering.

---

## 8. Actionable Opportunities for NexusVR

Here is how we can translate these architectural strengths into NexusVR's TypeScript / Three.js / WebXR architecture:

| BasisVR System | NexusVR WebXR Equivalent | Implementation Strategy |
|---|---|---|
| **`BasisEerieMovement` IK Solver** | `@pixiv/three-vrm` IK & Spine Solver | Adapt the lordosis spine curves, hip hinge crouch compensation, and One-Euro filtering for our Three.js VRM rigs. |
| **`WeldToHand` Grip System** | `src/engine/interaction/` | Update held object attachment to weld to the VRM's final resolved hand bone (`VRMHumanBoneName.RightHand`) rather than the raw WebXR controller ray. |
| **Throw Velocity Buffer** | `src/engine/physics/` | Implement the sliding-window velocity tracker in Three.js for natural object throwing in VR and desktop. |
| **Desktop "Zoop" & Rotate** | `src/engine/controls/` | Add mouse wheel depth adjustment ("zoop") and right-click rotation for desktop interaction mode. |
| **3-Stage Avatar Filter** | `src/services/avatar/` | Parse GLTF/VRM buffers pre-render to enforce triangle, texture resolution, spring bone, and light limits before adding to the Three.js scene. |
| **Bit-Packed Quantization** | `src/services/network/` | Quantize VRM bone Euler/Quaternion rotations into compressed `Uint8Array` / `Int16Array` packets for our WebRTC PeerJS channels. |
| **RNNoise Audio Worklet** | Web Audio API / AudioWorklet | Implement an RNNoise WASM audio worklet to clean mic input before WebRTC streaming. |

---

## 9. Conclusion

BasisVR is a treasure trove of production-tested VR math, state machines, and networking patterns. Having it locally in the project gives us direct access to refer to its algorithms and replicate the best VR design patterns directly in NexusVR.
