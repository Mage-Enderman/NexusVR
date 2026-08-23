# Changelog

All notable changes made during this session. Sorted by category.

---

## 🐛 Bug Fixes

### Loading Placeholder Text Upside Down (High)
- **`src/App.tsx`** — Removed redundant `spriteTexture.repeat.y = -1` and
  `spriteTexture.offset.y = 1` from `createLoadingPlaceholder`. These were
  ported from `VRRadialMenuMesh`/`SpatialPanelManager` (which use
  `PlaneGeometry` and DO need the extra flip) but are incorrect for
  `THREE.Sprite`, which uses its own billboard UV layout. `CanvasTexture`'s
  default `flipY = true` is sufficient for Sprites. Loading/importing
  placeholder text now renders right-side-up on desktop.

### Grabbable Inspector Checkboxes Freezing View (High)
- **`src/components/SceneInspectorWindow.tsx`** — Replaced all 6 native
  `<input type="checkbox">` elements in the Grabbable component section with
  `ToggleSwitch` components (the same custom `<span>`-based toggle used by
  Active, Persistent, and every other checkbox in the inspector). Native
  `<input>` elements steal browser focus from the CSS3DObject panel, breaking
  pointer event forwarding and freezing the view. The codebase already documents
  this pattern: "The reason we use `<span>` toggles instead of `<input>` ones
  (see ToggleSwitch for why)."

### Network Listener Leaks (Critical)
- **`src/App.tsx`** — Wrapped 5 leaked `net.on*()` calls in `disposers.push()`:
  `onTransform`, `onMaterialUpdate`, `onSpawn`, `onAvatar`, `onVideoState`.
  Previously these were never cleaned up on unmount, causing every network event
  to fire twice per event in React StrictMode dev mode and leaking listeners
  permanently in production.

### Stale Closure in VR HUD Chat Handler (High)
- **`src/App.tsx`** — Added `showChatPanelRef` (mirrors existing `showRadialMenuRef`
  pattern) so the VR HUD card-click callback reads the current value instead of the
  initial `true` captured by the `[]`-deps effect closure. The unread chat badge
  now resets correctly from VR card clicks.

### No-op setPeerCount Hack (High)
- **`src/App.tsx`** — Replaced `setPeerCount(prev => prev)` (causes unnecessary
  full-tree re-renders) with a dedicated `muteBump` state counter. The VR menu
  mute icon now updates via a targeted re-render instead of forcing a full App
  re-render on every mute toggle.

### Mesh Renderer / Active State Coupled on Primitives (Medium)
- **`src/engine/AssetManager.ts`** — Primitives (cube, torus, sphere, etc.) are now
  wrapped in a `THREE.Group`. The Group becomes `object3d`, the Mesh is a child.
  Previously the Mesh WAS `object3d`, so toggling "Mesh Renderer" off also set
  the root invisible — the same property "Active" reads.
- **`src/components/SceneInspectorWindow.tsx`** — `handleToggleMeshEnabled` now
  traverses only **children** of `object3d` (not the root itself). Same fix applied
  to `meshEnabled` state derivation in both `useEffect` hooks.
- **`src/handlers/createPanelActionHandler.ts`** — Added `inspect.toggle:meshRenderer`
  action that toggles only child mesh visibility. Fixed `inspect.toggle:visible` to
  also only affect child meshes (was previously identical to `inspect.toggle:active`).
- **`src/engine/VRHUDManager.ts`** — BASIC section: renamed "VISIBLE" → "MESH REN"
  with `inspect.toggle:meshRenderer`. Fixed "ACTIVE" button to read `o3d.visible`
  (was reading stale `userData.active`). MESH STATS section: renamed "VISIBLE" →
  "MESH REN" with the same action.

### All Videos Upside-Down in Three.js (Critical)
- **Root cause:** Every video displayed upside-down in NexusVR while playing
  correctly in browser/VLC/Discord. The browser applies a Y-axis flip during
  `<video>` element compositing that Three.js's `Texture.flipY` doesn't
  compensate for when reading raw video frames. This is a systematic issue
  affecting all videos, not related to MP4 rotation metadata.
- **`src/engine/AssetManager.ts`** — Added `screenMesh.scale.y = -1` to both
  `loadVideo` and `loadVideoFromStreamedSource` to flip the video mesh
  vertically. All previous tkhd rotation detection code (detectVideoRotation,
  drawVideoRotated, videoRotationRad, mesh rotation conditions) removed.
- **`src/components/VideoObjectControls.tsx`** — Added ↕️ Flip button and
  `onFlip`/`isFlipped` props so users can manually toggle the Y-flip for
  any video that doesn't display correctly.
- **`src/App.tsx`** — Wired the flip button to toggle `screenMesh.scale.y`
  between 1 and -1 on the active video's screen mesh.
- **Deleted** `src/utils/detectVideoRotation.ts` — no longer needed.
- **Cleaned** `src/services/VideoStreamingService.ts` and
  `src/components/AssetImportDialog.tsx` — removed all rotation detection
  remnants (MP4Info matrix field, _detectedRotation, detectVideoRotation
  calls).

