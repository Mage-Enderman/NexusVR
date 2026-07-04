# VR-ModelViewer-Web — Feature Status

> **Status:** living document. Last regenerated after the misc-file UI rebuild, the spatial-popup billboard/E-rotation fix, and the host/guest chat-spam throttle. Code paths are referenced where helpful.

---

## Stack & Architecture

### Build / Runtime
- **React + TypeScript + Vite** (strict TS via `tsconfig.app.json`)
- **Three.js** + `GLTFLoader`, `OBJLoader`, `FBXLoader`, `DRACOLoader`, `MeshoptDecoder`
- **@needle-tools/gltf-progressive** (opt-in progressive LOD)
- **PeerJS** for WebRTC P2P rooms
- **@pixiv/three-vrm** for VRM avatars
- **IndexedDB** for inventory + identity persistence
- **Web Crypto API** for client-side keypairs (identity layer, see CONTACTS_DESIGN.md)

### Top-level layout
```
src/
├── engine/          # non-React 3D + service singletons
│   ├── SceneEngine.ts        # viewport, camera modes, locomotion, WebXR lifecycle
│   ├── AssetManager.ts       # file/URL imports: GLB/GLTF/OBJ/FBX/image/video/misc/primitive
│   ├── ManipulationManager.ts # gizmos, RMB-grab, VR grip, two-handed scale, E+drag rotate
│   ├── NetworkService.ts     # PeerJS rooms, spawn/sync/transform/avatar/chat moderation
│   ├── InventoryService.ts   # IndexedDB CRUD
│   ├── UndoRedoManager.ts    # transform snapshots
│   ├── EnvironmentManager.ts # atmosphere presets, grid, lighting
│   ├── AvatarManager.ts      # local + peer avatars + WebRTC audio
│   ├── VRHUDManager.ts       # 3D curved dashboard + 3D panels + VR radial
│   ├── BrushManager.ts       # in-world painting brush
│   └── VRInputManager.ts     # Quest controller button reading (side-aware)
├── components/      # React UI
│   ├── Navbar.tsx, Toolbar.tsx, DashMenu.tsx
│   ├── WorldEnvironmentModal.tsx, WorldToolsPanel.tsx, SettingsModal.tsx
│   ├── ShareModal.tsx, ChatPanel.tsx, InventoryModal.tsx
│   ├── FileImportModal.tsx, AssetImportDialog.tsx, MiscFileModal.tsx
│   ├── SceneInspectorWindow.tsx, SpatialPopUpWrapper.tsx
│   └── RadialContextMenu.tsx (Resonite-style pie menu)
├── services/        # mirror of engine/ services — App.tsx mostly imports from here
└── types/           # shared TS types (permissions, etc.)
```

---

## Currently Implemented Features

### Core
- **Two camera modes:** first-person (pointer-locked WASD) + orbit (mouse-drag with gizmo); toggle via **V key**
- **Three locomotion modes:** walk (with auto-climb at head height), flight (free-fly thumbstick), noclip (no collision)
- **Locomotion banner** appears when changing modes
- **Self-scale modifier:** Mass-gizmo "Scale-Self" stretches the camera height/dolly target — observable as user grows/shrinks
- **Inventory persistence:** IndexedDB-backed; survives reload, includes fileData for re-import
- **Undo/redo:** gizmo-drag transform snapshots, bound to `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`). Currently scoped to *transforms only*.
- **Drag-and-drop file import** + **Ctrl+V URL paste** + **Ctrl+Shift+V plain paste** (suppresses URL import)
- **Import config:** scale mode (auto/meters/cm/inches/custom), placement (origin/floor), shading (smooth/flat), texture filtering (smooth/pixel-art)

### Asset System (`AssetManager.ts`)
- **Model formats:** GLB / GLTF (with Draco + meshopt), OBJ, FBX, VRM
- **Image formats:** PNG, JPG, JPEG, WEBP, GIF with 5 display modes:
  - 2D plane (flat), **billboard sprite, 3D framed panel**, 360° panorama sphere (inside-out), skybox (background + environment)
- **Video formats:** MP4, WEBM, MOV with 3 aspect ratios (16:9, 9:16, 1:1); autoplay + loop by default
- **Misc files** *(recently redesigned)*: any extension not matched above falls through to `createMiscFileObject` — now renders as a flat 2D plane (canvas-textured document icon with folded corner, filename, size, extension badge). Collidable like an imported picture. Position/rotatable via gizmo.
- **Primitives:** cube, sphere, cylinder, cone, torus, plane (random neon color on spawn)
- **Progressive LOD streaming** *(opt-in via settings)* using `@needle-tools/gltf-progressive`
- **In-flight loading placeholders:** peers see a pulsing cyan mesh + label `"Loading / <name> / by <user>"` until the real asset lands. Optimized for small per-frame cost (sin pulse + cheap rotation).
- **Oversized file protection:** `buildEnvelope` strips the binary payload above the per-asset cap; receivers render a static red `"Too Large"` indicator instead of attempting to import a binary that was never sent.

