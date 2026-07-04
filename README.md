# NexusVR

> ⚠️ **VERY ALPHA — WORK IN PROGRESS** ⚠️
>
> This project is in active, early-stage development. Many features are incomplete, untested, or may break without warning. APIs, file formats, and the overall architecture are **subject to change at any time**. Expect bugs, gaps, and sharp edges. **Do not rely on this for production or anything important.**
>
> No versioned release exists yet — `main` is the bleeding edge.

A Resonite-inspired **social VR / metaverse web app** built with React, Three.js, and WebXR.
Drop into rooms with friends over peer-to-peer WebRTC, import GLTF / VRM models, build worlds
with primitives, brush strokes, and lights, and bring your own VRM avatar — **no central server
required**.

---

## ✨ Features

### 🎮 Core

- **Browser-based VR** via WebXR, with a desktop first-person camera fallback (orbit + WASD
  walk / flight / noclip locomotion modes)
- **P2P multiplayer** using [Trystero](https://github.com/dmotz/trystero) over WebRTC + Nostr
  relay signaling — no central game server, no install
- **Room system** with deterministic host migration by lexicographic peer ID, automatic scene
  re-sync for late joiners, shareable URL + QR-code room invites
- **Voice + text chat** with positional 3D audio (THREE.PositionalAudio per peer avatar), push-
  to-talk friendliness via room-level mic toggle, plus mute / deafen / silence

### 🛠️ World Building

- **Asset import** for `.glb` / `.gltf` / `.obj` / `.fbx`, images, videos (`.mp4`, `.webm`,
  `.mov`), VRM avatars, and a holographic "misc file" placeholder for arbitrary uploads
- **Transform gizmos** (translate / rotate / scale) with mouse-wheel shortcuts for held-item
  distance and zoom-self, plus a keyboard-rotate-drag mode (hold `E`)
- **Procedural primitives**: cube, sphere, cylinder, cone, torus, plane — each spawn gets a
  random neon color
- **World Tools panel**: change material color / roughness / metalness / emissive / opacity /
  texture (with optional pixel-art filtering), spawn point and spot lights, draw 3D tube
  brush strokes via `BrushManager`
- **Environment presets**: cyber-nebula / sunset-horizon / studio-neutral / starfield-space,
  custom-panorama skyboxes, switchable grid sizes and colors
- **Progressive LOD** for high-poly assets via `@needle-tools/gltf-progressive`
  (auto-enabled in the Graphics settings modal)
- **Spatial inspector window** with live position / rotation / scale inputs, mesh stats,
  vertex normals, and "Jump To" / "Bring To Me" actions
- **Radial context menu** (Resonite-style pie menu) for locomotion mode, scaling toggle,
  laser toggle, grab mode, and undo / redo
- **Undo / redo** for transforms, spawn, and delete (100-action history)

### 👥 Multiplayer & Social

- **VRM avatar sync** for peers (head + hands, with optional full VRM streaming)
- **Permission roles**: `admin` / `builder` / `guest` / `anonymous` with per-action gating
  (configurable defaults in the Dash Menu)
- **Host moderation** actions: kick, ban, silence, respawn, "jump to user"
- **IndexedDB inventory** with default primitives and world tools (Dev, Material, Light,
  Shape, Brush) saved per-browser
- **VR Dash Menu** — a curved `CanvasTexture` screen hovering in front of the player,
  interactable via controller laser; desktop fallback is a normal modal dashboard

---

## 🚧 Project Status

This repository is **very alpha**. Please temper your expectations.

Known gaps and rough edges:

- Only the local single-host flow has been thoroughly tested; multi-peer NAT traversal and
  voice routing are still being validated
- Voice reliability across restrictive NATs is inconsistent — we bundle a free Open Relay
  TURN (`openrelay.metered.ca`) for convenience, but **production deployments should swap
  in a self-hosted TURN server** in `src/services/NetworkService.ts`
- The codebase uses **Oxlint** (`npm run lint`) instead of ESLint; the Vite default `eslint`
  config is intentionally not shipped
- The radial pie menu, dash menu, and chat panel are functionally complete but visually
  rough — UI polish is post-MVP
- VR controller bindings in Immersive mode (laser, grab, transform drag) are wired but have
  not been QA'd on every headset browser
- Performance for very large scenes (1k+ objects) is unmeasured; instancing and frustum
  culling improvements are pending
- Late-join sync re-broadcasts the host's full snapshot over Trystero on join. Existing
  assets are deduped by id, but the sync protocol isn't versioned and there's no per-asset
  delta — re-broadcasts of large scenes re-stream fully
- No automated test suite yet (vitest / playwright TBD)
- No production build / asset pipeline (no GPU LOD bake, no texture compression)

---

## 🏃 Getting Started

Requires Node.js (any version that Vite 8 supports — see `package.json`).

```bash
npm install
npm run dev       # start dev server (HMR)
npm run build     # production build
npm run preview   # preview the production build locally
npm run lint      # run Oxlint
```

Open the printed URL in a desktop browser to start in `first-person` mode. To enter VR, open
in a WebXR-capable browser (Chrome / Edge / Quest Browser) and click the **VR** button on the
navbar.

### Quick multiplayer test

1. Open the app in one tab → click the **Share** button → copy the room ID or QR code
2. Open the app in a second tab / device → paste the room ID → click "Join"
3. Both clients share the same world; primitives spawned in one appear in the other

For voice testing across networks, configure your own TURN server — the bundled Open Relay
endpoint is a free public service and **must not** be relied upon for production loads.

---

## 🧪 Tech Stack

| Layer        | Library                                                          |
| ------------ | ---------------------------------------------------------------- |
| UI           | React 19 + TypeScript                                            |
| 3D engine    | Three.js + `three-mesh-bvh` (Collision / raycast acceleration)   |
| Avatars      | `@pixiv/three-vrm`                                               |
| Progressive LOD | `@needle-tools/gltf-progressive`                              |
| Models       | `GLTFLoader` / `OBJLoader` / `FBXLoader` (DRACO + Meshopt)       |
| Networking   | `trystero` (WebRTC + Nostr relays, no central server)            |
| Storage      | IndexedDB via `idb`                                              |
| Build        | Vite 8 + `@vitejs/plugin-react` (Oxc-based HMR)                  |
| Lint         | Oxlint                                                           |

---

## 🗂️ Project Layout

```
src/
  App.tsx              # top-level orchestrator (wires engines + modals + network events)
  main.tsx             # React root
  components/          # modals, toolbar, navbar, world tools, radial menu, chat, dash, inspector
  engine/              # SceneEngine · AssetManager · AvatarManager ·
                       #   ManipulationManager · EnvironmentManager ·
                       #   BrushManager · VRHUDManager
  services/            # NetworkService (P2P), InventoryService (IDB),
                       #   UndoRedoManager
  types/               # role / permission types
```

Key files worth reading:

- `src/engine/SceneEngine.ts` — Three.js scene, WebXR controllers, camera modes, FPS loop
- `src/services/NetworkService.ts` — Trystero wiring, host migration, scene snapshot sync,
  moderation actions
- `src/services/InventoryService.ts` — IndexedDB-backed inventory with default primitives
- `src/engine/VRHUDManager.ts` — curved in-VR dashboard drawn via `CanvasTexture`
- `src/App.tsx` — the React glue that connects all of the above with the UI

---

## 📝 License

**No license has been chosen yet.** Treat the source as **proprietary** until a `LICENSE`
file is added to the repo. The maintainer intends to pick a permissive license (likely
**MIT** or **Apache-2.0**) before the v0.1 milestone — until then, please **do not
redistribute**.

---

## 🙋 Maintainer

Maintained by [@Mage-Enderman](https://github.com/Mage-Enderman). Issues and PRs are welcome,
but please be aware that the public API is unstable and likely to break. Bug reports with
repro steps are most appreciated during the alpha phase.