### Video Auto-Play Despite "Do NOT Autoplay" Comment (Medium)
- **`src/engine/AssetManager.ts`** — Removed `video.play().catch(() => {})` from
  both `loadVideo` and `loadVideoFromStreamedSource`. A ~20-line comment block
  explicitly says "Do NOT autoplay" and "Imports always start PAUSED + MUTED," but
  these calls contradicted that design intent. Videos now start paused as intended.

### Video Ended Event Not Updating Play/Pause Icon (Medium)
- **`src/engine/AssetManager.ts`** — Added `onVideoPlaybackChangedCallbacks` set and
  `registerOnVideoPlaybackChanged()` method. Both `ended` event handlers (in
  `loadVideo` and `loadVideoFromStreamedSource`) fire this callback.
- **`src/App.tsx`** — Registered a callback that bumps `setSelectedAsset({...sel})`
  when the ended asset is selected, triggering a React re-render so the play/pause
  button icon flips from "Pause" to "Play."

### Inspector Panel Stomped by Duplicate Spawn
- **`src/components/SceneInspectorWindow.tsx`** — Added `instanceId` prop. Changed
  `panelId="inspector"` → `panelId={instanceId ?? 'inspector'}`. Previously every
  new inspector destroyed the previous one's CSS3DObject panel in
  `SpatialPanelManager` because they all shared the same hardcoded ID.
- **`src/App.tsx`** — Passes `instanceId={instance.id}` (unique per instance) to
  each `<SceneInspectorWindow>`.

### UI Not Scaling to Different Viewport Sizes (High)
- **`src/index.css`** — Added responsive display utility classes (`hidden`, `block`,
  `sm:hidden`, `md:hidden`, `lg:hidden`, `sm:flex`, `md:flex`, `lg:flex`, etc.)
  with proper CSS colon escaping. Added `max-h-[40vh]`, `max-h-[50vh]`,
  `max-h-[60vh]`, `max-w-[95vw]`, `max-w-[90vw]` utilities.
- **`src/components/Navbar.tsx`** — Added `flex-wrap` to the header and actions bar
  so they stack vertically on narrow viewports. Changed `justify-between` to
  `justify-center`. Hid lower-priority buttons below `lg` (Save/Load Room, Pair
  Device, Enter VR). Hid button text labels below `md` (Dash, Invite/Share, Chat,
  1st Person Mode) for icon-only display. Added `max-w-[95vw]` and `max-w-full`
  constraints to prevent horizontal overflow.
- **`src/components/Toolbar.tsx`** — Added `flex-wrap justify-center` to the main
  toolbar bar. Hid button text labels below `md` (Primitives, Inventory, Tools,
  Import File). Hid Context Menu button below `lg`. Added `max-w-[95vw]` to the
  outer container and `max-h-[50vh] overflow-y-auto` as a safety net for vertical
  wrapping.

---

## ✨ Features

### Portal-Based Tooltip System for Toolbar & Navbar (Medium)
- **`src/components/Tooltip.tsx`** (new) — Portal-based Tooltip component that
  renders tooltip text via `ReactDOM.createPortal` to `document.body`, escaping
  `overflow: hidden` clipping contexts. Tracks the trigger element position with
  `getBoundingClientRect()`, renders a fixed-position tooltip above the element.
  Shows on hover and focus (keyboard accessible). 150ms fade-in, styled to match
  the glass-panel theme (dark glass background, cyan border, subtle shadow).
- **`src/components/Navbar.tsx`** — All 9 buttons wrapped with `<Tooltip>` component
  with concise descriptive labels replacing native `title` attributes.
- **`src/components/Toolbar.tsx`** — All 13 buttons wrapped with `<Tooltip>` component
  including dynamic values for collision state and gizmo space.

### Grabbable Component System (High)
- **`src/components/grabbable/GrabbableComponent.ts`** (new) — Resonite-faithful
  component that gates whether an object can be grabbed. Defines
  `GrabbableComponent` interface with fields: `enabled`, `scalable`,
  `allowSteal`, `grabPriority`, `editModeOnly`, `destroyOnRelease`,
  `reparentOnRelease`, `preserveUserSpace`, `dropOnDisable`, `allowedUsers`.
  Helper functions: `getGrabbable()`, `isGrabbable()`, `isScalable()`,
  `setGrabbable()`, `serializeGrabbable()`, `deserializeGrabbable()`.
  Backward-compatible with legacy `userData.grabbable` boolean.
- **`src/engine/ManipulationManager.ts`** — RMB grab `onPointerDown` now checks
  `isGrabbable()` before calling `beginGrab`. Objects without an enabled Grabbable
  component are not grabbable on desktop.
- **`src/App.tsx`** — VR grip grab (`tryVrGrab`) now checks `isGrabbable()` before
  calling `vrGrabWithController`. Two-handed scale grab checks `isScalable()`.
- **`src/hooks/useKeyboardShortcuts.ts`** — Dev tool key `7` now uses
  `getGrabbable()`/`setGrabbable()` instead of raw `userData.grabbable` boolean.
