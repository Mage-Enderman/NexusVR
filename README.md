# NexusVR

> ⚠️ **ALPHA — ACTIVE DEVELOPMENT** ⚠️
>
> This project is an open-source, Resonite-inspired **social VR / metaverse web application** built with React, Three.js, and WebXR.
> We welcome forks, pull requests, and community contributions!

Drop into rooms with friends over peer-to-peer WebRTC, import 3D models and videos, build worlds with primitive objects, and customize materials together in real-time — **no central server required**.

---

## ✨ Currently Implemented & Functioning

### 🎮 Core & Locomotion
- **Browser-based 3D / WebXR Sandbox**: Desktop first-person camera with orbit, WASD walking, flight, and noclip locomotion modes. WebXR VR support for compatible headsets.
- **Peer-to-Peer Multiplayer**: Powered by [PeerJS](https://peerjs.com/) over WebRTC. Direct peer-to-peer data and media streaming without centralized game servers.
- **Room System**: Deterministic host migration, automatic scene synchronization for late joiners, and shareable room links / QR codes.
- **Spatial Voice & Text Chat**: Real-time positional 3D audio per peer with push-to-talk friendliness, mute, silence, and room-level mic controls.

### 🛠️ World Building & Asset Manipulation
- **3D Asset & Video Import**:
  - Import `.glb`, `.gltf`, `.obj`, `.fbx`, images, and videos (`.mp4`, `.webm`, `.mov`).
- **In-World Interactive Video Players**:
  - Fully synchronized multiplayer playback with a **sleek dark-slate UI overlay**.
  - Interactive **golden timeline progress bar** with circular scrubber handle, play/pause, 5-second step rewind/forward, and stop controls.
  - Switchable **Audio Mode**: Global (synchronized broadcast to all players in the room) vs. Local (private headset-only listening).
- **Resonite-Inspired PBS Material Inspector**:
  - Edit material properties in real-time with clear, readable labels (**Albedo**, **Normal**, **Roughness**, **Metalness**, **Emissive**, **Opacity**).
  - Includes a dedicated **Normal Map Intensity slider** and texture upload/filtering controls.
- **Sleek Dark Dash Menu & UI**:
  - High-contrast dark slate styling across tabs (`Session & Roles`, `Quick Inventory`, `Controls Guide`, `World Settings`) and pill buttons.
  - Undo / redo system tracking transform, spawn, and delete operations.
- **Transform Gizmos**: Desktop toolbar and 3D gizmos for Move, Rotate, and Scale operations.

### 👥 Multiplayer Roles & Moderation
- **Permission System**: Configurable room roles (`admin`, `builder`, `moderator`, `guest`, `spectator`) with fine-grained capability checks.
- **Host Moderation Tools**: Jump to player, respawn, silence/unsilence, kick, and ban users.
- **Local Browser Inventory**: IndexedDB-backed inventory allowing you to save favorite shapes, tools, and assets between sessions.

---

## 🚧 Planned / Not Yet Implemented

The following features are on our roadmap and open for contribution:
- **VRM Avatars & Full IK Sync**: Custom 3D VRM avatar loading, full-body Inverse Kinematics (IK), and multi-peer skeleton synchronization are currently experimental/planned and not yet functioning.
- **3D Physics Engine**: Rigidbody physics and collision dynamics (e.g. Box3D / Rapier integration).

---

## 🏃 Getting Started

Requires Node.js (any version compatible with Vite 8 — see `package.json`).

```bash
npm install
npm run dev       # Start local development server (HMR)
npm run build     # Compile production build
npm run preview   # Preview the production build locally
npm run lint      # Run Oxlint
```

1. Open the URL in your browser to start building.
2. Click **Share** to copy a room link and invite a friend in another browser tab or device.

---

## 🤝 Contributing & Forking

NexusVR is open-source and warmly welcomes forks, experiments, and pull requests! Whether you want to implement VRM avatars, improve UI polish, add physics, or optimize networking, feel free to fork the repository and open a PR.

---

## 🙏 Acknowledgements & Third-Party Open Source

NexusVR is built with several incredible open-source libraries:
- **[PeerJS](https://peerjs.com/)** (MIT License) — Peer-to-peer WebRTC networking and data streaming
- **[Three.js](https://threejs.org/)** (MIT License) — 3D WebGL rendering engine
- **[React](https://react.dev/)** (MIT License) — UI framework
- **[MP4Box.js](https://github.com/gpac/mp4box.js)** (BSD-3-Clause License) — MP4 container demuxing and parsing
- **[three-vrm](https://github.com/pixiv/three-vrm)** (MIT License) — VRM avatar loading for Three.js

---

## 📝 License

This project is licensed under the **[MIT License](LICENSE)** — free and open for anyone to use, modify, fork, and distribute.