### Manipulation (`ManipulationManager.ts`)
- **Transform gizmos:** translate (W/G), rotate (R/E), scale (S)
- **Local vs world space** toggle (Tools bar button)
- **RMB-grab:** hold right mouse button, drag, release. Does NOT mutate selection state. Available on any collidable asset.
- **E+drag rotate-around-pivot:** hold E and drag LMB while an asset is grabbed; rotates around Y axis relative to grab pivot. Suppressed on spatial-popup mesh and on primitives in cursor-follow mode (where it would feel like jitter).
- **Collision toggling** per-asset
- **Two-handed scale grab** *(VR)*: both triggers + grip → rescale in 3D space
- **Center-ray secondary action:** dev-tool secondary action bound to R / mouse buttons 3/4

### VR (WebXR)
- **Dual-controller input** (side-aware via OpenXR `inputsource.handedness`):
  - **A** — jump / ascend (per locomotion mode)
  - **B (right) / Y (left)** — toggle Resonite radial context menu
  - **X (left)** — open/close VR dash (curved HUD)
  - **Grip (BOTH)** — grab (RMB-equivalent, both hands grab now)
  - **Trigger** — HUD click (single-handed); two-handed scale (both triggers co-held)
- **VR HUD** (`VRHUDManager.ts`): 3D curved screen with system cards, inventory spawn buttons, settings, environment, share, pair, radial, inspector. Each "card" is a 3D mesh with its own canvas texture — no React DOM in immersive WebXR.
- **3D panel system:** any modal-like flow (inventory spawn details, settings, etc.) can open as a 3D panel in VR through the same HUD pipeline.
- **VR avatar:** full-body VRM with simple walk animation
- **Voice chat** over the same WebRTC data-channel PeerJS connection

### Networking (`NetworkService.ts`)
- **PeerJS P2P rooms** — host vs guest auto-fallback via 3-second dial-host-or-claim
- **Host/guest cooldown + system-chat dedupe** *(recent fix)*: prevents the host/guest race loop from spamming `You are the host of <room>` / `Host id was taken — joining as guest` indefinitely. Throttle constants: `BECOME_HOST_COOLDOWN_MS = 5000`, `SYSTEM_CHAT_DEDUPE_MS = 3000`.
- **Spawn/sync:** every asset addition broadcasts a spawn envelope to all peers; late joiners receive a snapshot via `onSyncReq` → `onSyncResp`
- **Transform broadcast** during grab/drag: throttled to ~16Hz per peer to avoid saturating the bus
- **Chat system** with peer attribution, unread badge, in-VR chat panel via the HUD
- **Voice:** peer audio streams attached to peer avatar positions (3D positional audio)
- **Avatar sync:** position + rotation broadcast per peer
- **Permissions:** admin / builder / guest roles with per-action capability checks (`types/permissions.ts`)
- **Moderation:** kick / ban / respawn verbs
- **Pair mode:** short alphanumeric code (e.g. `PAIR-7K2X`) instead of a long room name; resolves to a one-on-one session

### Inventory (`InventoryService.ts`)
- IndexedDB persistence
- Type filter (all / 3d-model / vrm / primitive / misc)
- Spawn-from-inventory path re-imports the asset into the world using cached `fileData` / `url`

### UI
- **Resonite-style radial context menu** (5 slices, 3 tabs):
  - **General:** Locomotion / Scaling / Laser
  - **Grab:** Grab mode / Snap-grid (placeholder) / Collision toggle
  - **Held** *(when carrying an object)*: Save to inventory / Duplicate / Destroy; **the bottom slice becomes Download for misc files** *(recent fix)*
- **Grab modes:** auto / precision / palm / laser (cycled via radial slice or controller hotkey)
- **Spatial popup windows** *(recently fixed)*: import dialog + scene inspector render as 3D meshes with HTML overlays. The mesh's NDC position projects to screen-space; the gizmo is the only way to rotate them now (no billboard, no E-rotate surprise).
- **Settings modal:** graphics (resolution scale, shadow quality, AA, msaa), progressive LOD toggle + density control, environment (atmosphere, grid)
- **Chat panel:** collapse + unread badge in Navbar
- **Dash menu (Tab key)**: combines inventory, settings, environment, session, share, pairing, radial, inspector into a unified pie-style launcher
- **In-world painting brush** (WorldToolsPanel.tsx): a 3D brush that paints onto surfaces (spray-style)

### Environment
- **Atmosphere presets** (cyber-nebula is the default; dawn/dusk/midnight etc available)
- **Togglable grid** with size variation + custom color
- **Ambient + directional lighting** with intensity controls

### Asset Inspector
- **SceneInspectorWindow**: per-selected-asset editor (position, rotation, scale, persistent flag, collision flag) with meshStats traversal (vertex/triangle counts). Mounted as a spatial popup so it floats in the world.

### Misc visual sanity
- **The misc-file visual** was just rebuilt — see "Recently changed" below.

