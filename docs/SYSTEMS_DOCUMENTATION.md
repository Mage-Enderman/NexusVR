# NexusVR — Complete Systems Documentation

> **Purpose:** This document explains how every system in NexusVR works, what each is *trying* to do, and where the current implementation has known gaps or quirks. It's written so you can read a section and then tell me "fix X" or "improve Y" with full context.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [SceneEngine — The 3D Viewport](#2-sceneengine--the-3d-viewport)
3. [Camera Modes & Locomotion](#3-camera-modes--locomotion)
4. [AssetManager — Import & Spawn Pipeline](#4-assetmanager--import--spawn-pipeline)
5. [ManipulationManager — Gizmos, Grab, VR Hands](#5-manipulationmanager--gizmos-grab-vr-hands)
6. [Networking — PeerJS P2P Multiplayer](#6-networking--peerjs-p2p-multiplayer)
7. [VideoStreamingService — Large Video Transfer](#7-videosreamingservice--large-video-transfer)
8. [AvatarManager — Peer Avatars & Voice](#8-avatarmanager--peer-avatars--voice)
9. [VR System — Input, HUD, Spatial Panels](#9-vr-system--input-hud-spatial-panels)
10. [EnvironmentManager — Atmosphere, Grid, Lighting](#10-environmentmanager--atmosphere-grid-lighting)
11. [InventoryService — IndexedDB Persistence](#11-inventoryservice--indexeddb-persistence)
12. [SceneSerializationService — Save/Load Rooms](#12-sceneserializationservice--saveload-rooms)
13. [UndoRedoManager](#13-undoredomanager)
14. [Permissions & Roles](#14-permissions--roles)
15. [RawFilesStore — Lazy-Share Byte Storage](#15-rawfilesstore--lazy-share-byte-storage)
16. [UI Components](#16-ui-components)
17. [Supporting Systems](#17-supporting-systems)

---

## 1. Architecture Overview

### Tech Stack
- **React 19** + **TypeScript 6** + **Vite 8** for the UI shell
- **Three.js 0.185** for all 3D rendering (WebGL + WebXR)
- **PeerJS** (wrapping WebRTC) for peer-to-peer multiplayer — no central game server
- **IndexedDB** (via `idb` library) for persistent local storage (inventory, raw files, scenes)
- **@pixiv/three-vrm** for VRM avatar loading
- **@sparkjsdev/spark** for Gaussian Splatting rendering
- **MP4Box.js** for MP4 container demuxing in the video streaming pipeline
- **@needle-tools/gltf-progressive** for opt-in progressive LOD on GLTF models

### Project Layout

```
src/
├── engine/              # Non-React singletons — the "core" of the app
│   ├── SceneEngine.ts          # Viewport, renderer, camera, locomotion, WebXR lifecycle
│   ├── AssetManager.ts         # File/URL import → Three.js objects in the scene
│   ├── ManipulationManager.ts  # Transform gizmos, RMB-grab, VR grip, two-handed scale
│   ├── AvatarManager.ts        # Peer avatar rendering + positional voice audio
│   ├── EnvironmentManager.ts   # Atmosphere presets, grid, lighting
│   ├── VRHUDManager.ts         # VR curved dash menu + 3D system panels
│   ├── VRInputManager.ts       # Quest controller button polling + edge detection
│   ├── SpatialPanelManager.ts  # CSS3DRenderer (desktop) / HTMLMesh (VR) for world-space UI
│   ├── ContextMenuManager.ts   # Single-source-of-truth for radial menu items (VR + Desktop)
│   ├── ResoniteLightSync.ts    # Resonite-style light component config → Three.js lights
│   ├── BrushManager.ts         # In-world 3D painting brush
│   ├── ThumbnailGenerator.ts   # Asset thumbnail snapshots
│   └── VRRadialMenuMesh.ts     # 3D radial context menu mesh for VR
│
├── components/          # React UI (DOM overlays for desktop, portals for spatial panels)
│   ├── Navbar.tsx, Toolbar.tsx, DashMenu.tsx
│   ├── SettingsModal.tsx, ShareModal.tsx, ChatPanel.tsx
│   ├── InventoryModal.tsx, FileImportModal.tsx, AssetImportDialog.tsx
│   ├── SceneInspectorWindow.tsx, SpatialPopUpWrapper.tsx
│   ├── RadialContextMenu.tsx   # Desktop radial context menu (React DOM overlay)
│   ├── WorldEnvironmentModal.tsx, WorldToolsPanel.tsx
│   ├── VideoControls.tsx, VideoObjectControls.tsx
│   └── MiscFileModal.tsx (legacy, now unused)
│
├── services/            # Data services (no Three.js dependency)
│   ├── NetworkService.ts       # PeerJS rooms, envelope protocol, sync, chat
│   ├── InventoryService.ts     # IndexedDB CRUD for inventory items
│   ├── UndoRedoManager.ts      # Generic undo/redo stack
│   ├── VideoStreamingService.ts # Binary P2P video chunk streaming + local MSE pipeline
│   ├── RawFilesStore.ts        # IndexedDB for "import as raw file" byte storage
│   └── SceneSerializationService.ts  # Save/load entire scenes to IndexedDB
│
├── types/
│   └── permissions.ts  # UserRole, ROLE_PERMISSIONS, moderation payloads
│
├── utils/
│   ├── deviceTier.ts          # Device classification + canvas resolution caps
│   └── findObjectByUUID.ts    # UUID → Object3D lookup utility
│
├── handlers/
│   └── createPanelActionHandler.ts  # VR panel action dispatch → React state bridge
│
├── hooks/
│   └── useRawMode.ts          # React hook for raw-mode file import toggle
│
├── App.tsx              # Root component — wires engine singletons to React state
└── main.tsx             # React DOM entry point
```

### Data Flow Pattern

The app follows a **"dumb React, smart singletons"** pattern:

1. **Engine singletons** (`SceneEngine`, `AssetManager`, `ManipulationManager`, etc.) own the Three.js scene graph and mutate it directly. They expose callback registration APIs (e.g. `registerUpdateCallback`, `onTransformChange`, `onAssetAdded`).

2. **App.tsx** creates the engine singletons, subscribes to their callbacks, and mirrors relevant state into React state variables. React renders the UI (toolbar, modals, panels) using those state variables.

3. **User interactions** in the React UI call methods on the engine singletons (e.g. `assetManager.importFile()`, `networkService.sendMessage()`).

4. **Network broadcasts** flow from engine → `NetworkService.sendEnvelope()` → PeerJS DataConnection → remote peer's `NetworkService` → remote peer's `App.tsx` callback → remote peer's engine.

This means: **React never directly touches the scene graph**. The singletons do all Three.js work. React is the UI layer on top.

### Key Architectural Decision: worldRoot

Every spawned asset, peer avatar, floor, grid, and light is parented to `worldRoot` (a `THREE.Group` child of `scene`), NOT directly to `scene`. This is essential for VR locomotion:

- In VR, Three.js writes the HMD pose directly to `camera.matrixWorld`, bypassing any scene-graph parenting. You can't move the camera by writing `camera.position` — it gets overwritten every frame.
- The solution is the **inverse-treadmill pattern**: instead of moving the camera forward, move `worldRoot` *backward*. The user perceives forward motion, but the camera stays HMD-tracked.
- Desktop mode leaves `worldRoot` at identity, so it's invisible there.

---

## 2. SceneEngine — The 3D Viewport

**File:** `src/engine/SceneEngine.ts` (~1148 lines)

### What It Does
SceneEngine is the central rendering engine. It creates and owns:
- The WebGL renderer (`THREE.WebGLRenderer`)
- The scene (`THREE.Scene`)
- The main camera (`THREE.PerspectiveCamera`)
- OrbitControls for desktop orbit mode
- `worldRoot` group (parent of all world objects)
- `cameraRig` group (parent of camera, used in VR)
- Lighting (ambient + directional + accent purple light)
- Floor mesh + neon grid
- Spark Gaussian Splatting renderer
- SpatialPanelManager for world-space HTML panels
- WebXR controllers, grips, hand tracking, laser rays
- VRInputManager for controller polling

### The Render Loop (`animate`)

Each frame:
1. Calculate delta time
2. FPS counter (updated every 1 second)
3. If VR: poll gamepad, run VR locomotion + smooth-turn + VR gravity
4. If desktop orbit: update OrbitControls
5. If desktop first-person: process WASD movement + gravity
6. Fire all registered `updateCallbacks` (ManipulationManager, AvatarManager, etc.)
7. Call `renderer.render(scene, camera)`
8. Fire `postRenderCallbacks` (audio listener sync)
9. Render `spatialPanelManager` (CSS3D overlay on desktop, HTMLMesh sync in VR)
10. If pointer-locked: update crosshair hover detection on spatial panels

### Graphics Settings

`GraphicsSettings` controls resolution scale, shadow quality (off/low/medium/high/ultra), anti-aliasing (none/FXAA/MSAA), progressive LOD toggle + density, Gaussian Splat LOD settings (enable, scale, max count), and a user-touched flag that prevents the VR entry default from overriding explicit user choices.

`updateSettings()` applies changes live and notifies React listeners via `onSettingsChange`.

### Known Quirks / Things to Watch
- The camera starts at `(0, 1.6, 3)` — eye height, 3m back from origin
- Shadow map frustum is hardcoded to ±15 units — large worlds may lose shadows
- Tone mapping is ACES Filmic at exposure 1.2 — can wash out dark scenes
- The `SpatialPanelManager` CSS3DRenderer overlay sits at `z-index: 10` above the WebGL canvas

---

## 3. Camera Modes & Locomotion

### Two Camera Modes

**First-Person (default):**
- Pointer lock on canvas click → mouse controls look direction
- WASD/Arrow keys for movement
- Euler-based rotation with pitch clamped to ±~89°
- Gravity simulation: `verticalVelocity -= 18.0 * delta` per frame
- Jump impulse: `verticalVelocity = 6.5` on Space
- Floor collision at y=1.6 (eye height)

**Orbit:**
- Mouse-drag to orbit around a focal point
- Space = up, C = down (vertical panning)
- OrbitControls with damping, max polar angle ~90°

**Toggle:** Press `V` key. The `setCameraMode` method saves/restores euler angles and adjusts OrbitControls enabled state.

### Three Locomotion Modes

**Walk (default):**
- WASD moves on the XZ plane (yaw-only, forward stays parallel to floor)
- Jump + gravity (desktop); VR uses A-button jump + same gravity on `worldRoot`
- Auto-climb when head hits geometry (mentioned in features but implementation varies)

**Flight:**
- WASD + Space (up) / C (down)
- Moves along camera direction (pitch included)
- Floor clamp at y=0.8

**Noclip:**
- Same as flight but no collision at all
- 3× base speed (very fast)

**Slow Movement:** Toggle with `Z` key. Multiplies speed by 0.3×. Persists across mode switches.

### VR Locomotion

- **Left thumbstick:** Walk/flight direction (yaw-relative, same speed scaling as desktop)
- **Right thumbstick X:** Smooth turn (~90°/s) rotating `worldRoot` around the user's HMD position
- **A button:** Jump (walk mode only)
- VR movement writes to `worldRoot.position` (inverse-treadmill), never to `camera.position`
- Smooth turn rotates `worldRoot` around the camera's current world position (not the origin), so turning in place feels natural

### Known Issues / Things to Watch
- VR gravity is duplicated in the `animate()` loop (separate from desktop's `updateFirstPersonMovement`)
- Walk-mode auto-climb behavior may not be fully wired
- The `slowMovement` toggle affects both desktop and VR (shares the same flag)
- No head-bob or breathing animation yet

---

## 4. AssetManager — Import & Spawn Pipeline

**File:** `src/engine/AssetManager.ts` (~large)

### What It Does
AssetManager is the import pipeline. Given a `File`, URL string, or primitive type, it produces a `THREE.Object3D` added to `worldRoot` and wrapped in a `LoadedAsset` record.

### Supported Formats

| Category | Formats | Display Modes |
|----------|---------|---------------|
| 3D Models | `.glb`, `.gltf` (Draco + meshopt), `.obj`, `.fbx`, `.vrm` | Placed in scene at import position |
| Images | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | 5 modes: 2D plane, billboard sprite, 3D framed panel, 360° panorama sphere, skybox background |
| Video | `.mp4`, `.webm`, `.mov` | 3 aspect ratios (16:9, 9:16, 1:1), autoplay + loop |
| Splats | `.ply`, `.ksplat`, `.sog`, `.sogs`, `.spz`, `.rad` | Gaussian Splat via Spark renderer |
| Misc | Any other extension | Flat 2D plane with canvas-textured document icon |
| Primitives | cube, sphere, cylinder, cone, torus, plane | Random neon color on spawn |

### Import Config

When importing, users can choose:
- **Scale mode:** auto (use file's unit system), meters, centimeters, inches, custom
- **Placement:** origin (0,0,0) or floor (y=0 with auto-scaling)
- **Shading:** smooth or flat normals
- **Texture filtering:** smooth or pixel-art (nearest-neighbor)

### The Import Flow

1. `importFile(file, config, customId?)` or `importFromUrl(url, config, customId?)` is called
2. A dedup check (`inProgressImports` Map) prevents duplicate imports of the same id
3. File type is detected from extension/MIME
4. Format-specific loader is used (GLTFLoader, OBJLoader, FBXLoader, etc.)
5. For GLB/GLTF: Draco + meshopt decoders are pre-configured; progressive LOD plugin is optionally registered
6. The loaded `THREE.Object3D` is processed: scaling, shading mode, texture filtering
7. A `LoadedAsset` record is created and stored in the `assets` Map
8. The object is added to `worldRoot`
9. `onAssetAdded` callbacks fire (which triggers `NetworkService.broadcastSpawn()` in App.tsx)

### Loading Placeholders

When a peer requests an asset import (via network), the host broadcasts a `PendingSpawnData` envelope *before* the async load resolves. Other peers render a pulsing cyan mesh placeholder labeled "Loading / <name> / by <user>". When the real asset arrives, the placeholder is replaced via id-match.

### Oversized File Protection

`MAX_INLINED_FILE_BYTES = 15 MB` — files above this size have their `fileData` stripped from the network broadcast envelope. The receiver gets a `fileDataOversized: true` flag and renders a static red "Too Large" indicator instead of attempting to import bytes that were never sent.

### Video-Specific Behavior

- **Small videos (<50 MB):** Loaded via blob URL, displayed as HTMLVideoElement + THREE.VideoTexture
- **Large videos (≥50 MB):** Route through `VideoStreamingService.attachLocalReceiver()` for MSE-based chunked playback (avoids multi-second blob URL pre-roll)
- **Very large videos (>15 MB for P2P):** Binary streamed via dedicated PeerJS DataChannel
- **Video state** is stored on `asset.object3d.userData.videoState` with fields for playing, currentTime, volume (global/local), muted, syncMode

### Context Menu Items

Each asset can carry custom `contextMenuItems` — misc files add a "Download" item, for example. These are merged into the radial context menu's "held" tab.

### Known Issues / Things to Watch
- The `RawFilesStore` dependency is optional — raw-mode imports silently no-op without it
- Progressive LOD plugin registration is one-shot (can't be unregistered once added)
- VRM avatars for the *local* user are experimental/not fully working yet
- Gaussian Splat paged formats (KSPLAT, RAD, SOG) get true LOD; raw PLY gets filename-auto-detect

---

## 5. ManipulationManager — Gizmos, Grab, VR Hands

**File:** `src/engine/ManipulationManager.ts` (~1445 lines)

### What It Does
Handles all object manipulation: TransformControls gizmos, right-mouse-button grab, VR controller grip grab, two-handed scale, and wheel/keyboard shortcuts.

### TransformControls Gizmo

Standard Three.js `TransformControls` attached to the selected asset:
- **W/G:** Translate mode
- **R/E:** Rotate mode
- **S:** Scale mode
- Local vs World space toggle (Tools bar button)
- Dragging disables OrbitControls temporarily; restores previous state on release

### Selection

Selection is done via the "dev tool" secondary action (key `R` or mouse buttons 3/4), NOT via RMB. Selection shows the gizmo and fires `onSelectionChange` callbacks. The selection state drives the SceneInspector panel.

**Key design decision:** RMB (grab) intentionally does NOT change selection state. Grab is a transient operation; selection is the long-lived "inspected" state.

### RMB-Grab (Desktop)

The grab system implements a **camera-anchored "gravity gun" pattern:**

1. On RMB-down, raycast from cursor into the scene against all assets
2. If hit: capture the camera-to-hit distance (`_grabDepth`) and the world-frame offset from asset origin to hit point (`_grabOffsetWorld`)
3. On each mousemove: rebuild the asset's world position from CURRENT camera position + camera basis vectors × depth + cursor NDC offset
4. Effect: Camera translation (WASD) moves the asset with you; camera rotation (mouse-look) orbits the asset at fixed radius; cursor position drives a screen-space offset

**Under pointer lock:** Cursor conceptually parks at screen center. Asset stays centered in view and orbits as the user head-turns — gravity-gun feel.

**Scroll wheel while grabbing:** Plain wheel = push/pull (adjust `_grabDepth`). Shift+wheel = scale the held asset. Ctrl+wheel = scale self (the user).

**Left-click while grabbing:** Snap-rotate to nearest 90° on all axes.

**Release:** On RMB-up anywhere (even outside the window). Also on window blur (alt-tab safety net).

### VR Controller Grab

- **Grip button** on either controller: `vrGrabWithController()` re-parents the asset to the controller's grip space via `gripSpace.attach(asset.object3d)`. Three.js parent transform propagation makes it follow the hand.
- **Thumbstick Y:** Dolly (push/pull along controller's pointing direction, 0.2m–5.0m range)
- **Thumbstick X:** Rotate the held asset around Y axis
- **Double-tap trigger (400ms):** Toggle rotation lock (whether asset follows controller rotation or stays world-aligned)
- **Release:** Grip release re-parents asset back to `worldRoot`

### Two-Handed Scale (VR)

When both triggers are pulled and both controllers point at the same asset:
1. Captures initial grip-to-grip distance and asset scale
2. Per-frame: `newScale = initialScale × (currentGripDistance / initialGripDistance)`
3. Uniform scale on all axes (0.02× to 50× range)
4. Origin-centered (grows from the asset's local origin)

Single-handed grip-grab is ended first if active on the same asset.

### VR Grab Transfer

`swapGrabbedAsset(newAsset)` transfers an active grab from one asset to another without release+re-grab. Used by duplicate-while-holding so the user ends up holding the new copy.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Y | Snap-rotate (90°) |
| E (hold) | During grab: rotate around pivot (Y-axis drag rotation) |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |

### Callbacks / Events

- `onTransformChange(assetId, position, rotation, scale, isCollidable)` — fires during any transform mutation
- `onSelectionChange(asset | null)` — fires on select/deselect
- `onScaleSelf(factor)` — fires on Ctrl+Wheel
- `onDragChange(isDragging)` — fires at drag start/end
- `onGrabBegin(asset, side?)` / `onGrabEnd(side?)` — fires specifically for grab operations

### Known Issues / Things to Watch
- E+drag rotate-around-pivot is suppressed on spatial popup meshes and primitives in cursor-follow mode
- The RMB debug logging (`RMB_DEBUG_ENABLED`) is currently `true` — lots of console output
- Snap-grid (radial menu "Snap Grid" slice) is a placeholder (no-op)
- The `onMouseDownWindow` handler for snap-rotate-while-grabbing bails if the radial menu is open — this prevents a click on "Destroy" from accidentally rotating the held object
- Two-handed scale is origin-centered, not midpoint-centered — off-origin meshes may feel unintuitive

---

## 5b. Grabbable Component — Object Grab Gate

**File:** `src/components/grabbable/GrabbableComponent.ts`

### What It Does
Resonite-style component that controls whether an object can be grabbed. An object MUST have an enabled Grabbable component to be grabbable — without it, the grab raycasts pass through.

### Fields
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch — false disables all grab interaction |
| `scalable` | boolean | `true` | Whether two-handed VR scale is allowed |
| `allowSteal` | boolean | `true` | Whether other users can grab-steal this object |
| `grabPriority` | int | `0` | Higher = grabbed first when overlapping |
| `editModeOnly` | boolean | `false` | Only grabbable in edit mode (future) |
| `destroyOnRelease` | boolean | `false` | Slot destroyed when dropped (future) |
| `reparentOnRelease` | boolean | `false` | Reparent to last parent vs root on drop (future) |
| `preserveUserSpace` | boolean | `false` | Preserve user-space parenting (future) |
| `dropOnDisable` | boolean | `false` | Drop when component disabled (future) |
| `allowedUsers` | string[] | `[]` | Per-user grab restriction (future) |

### How It Works
- Stored on `asset.object3d.userData.grabbable` as a `GrabbableComponent` object
- Backward-compatible with legacy `userData.grabbable` boolean (key `7` dev tool)
- `isGrabbable(obj)` — gate function called before any grab (RMB, VR grip, E+drag)
- `isScalable(obj)` — gate function for two-handed VR scale grab
- Inspector UI exposes all toggleable fields in a dedicated Grabbable section
- Serialized over network (spawn + scene snapshot) so peers see the same grab state

### Known Issues
- `editModeOnly`, `destroyOnRelease`, `reparentOnRelease`, `preserveUserSpace`, `dropOnDisable`, `allowedUsers` are defined but not yet wired to runtime behavior
- No visual indicator in-world showing which objects are/aren't grabbable

---

## 6. Networking — PeerJS P2P Multiplayer

**File:** `src/services/NetworkService.ts` (~large)

### Connection Model

- **PeerJS** wraps WebRTC DataConnections for reliable ordered messaging
- Each room has one **host** (the first peer to connect, or whoever "claims" the host id)
- Host vs Guest determination: 3-second "dial-host-or-claim" race. `connectToPeer(roomId + "-host")` — if it succeeds, you're a guest; if it fails, you become host
- **Host id:** Always `${roomId}-host` — deterministic, no signaling needed
- **Guest ids:** Random PeerJS-assigned ids
- **Pair mode:** Short alphanumeric code (e.g. `PAIR-7K2X`) instead of a full room name; resolves to a one-on-one session

### The Envelope Protocol

All messages use a single `DataConnection` per peer, tagged with a `channel` field:

| Channel | Purpose |
|---------|---------|
| `trans` | Transform broadcast (position/rotation/scale during grab/drag) |
| `av` | Avatar transform (head/hand position/rotation + speaking flag) |
| `spawn` | New asset added to the world |
| `rem` | Asset removed from the world |
| `chat` | Chat message |
| `syncreq` | Late-joiner requests full scene snapshot |
| `syncresp` | Host responds with complete asset list |
| `role` | Role assignment update |
| `mod` | Moderation action (kick, ban, silence, etc.) |
| `hs` | Host status / heartbeat |
| `peerlist` | Full peer list broadcast |
| `pending` | Host broadcasts before async import resolves (placeholder signal) |
| `pendingcancel` | Import failed, peers should dispose placeholder |
| `chunk` | Fragment of a large envelope exceeding 64KB |
| `vidstate` | Video playback state (play/pause/seek/volume) |
| `mat` | Material property update |
| `insp` | Inspector-driven component update |
| `panel` | Panel open/close state for peer mirroring |
| `lightsync` | Resonite-style light config broadcast |
| `p2pchunk` | Peer-to-peer binary file transfer chunk |

### Message Size Management

- JSON envelopes are fine for <64KB (transforms, chat, avatars)
- Asset spawns with binary `fileData` are base64-encoded inside JSON
- Messages exceeding ~64KB are split into `chunk` fragments by `sendEnvelopeTo()` and reassembled by `handleEnvelopeFrom()`
- Files above `MAX_INLINED_FILE_BYTES` (15 MB) are stripped from the envelope entirely (the `fileDataOversized` flag tells the receiver)

### Scene Sync (Late Joiners)

1. New peer connects and sends `syncreq`
2. Host responds with `syncresp` containing the full `SceneStateSnapshot` (all assets with positions, scales, materials, etc.)
3. The new peer's `onSyncResp` handler imports each asset via `AssetManager.importFile`/`importFromUrl`

### Transform Broadcasting

- Throttled to ~16Hz per peer during active drag/grab
- Uses `requestAnimationFrame` + minimum 60ms interval
- Only broadcasts when `isDragging` is true and the transform actually changed

### Host/Guest Cooldown

Recent fix to prevent spam loops:
- `BECOME_HOST_COOLDOWN_MS = 5000` — prevents rapid host-guest oscillation
- `SYSTEM_CHAT_DEDUPE_MS = 3000` — deduplicates system chat messages
- Both reset on `disconnect()`

### Chat System

- Messages carry `senderId`, `senderName`, `text`, `timestamp`
- System messages (`isSystem: true`) for join/leave/host-change notifications
- Unread badge counter in Navbar
- Chat panel with collapsible UI
- VR chat panel via VRHUDManager with alphabet grid for input

### Moderation

- Host can: kick, ban, silence/unsilence, respawn, change roles
- Role assignments broadcast to all peers
- Per-action capability checks via `ROLE_PERMISSIONS` from `types/permissions.ts`

### Known Issues / Things to Watch
- No fallback signaling server — relies entirely on PeerJS public broker
- The host/guest race is best-effort; with >2 peers joining simultaneously, edge cases can occur
- Binary file transfers for videos use a second DataConnection (`vid-stream` label) to avoid head-of-line blocking on the JSON channel
- `inspect` panel state broadcast means peers can see when someone opens the inspector, but interactivity is not shared
- `p2pchunk` is used for peer-to-peer binary file transfers (separate from the video streaming pipeline)

---

## 7. VideoStreamingService — Large Video Transfer

**File:** `src/services/VideoStreamingService.ts` (~500 lines)

### What It Does

Streams multi-gigabyte MP4/WebM videos peer-to-peer without loading the entire file into the JavaScript heap. The Quest browser crashes when trying to base64-encode a 200MB+ video as a single JSON payload, so this service uses a dedicated binary DataChannel.

### Host Side (Sender)

1. `registerHostFile(file, assetId, mimeHint)` — stores the File/Blob reference (no arrayBuffer!)
2. After broadcasting the spawn envelope, call `beginStreamingToPeer(hint, peerId)`
3. Opens a `vid-stream` DataConnection to the peer
4. Reads 64KB chunks from the file via `file.slice()` → `arrayBuffer()`
5. Sends each chunk with a fixed-size header: `[u8 kind][55B sessionId][u64 byteOffset]`
6. Handles backpressure (waits when `bufferedAmount > 256KB`)
7. Sends end-of-stream marker when complete

### Peer Side (Receiver)

1. `attachReceiver(hint, assetId)` — creates a `<video>` element
2. Registers a callback via `net.onBinaryChannelOpen()` to receive the host's binary channel
3. As chunks arrive, reassembles them into a Blob
4. When `bytesReceived >= fileSize`: creates a blob URL, sets it as the video source, fires `onAssetReady`
5. AssetManager wraps the video element in a THREE.VideoTexture

### Local MSE Pipeline

For large local MP4 imports (≥50 MB), `attachLocalReceiver(file, assetId)` runs the same MP4Box + MediaSource pipeline but reads from a local File instead of a DataChannel. This avoids the multi-second blob URL pre-roll on Quest.

### Live Stream Mode (Watch Party)

`startLiveStreamToPeer()` captures a real-time MediaStream from `HTMLVideoElement.captureStream(30)` and calls the peer via PeerJS's media connection. Peers receive frames immediately with zero file download.

### Known Issues / Things to Watch
- The receiver assembles ALL chunks into memory before creating the blob — very large files could still OOM on Quest
- The watchdog timer (30s) only covers the binary channel opening, not the full transfer
- WebM container demuxing is not supported in the MSE pipeline (falls back to blob URL)
- The live stream bitrate is capped at 8 Mbps

---

## 8. AvatarManager — Peer Avatars & Voice

**File:** `src/engine/AvatarManager.ts`

### Default Avatar

Each peer gets a stylized futuristic avatar:
- **Head:** Cyan box with glowing white visor
- **Hands:** Cylindrical grips with purple torus rings (Quest 2 style)
- **Speaking indicator:** Halo ring under the head that pulses when `isSpeaking`

When a peer sends a `vrmUrl`, the default avatar is replaced with a loaded VRM model.

### Transform Updates

`AvatarTransform` carries: `headPosition/Rotation`, `leftHand/RightHand position/Rotation`, `isSpeaking`, `vrmUrl`, `controllerType` (quest2/quest3).

Updates are interpolated via exponential smoothing: `alpha = 1 - exp(-22 * delta)`. First update is applied instantly (no lerp).

### Positional Audio

- Each peer avatar gets a `THREE.PositionalAudio` attached to the head mesh
- Audio source is a `MediaStreamSource` from the WebRTC audio track
- Configuration: refDistance=0.8, maxDistance=40, rolloffFactor=1.2, directional cone (180° inner, 230° outer)
- A hidden `<audio>` element keeps the WebRTC audio track alive
- AudioContext is resumed on first remote stream (browser autoplay policy)

### Local Avatar

`AvatarManager.getLocalTransform()` reads the camera + controller world poses and converts them to `worldRoot` local space (accounting for VR inverse-treadmill translations).

### Known Issues / Things to Watch
- VRM blendshapes (eye blink, mouth open) are NOT exposed — avatars are static
- Full-body IK sync is not implemented
- The `isCompanion` flag hides the avatar (for single-user testing)
- Avatar ring visibility toggles based on `controllerType` (Quest 3 hides the torus ring)

---

## 9. VR System — Input, HUD, Spatial Panels

### VRInputManager

**File:** `src/engine/VRInputManager.ts`

Polls `controller.gamepad` every frame and maintains:
- **Continuous values:** `stick` (Vector2), `trigger` (0-1), `grip` (0-1)
- **Edge detection:** `pressedThisFrame` and `releasedThisFrame` per button
- **Side-aware mapping:** Uses `XRInputSource.handedness` to resolve left/right, NOT the Three.js render index

Button mapping (Quest OpenXR):
| Index | Left Controller | Right Controller |
|-------|----------------|-----------------|
| 0 | Trigger | Trigger |
| 1 | Grip | Grip |
| 3 | Thumbstick Click | Thumbstick Click |
| 4 | **X** | **A** |
| 5 | **Y** | **B** |

Thumbstick axes: indices [2,3] on Quest (not [0,1] which is the touchpad). Deadzone: 0.15.

### VRHUDManager

**File:** `src/engine/VRHUDManager.ts` (~large)

The VR HUD is a **3D curved screen** rendered via canvas texture, positioned in front of the user:

**Dash Menu (main hub):**
- System cards (8): Session, Inventory, Settings, Splat, Environment, Share, Pair, Inspector, Material, Chat
- Plus 5 primitive spawn buttons
- Plus user inventory items (up to 15 total)
- Can be grabbed and repositioned via the cyan grab bar at the bottom

**System Panels:**
- Each system card opens a dedicated 3D panel (1024×768 canvas)
- Panel drawers are registered per-panelId (inventory, settings, splat, env, share, pair, session, inspector, material, chat, radial)
- Standard chrome: title, subtitle, BACK/CLOSE buttons
- Panels are positioned beside the dash (or centered if dash was hidden)

**Radial Context Menu (VR):**
- 3D version of the desktop's React DOM radial menu
- 5 slices + center hub, 3 tabs (general/grab/held)
- Polar hit-test for slice detection (angle-based)
- Center hub click cycles tabs

**Chat Panel (VR):**
- Recent messages display (tail of buffer, max 30)
- Alphabet grid for typing input
- Backspace/Clear/Send buttons
- Chat input buffer managed locally (not through React)

**Data Context:**
- App.tsx pushes live state via `setDataContext()` (PanelContext)
- Includes: inventory, graphics, environment, room info, selected asset, camera state, grab mode, users list, isHeld flag, chat messages
- Panel redraws only when a panel is active

### SpatialPanelManager

**File:** `src/engine/SpatialPanelManager.ts` (~850 lines)

Manages **world-space HTML panels** — React DOM content placed in the 3D scene:

**Desktop mode:** Uses `CSS3DRenderer` + `CSS3DObject`. Real HTML DOM elements with correct perspective, fully interactive. Always renders on top of WebGL (accepted limitation).

**VR mode:** Uses `HTMLMesh` + `InteractiveGroup`. Rasterizes DOM to CanvasTexture, forwards XR controller raycasts as synthetic pointer events.

**Panel creation:**
1. Caller creates a detached `<div>` and mounts React content into it via `createPortal`
2. `createPanel(id, domContainer, scene, camera, cssWidth, cssHeight, parent?)` wraps it in a `CSS3DObject` + holographic wireframe frame
3. Returns a `THREE.Group` for position/rotation access
4. Panels can be parented to an asset (e.g. video controls docked under a video)

**Locked-cursor interaction:**
- While pointer-locked, the crosshair can hover over panel elements
- `updateLockedHover(cx, cy)` uses `document.elementFromPoint()` to detect what's under the crosshair
- `handleLockedClick()` dispatches synthetic pointer/mouse events to the hovered element
- `handleLockedScroll()` directly mutates `scrollTop` (synthetic wheel events don't work for scrolling)
- `isOverPanel` flag tells App.tsx when to change the crosshair visual

**VR HTMLMesh sync:**
- Each frame, htmlMesh world position/quaternion is synced from the panel group's world transform
- Canvas texture Y-flip is re-applied on texture regeneration (prevents one-frame upside-down glitch)
- Scale is computed as `cssScale × 1000 × worldScale` to preserve panel sizing

### Known Issues / Things to Watch
- CSS3DRenderer always renders on top of WebGL — panels can't be occluded by 3D geometry
- The VR HTMLMesh approach means buttons work via synthetic events, which can miss edge cases (hover states, focus management)
- Panel grip-grab in VR is separate from asset grab — uses the same grip button but different raycast targets
- The shared InteractiveGroup means all VR panels share one event-forwarding context

---

## 10. EnvironmentManager — Atmosphere, Grid, Lighting

**File:** `src/engine/EnvironmentManager.ts`

### Atmosphere Presets

| Preset | Background | Ambient Color | Dir Light Color | Starfield |
|--------|-----------|--------------|----------------|-----------|
| cyber-nebula (default) | #0b1329 | white | cyan | ✅ |
| sunset-horizon | #1a0f2e | warm yellow | pink | ✅ |
| studio-neutral | #263238 | neutral gray | white | ❌ |
| starfield-space | #020408 | light blue | white | ✅ |
| custom-pano | equirectangular texture | (from env) | (from env) | ❌ |
| passthrough | transparent | — | — | ❌ |

### Grid System

Three size presets:
- `studio-20`: 20×20, 20 divisions
- `standard-60`: 60×60, 60 divisions (default)
- `arena-200`: 200×200, 100 divisions

Three color presets: cyan, purple, monochrome.

Grid is parented to `worldRoot` (not scene) so VR locomotion translates it with the floor.

### Starfield

2000 randomly positioned points on a sphere (radius 300-500), with color tints (white, cyan, magenta). Non-attenuated size (2.2px). Parented to `worldRoot` for VR rotation.

### Floor

`THREE.PlaneGeometry(100, 100)` with dark material (`#0f172a`, roughness 0.7, metalness 0.3). Scales with grid size preset. Transparent in starfield mode.

### Lighting

- Ambient light: intensity controlled by user (default 0.4)
- Directional light (sun): intensity controlled by user (default 1.5), casts shadows
- Accent purple light: fixed at (-10, 10, -10), intensity 0.8

All lights are parented to `worldRoot` so shadows rotate with the world in VR.

### Passthrough Mode

Sets background to null, clear alpha to 0, requests `alpha-blend` blend mode on the XR session. For mixed-reality headsets.

### Known Issues / Things to Watch
- Custom panorama skybox uses `EquirectangularReflectionMapping` — only works for equirect images
- Grid rebuilds on every settings change (disposes + recreates) — could be optimized
- Starfield points are at finite distance (300-500m), not truly at infinity — mild parallax when walking

---

## 11. InventoryService — IndexedDB Persistence

**File:** `src/services/InventoryService.ts`

### What It Does
CRUD operations for a local inventory stored in IndexedDB (`nexusvr-storage` database, `inventory` object store).

### Data Model

```typescript
interface InventoryItem {
  id: string;
  name: string;
  type: '3d-model' | 'vrm' | 'primitive' | 'misc' | 'tool' | 'system';
  createdAt: number;
  fileData?: ArrayBuffer;      // For re-import
  url?: string;                 // For URL-based assets
  primitiveType?: string;
  toolType?: 'dev' | 'material' | 'light' | 'shape' | 'brush';
  folder?: string;
  materialState?: MaterialUpdate;
  metadata?: { fileSize?, mimeType?, description? };
}
```

### Default Items

On construction, seeds the DB with:
- 6 default primitives (cube, sphere, cylinder, cone, torus, plane)
- 5 default tools (dev, material, light, shape, brush)

### Folder System

- Folders stored as a special `sys-folders` inventory item with `metadata.folders: string[]`
- Supports nested paths via `/` separator (e.g. `weapons/swords`)
- Rename/move operations update all items in the folder + subfolders

### Known Issues / Things to Watch
- `clearCustomItems()` deletes everything except `prim-default-*` items — destructive, no undo
- No asset thumbnails in inventory (just type + name + size)
- `fileData` is stored as raw ArrayBuffer in IndexedDB — large files consume significant storage

---

## 12. SceneSerializationService — Save/Load Rooms

**File:** `src/services/SceneSerializationService.ts`

### What It Does
Saves/restores entire scenes (all assets, positions, materials, environment settings) to IndexedDB.

### Data Model

```typescript
interface SavedScene {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  environment: EnvironmentSettings;
  assets: SavedSceneAsset[];  // Each has position, quaternion, scale, url, fileData, etc.
}
```

### Export/Import

- `exportSceneToJson(scene)` — serializes to `.nexus.json` file download (fileData converted to base64)
- `importSceneFromJson(file)` — parses `.nexus.json`, converts base64 back to ArrayBuffer, saves to DB

### Favorite Scene

- `getFavoriteSceneId()` / `setFavoriteSceneId()` — stored in localStorage
- Used for auto-loading a preferred scene on startup

### Known Issues / Things to Watch
- Base64 conversion of fileData is memory-intensive for large files
- No scene versioning/migration — old format may break on new versions
- Scene save/load UI is in `SceneSaveLoadModal.tsx`

---

## 13. UndoRedoManager

**File:** `src/services/UndoRedoManager.ts`

### What It Does
Generic undo/redo stack with symmetric undo/redo operations.

### Data Model

```typescript
interface UndoAction {
  label: string;        // e.g. "Move Cube"
  undo: () => void;     // Reverse the action
  redo: () => void;     // Re-apply the action
}
```

### API

- `push(action)` — adds to undo stack, clears redo stack, max 100 history
- `undo()` — pops from undo, pushes to redo, calls undo function
- `redo()` — pops from redo, pushes to undo, calls redo function
- `canUndo()` / `canRedo()` — boolean checks
- `onChange(cb)` — subscribe to stack changes (for UI badge updates)

### Convenience Factory

`recordTransform(assetId, label, before, after, applyTransform)` — records a position/rotation/scale change with a callback that applies the snapshot.

### Known Issues / Things to Watch
- Currently scoped to **transforms only** — spawn/delete undo is not fully implemented
- The `applyTransform` callback must be provided by the caller (App.tsx handles the actual scene graph mutation)
- Max 100 actions — oldest is silently dropped

---

## 14. Permissions & Roles

**File:** `src/types/permissions.ts`

### Role Hierarchy

| Role | canAdmin | canEditWorld | canModerate | canSpawnItems | canMoveAndChat |
|------|----------|-------------|-------------|---------------|----------------|
| admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| builder | ❌ | ✅ | ❌ | ✅ | ✅ |
| moderator | ❌ | ❌ | ✅ | ❌ | ✅ |
| guest | ❌ | ❌ | ❌ | ✅ | ✅ |
| spectator | ❌ | ❌ | ❌ | ❌ | ✅ |

### How It's Used

- Host is always `admin` by default
- New peers get a configurable default role (`anonymousDefaultRole`)
- The host can change roles via the Session & Roles panel
- `ROLE_PERMISSIONS[role]` is checked before actions (e.g. `canEditWorld` gates spawn/delete/transform)
- Moderation actions (kick, ban, silence, etc.) require `canModerate`

### Data Types

```typescript
interface PeerRoleInfo {
  peerId: string;
  userName: string;
  role: UserRole;
  isMuted: boolean;
  isHost: boolean;
}

interface ModerationActionPayload {
  action: 'kick' | 'ban' | 'silence' | 'unsilence' | 'respawn';
  targetPeerId: string;
  fromPeerId: string;
  reason?: string;
}
```

### Known Issues / Things to Watch
- Permissions are checked locally — a malicious peer could ignore them (no server-side enforcement)
- The `isSelf` flag is added client-side for UI rendering
- Default permissions config (`DefaultPermissionsConfig`) exists in types but may not be fully wired to the room settings UI

---

## 15. RawFilesStore — Lazy-Share Byte Storage

**File:** `src/services/RawFilesStore.ts`

### What It Does
When the user toggles "Import as Raw File" on a large file, the file bytes are stored in IndexedDB (`nexusvr-raw` database) instead of being broadcast to peers. The in-world misc asset is visible but the underlying bytes are local-only.

### When Bytes Are Used

When the user takes an action on the raw asset:
- **Import:** Rehydrate bytes and re-import as the actual file type
- **Download:** Trigger a browser file download
- **Save to Inventory:** Bytes move to InventoryService's storage

### Data Model

```typescript
interface RawFileRecord {
  id: string;        // Matches the asset.id
  name: string;
  type: string;
  bytes: ArrayBuffer;
  storedAt: number;
}
```

### Lifecycle

- `store()` — saves bytes (idempotent, awaited to prevent TOCTOU)
- `load()` — retrieves bytes for rehydration
- `delete()` — removes when asset is deleted from world
- `has()` — check existence

---

## 16. UI Components

### Navbar (`Navbar.tsx`)
Top bar with: app title, room info (peer count, connection mode), chat badge, share button, menu toggle.

### Toolbar (`Toolbar.tsx`)
Floating toolbar with: transform mode buttons (translate/rotate/scale), space toggle (local/world), undo/redo, camera mode toggle.

### DashMenu (`DashMenu.tsx`)
Full-screen overlay menu (Tab key) with tabs: Session & Roles, Quick Inventory, Controls Guide, World Settings. Each tab is a dark-slate card with pill buttons.

### RadialContextMenu (`RadialContextMenu.tsx`)
Desktop 5-slice radial menu (MMB or hotkey):
- **General tab:** Mute, Locomotion, Scaling, Laser, Undo
- **Grab tab:** Mute, Redo, Grab Mode, Snap Grid (placeholder), Collision, Undo
- **Held tab:** Save to Inventory, Duplicate/Download, Destroy
- Center hub click cycles tabs

### SceneInspectorWindow (`SceneInspectorWindow.tsx`)
Per-selected-asset editor: position/rotation/scale inputs, persistent flag checkbox, collision toggle, Grabbable component section (enabled, scalable, allowSteal, grabPriority, etc.), mesh stats (vertex/triangle count). Rendered as a spatial popup.

### SpatialPopUpWrapper (`SpatialPopUpWrapper.tsx`)
Wraps React content (import dialog, inspector) as a 3D mesh in the scene via SpatialPanelManager. Header has a "Bring" button that, when an `onBringToMe` callback is provided (e.g. from SceneInspectorWindow), teleports the inspected asset to in front of the camera AND repositions the panel.

### VideoControls / VideoObjectControls
In-world video player UI: play/pause, 5s step, timeline scrubber, volume (global/local), stop. Dark-slate styling with golden timeline.

### SettingsModal
Graphics: resolution scale, shadow quality, AA, MSAA samples. Environment: atmosphere, grid. Progressive LOD: toggle + density.

### ShareModal
Room link display, QR code (via qrcode.react), copy-to-clipboard.

### ChatPanel
Collapsible chat panel with message list, text input, unread badge.

### FileImportModal / AssetImportDialog
Import configuration: scale mode, placement, shading, texture filtering. Shown when dropping/pasting files.

### MiscFileModal (legacy)
Previously used for misc file actions. Now replaced by radial menu "held" tab actions. The file still exists but is no longer actively used.

---

## 17. Supporting Systems

### ContextMenuManager (`ContextMenuManager.ts`)

**Single source of truth** for radial menu items across VR and Desktop. `buildActiveMenuItems(context, activeTab)` generates the correct item list for:
- General tab (no held object)
- Grab tab (object grabbed)
- Held tab (object being carried)
- Light tool tab (light tool equipped)
- Dev tool tab (dev tool equipped)

Each item has: `id`, `label`, `subLabel`, `color`, `icon`, `action`, `closeOnClick`, and optional `submenu`.

### ResoniteLightSync (`ResoniteLightSync.ts`)

Bridges Resonite-style light component configuration to Three.js lights:
- Supports Point, Directional, and Spot light types
- Configurable: intensity, color, shadow type/strength/resolution/bias, range, spot angle
- `syncThreeLightFromConfig()` creates/updates a child light on any Object3D

### BrushManager (`BrushManager.ts`)

In-world 3D painting brush. Creates geometry (tubes/lines) on surfaces where the user paints. Uses raycasting to find surface positions and creates connected stroke geometry.

### ThumbnailGenerator (`ThumbnailGenerator.ts`)

Generates preview thumbnails for assets by rendering them to an offscreen canvas.

### deviceTier (`utils/deviceTier.ts`)

Classifies the device as 'mobile', 'desktop', or 'vr' based on user agent and XR capabilities. Provides `getMaxCanvasResolution()` and `shouldAlwaysDownscaleVideo()` for performance scaling.

### createPanelActionHandler (`handlers/createPanelActionHandler.ts`)

Bridges VR panel button actions to React state mutations. Maps action strings (e.g. `settings.resScale:1.5`) to the appropriate state updates in App.tsx.

### useRawMode (`hooks/useRawMode.ts`)

React hook that tracks whether the "Import as Raw File" toggle is active. Returns the current state and a setter.

### VRRadialMenuMesh (`VRRadialMenuMesh.ts`)

The 3D mesh representation of the radial context menu for VR. Creates the 5-slice geometry with center hub, handles hover highlighting, and provides slice detection via polar coordinates.

---

## Appendix: Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| `MAX_INLINED_FILE_BYTES` | 15 MB | NetworkService |
| `SMALL_VIDEO_BYTES` | 15 MB | AssetManager |
| `LOCAL_MSE_BYTES` | 50 MB | AssetManager |
| `VIDEO_STREAM_CHUNK_BYTES` | 64 KB | VideoStreamingService |
| `HEADER_LEN` | 64 bytes | VideoStreamingService |
| `BECOME_HOST_COOLDOWN_MS` | 5000 | NetworkService |
| `SYSTEM_CHAT_DEDUPE_MS` | 3000 | NetworkService |
| `VR_HOLD_DOLLY_SPEED` | 1.5 m/s | ManipulationManager |
| `VR_HOLD_ROTATE_SPEED` | 2.5 rad/s | ManipulationManager |
| `VR_HOLD_MIN_DIST` | 0.2 m | ManipulationManager |
| `VR_HOLD_MAX_DIST` | 5.0 m | ManipulationManager |
| `TWO_HANDED_MIN_SCALE` | 0.02 | ManipulationManager |
| `TWO_HANDED_MAX_SCALE` | 50.0 | ManipulationManager |
| `PRESS_THRESHOLD` | 0.5 | VRInputManager |
| `THUMB_DEADZONE` | 0.15 | VRInputManager |
| `CHAT_MESSAGE_HISTORY` | 30 | VRHUDManager |
| `maxHistory` | 100 | UndoRedoManager |
| `cssScale` | 0.003 | SpatialPanelManager |

---

*Last updated: August 2026*
