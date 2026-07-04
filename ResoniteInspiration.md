# Resonite Lite - NexusVR: P2P Serverless Web App Architecture Blueprint

This document establishes a technical blueprint for building a decentralized, P2P "serverless" web application inspired by the foundational architecture of Resonite (specifically its core data engine, FrooxEngine). The goal is to leverage agentic development models like Google Antigravity to build a lightweight, browser-based, collaborative virtual environment where no user data is stored on a centralized server.

## 1. Core Architectural Pillars (Resonite vs. Resonite Lite)

Resonite utilizes a unique state-synchronization pattern driven by FrooxEngine, backed by a cloud infrastructure (SkyFrost) for account management and asset discovery. To pivot this into a true serverless, P2P web app, centralized storage and data synchronization are replaced entirely by decentralized Web APIs.

| Architectural Component | Resonite (FrooxEngine Standard) | Resonite Lite (P2P Web Proposal) |
| --- | --- | --- |
| Data Model & Sync | Multi-core synchronized slot/component hierarchy running inside local database & Unity wrapper. | CRDT-based JSON state tree (using Yjs or Automerge) representing an entity-component hierarchy. |
| Networking Layer | Lidgren/WebSockets/Headless Server coordination. | WebRTC data channels for direct P2P state and audio streaming, orchestrated via a transient signaling server. |
| Asset Storage | SkyFrost Cloud Database / local caching (Assimp pipelines). | Local storage loading via Drag-and-Drop, W3C File System Access API, or ephemeral P2P chunk-sharing. |
| Scripting/Behaviors | ProtoFlux (Visual Dataflow execution engine). | Reactive Node-Graph compiler executing directly inside the browser's JavaScript runtime. |

## 2. Feature Adaptation Matrix for P2P Web

### 2.1 Data Sync via Reactive Hierarchical Slots

In Resonite, everything is a `Slot` containing `Components` that sync fields automatically via `Connector<T>` classes.

 Web Adaptation: The data model will use a Conflict-free Replicated Data Type (CRDT) document representing a scene graph. Each element in the graph maps to a visual representation in a WebGL/WebXR engine (such as Three.js or Babylon.js).
 P2P Implementation: When a user changes a field (e.g., modifying a scale value or position via a gizmo), the delta is broadcast instantly over a WebRTC Data Channel to all connected peers, ensuring identical state visualization without a central database.

### 2.2 Zero-Server Asset Distribution

Instead of hosting 3D models, textures, and audio files on a central cloud storage bucket:

 Local Injection: Users drag and drop glTF, GLB, or PNG files straight into the browser.
 P2P Seeding: When a user brings an object into a room, the file is broken into binary chunks and served to other room participants over WebRTC Data Channels using a BitTorrent-like architecture directly inside the browser.
 Ephemeral Persistence: The asset lives purely in the active memory or local `IndexedDB` cache of the participants. When everyone leaves and the session ends, the room data and memory are cleared.

### 2.3 Visual Scripting Engine (Web ProtoFlux)

Resonite's ProtoFlux drives runtime behaviors through impulse (execution flow) and data flows.

 Web Adaptation: The web application can represent these visual graphs as nested JSON objects inside the shared CRDT state tree.
 P2P Implementation: A custom interpreter will execute nodes natively in JavaScript, turning visual wires into event listeners and data streams that run identically on all clients. If a node triggers an update, it modifies the CRDT tree, which auto-syncs to peers.

### 2.4 Radial/Context Menus for Object Manipulation

The UIX-style radial menu is critical for creating, deleting, and modifying properties in real-time.

 Web Adaptation: This can be adapted using HTML5 Canvas overlays or CSS 3D Transforms mapped directly to the user's mouse or WebXR controller orientation. Interacting with the menu drives UI components over the P2P data layer to alter materials, toggle visibility, or spawn assets dynamically.

## 3. Recommended Agentic Development Stack (Antigravity Optimization)

When prompt-engineering and scaffolding this app with Antigravity and agentic coding tools, instruct the AI to utilize the following modern, specialized web libraries designed for serverless, real-time collaboration:

1. State Synchronization & Networking:  `Yjs` combined with `y-webrtc` (or `Automerge`). This automates 90% of the P2P sync math, letting Antigravity focus on building the features rather than resolving network race conditions.
 `peerjs` or `simple-peer` for simplifying the WebRTC connection abstraction.


2. Rendering Engine:  `Three.js` (with `@react-three/fiber` if you prefer a component-driven React architecture) or `Babylon.js` for native WebXR capability out of the box.
3. Local Storage & Cache:  Browser `IndexedDB` (via a wrapper like `dexie.js`) for persisting a user's private avatar and asset inventory locally on their own hardware between sessions.

---

### How to prompt Antigravity to get started:

If you want to kick off the coding phase with an agentic tool, you can pass it a prompt like this:

> "Scaffold a single-page React app using Vite and Three.js. Integrate Yjs and y-webrtc to create a shared 3D scene where multiple users can connect via a room ID in the URL. Represent objects in the scene as an entity-component JSON structure inside the Yjs shared type so that when one user moves a 3D box, its position syncs to all other peers in real time without a central database."