---

## In-Progress / Known TODOs

| Area | TODO |
|------|------|
| Radial grab tab — bottom slice | Snap-grid *toggle* is a placeholder (logs no-op) |
| Radial grab tab — left slice | Collision *toggle* works, but icon color cue is sometimes inconsistent |
| SpatialPopUpWrapper "Bring to me" button | Not fully wired through to scene-engine teleport |
| Progressive LOD | Opt-in only; no automatic enable based on GPU tier |
| Avatar expression / blink | VRM blendshapes not exposed |
| World persistence | Scenes are not saved to disk — only inventory items persist |
| Server mode | No fallback signaling server (uses PeerJS public broker only) |
| VR hand tracking | Controllers only; OpenXR hand-input pins are not wired up |
| Edit-time shading re-bake | Per-asset "re-bake smooth/flat" not exposed after import |
| Edit-time texture filter switch | "pixel-art" filtering is import-time only; can't switch after import |
| Multi-select | Shift-click and box-select for bulk operations are not implemented |
| Asset preview thumbnails in inventory | Inventory shows type + name + size, but no visual preview |
| WebXR hand tracking | OpenXR hand input / pinch-grab |
| Server-lite mode | Optional signaling server for offline rooms |
| Per-room world persistence | Save a scene + reload it in a fresh room |

---

## Suggestions (Things I think should be added or adjusted)

### UX
- **Multi-select with bulk move / delete / duplicate / save.** The radial menu's "held" verb set is great for one asset — extending it to a group is the natural next step.
- **Asset thumbnails in the inventory.** A `CanvasTexture` snapshot from the asset's first render frame, ≈128×128. Cached in IndexedDB next to the inventory item.
- **Selfie mirror / portrait camera** for previewing the avatar without entering VR. A small 3D rectangle that renders the avatar via a `CubeCamera`.
- **Sun/sky editor** for atmosphere presets. Time-of-day slider + sun position. Atmosphere presets would become presets over a more expressive sky model.
- **Saved-scene serialization** for offline persistence. Snap all asset transforms + primitive + asset URLs/fileData into a single IndexedDB blob, restore on app reload.

### Networking / Privacy
- **Backup signaling server** option for offline rooms. Optional URL field in `NetworkService.initSession` fallback path.
- **Per-friend invite codes** derived from publicKey digest → 6-char base32 → typed at join time. Less guessable than `${roomId}-host`.

### Manipulation
- **Multi-mouse-button remapping** in Settings. Currently:
  - MMB → open radial menu (and we should also let it close — see Recently Changed).
  - Mouse 4/5 → secondary action (dev tool center-ray select).
  - RMB → grab.

### Performance
- **GPU profiling overlay** (WebGL timer queries in a sparkline). Helps users understand frame-time spikes.
- **Auto-degrade quality** on FPS drop. If average FPS < 30 for N seconds, lower shadow quality one step.

### Misc
- **i18n / localization** for the UI strings. Currently English-only.
- **Per-asset physics** toggle. Optional simple gravity + collision response for misc files.
- **Audio source playback** for misc files (drag-drop an MP3 → plays 3D-positionally).
- **VRM blend-shape picker** (eye blink, mouth open) for avatar customization.

### Code health
- **Reduce per-frame allocations** in `SceneEngine` `updateCallback` (currently a fresh `THREE.Vector3()` per VR aim — could reuse a scratch vector).
- **Drop the legacy `MiscFileModal` path now that the radial menu owns the held verb set.** *(Done — both removed.)*
- **Refactor the radial menu's "5 slices × 3 tabs" into a per-tab slice table** to make adding more actions cheaper.

---

## Recently Changed (Reference)

- **Misc-file UX overhaul** — replaces the Octahedron + Torus "diamond with ring" placeholder with a flat 2D canvas-textured document icon (filename baked into the texture so it's always visible, no auto-modal popup on click/grab). The Download + Save to Inventory actions moved into the radial menu's "held" tab — Save is the right slice (amber), Download is the bottom slice (cyan) when the held asset's type is `'misc'`, otherwise the bottom stays Duplicate. The misc-file modal is no longer used.
- **SpatialPopUpWrapper billboard + E-rotation fix** — removed the constant world-quaternion → CSS rotation block (was producing a screen-space billboard) and tagged the popup mesh with `userData.isSpatialWindow = true`. `ManipulationManager` now skips E+drag rotation on spatial windows so the gizmo is the only sanctioned rotation path.
- **Host/guest chat spam throttle** — added `notifySystemChat` dedupe (3 s window) + `becomeHost` cooldown (5 s) + reset on `disconnect()`. Stops the alternating host/guest spam loop when the broker hasn't released the host id yet or the user is the only one in the room after a transient disconnect.
- **VR controller input was made side-aware** — the left controller's X/Y are now reported as `'x' | 'y'` (not `'a' | 'b'`), per the Quest OpenXR mapping. The X button opens the VR dash; both grips grab (left grip used to open the dash).