- **`src/components/SceneInspectorWindow.tsx`** — Full Grabbable component section
  with `ToggleSwitch` toggles for all boolean fields + GrabPriority number input.
- **`src/services/NetworkService.ts`** — Added `grabbable` field to `AssetSpawnData`
  and `InspectorUpdateData` interfaces.
- **`src/App.tsx`** — All spawn broadcasts, scene snapshots (late-join sync),
  and inspector updates now include/apply grabbable state. All receive paths
  (primitive, file import, URL import, streamed video) restore grabbable
  from network data.
- **`docs/SYSTEMS_DOCUMENTATION.md`** — New section 5b: Grabbable Component.
- **`FEATURES.md`** — New Grabbable Component feature entry.

### "Bring to Me" Button Wired (Medium)
- **`src/components/SpatialPopUpWrapper.tsx`** — Added `onBringToMe` callback prop.
  When provided, the header "Bring" button calls it (teleports the inspected
  asset to in front of the camera) AND repositions the panel. Updated tooltip
  to reflect the dual behavior.
- **`src/components/SceneInspectorWindow.tsx`** — Passes `onBringAsset` as
  `onBringToMe` to `SpatialPopUpWrapper`, so the header "Bring" button now
  teleports the inspected asset + broadcasts the new transform to peers.
- **`FEATURES.md`** — Updated "Bring to me" status from "Not fully wired" to ✅.

### Multi-Instance Scene Inspector
- **`src/App.tsx`** — Replaced `showSceneInspector: boolean` with
  `inspectorInstances: Array<{id, pinnedAsset}>`. Each inspector is an independent
  instance pinned to its asset at spawn time.
  - New `openInspectorForAsset(asset)` spawns a pinned inspector.
  - New `closeInspectorInstance(id)` closes a specific instance.
  - All 5 spawn points updated: VR HUD panel, keyboard `O`, VR radial menu,
    toolbar button, desktop radial menu.
  - Keyboard `O` changed from toggle to always-spawn-new.
  - Per-instance callbacks: `onSelectAsset`, `onUpdateAsset`, `onDeleteAsset`.
  - `handleDeleteSelected` accepts optional `targetAsset` param; auto-closes
    any inspector pinned to the deleted asset.

### Video Playback State Callback
- **`src/engine/AssetManager.ts`** — New `registerOnVideoPlaybackChanged(cb)`
  subscription mechanism for video state changes that happen outside the normal
  `applyVideoState` path (currently: the `ended` event).

---

## ♻️ Refactoring

### Keyboard Handler Extraction
- **`src/hooks/useKeyboardShortcuts.ts`** (new, ~398 lines) — Extracted from App.tsx:
  - The entire keyboard `useEffect` (~180 lines of keydown/keyup handling)
  - `handleSaveSelectedToInventory` (Ctrl+S)
  - `handleDuplicateSelected` (Ctrl+D)
  - `plainPasteModeRef` safety net
- **`src/App.tsx`** — Reduced from ~5,072 → ~4,768 lines (~304 lines removed).
  Hook call sits after all dependencies. Typed params object with zero hidden
  coupling.

---

## 🧹 Cleanup

### Duplicate Files Deleted
- **`src/components/SceneInspectorWindow-.tsx`** — Duplicate of SceneInspectorWindow
- **`src/components/SceneInspectorWindow-old.tsx`** — Old copy of SceneInspectorWindow
- **~4,000 lines of dead code removed**

### Stale Root Files Deleted
- Removed 30+ stale/orphaned files from project root: `nul`, temp scripts, old
  copies, debug snippets

### EnvironmentManager Typing
- **`src/engine/SceneEngine.ts`** — Changed `environmentManager: any` →
  `environmentManager: EnvironmentManager | null`

### @types Moved to devDependencies
- **`package.json`** — Moved `@types/canvas-confetti` and `@types/three` from
  `dependencies` to `devDependencies`

### Window Global Type Declarations
- **`src/types/globals.d.ts`** (new) — Typed declarations for
  `window.__isRadialMenuOpen`, `window.__NEXUS_VR_PRESENTING`,
  `window.__vrRadialDebug`

### `as any` Casts Removed
- **`src/components/VideoObjectControls.tsx`** — Removed `as any` casts on
  `beginVolumeScrub` and `beginScrub` event handler props

### Clarifying Comments
- **`src/App.tsx`** — Added `// skip to next asset` comments on `return` statements
  inside `forEach` callbacks (correct but confusing without annotation)
- **`src/services/NetworkService.ts`** — Added explanatory comment to empty
  `catch {}` block

### Error Handling
- **`src/App.tsx`** — Wrapped `fetch()` in try/catch with `response.ok` check and
  user-facing alert on failure

### useEffect Dependency Cleanup
- **`src/App.tsx`** — VRHUD `setDataContext` useEffect: added missing `userName` /
  `localRole` deps, removed 4 duplicated entries

### Audit Document
- **`BUG_AUDIT.md`** (new) — Comprehensive audit of 14 issues found across the
  codebase with severity ratings, file locations, and suggested fixes
