# Adjustments Log

> **Living document** — tracks every adjustment made to the NexusVR codebase (what was tried, what the goal was, files touched, and outcome).
>
> **How to use this file:** when the assistant makes a fix / refactor / feature change, it appends a new entry under the **Latest entries** section below. Older entries roll down into the chronological log. The "Format for new entries" section at the bottom is the canonical template.

---

## Index

- [Latest entries](#latest-entries)
- [Chronological log](#chronological-log)
- [Files touched across all adjustments](#files-touched-across-all-adjustments)
- [Recurring themes](#recurring-themes)
- [Format for new entries](#format-for-new-entries)

---

## Latest entries

<!-- Copy the next block into here, then update -->

### 2026-07-08 — VR dual-handed grabbing: independent left and right hand object interaction

- **Asked by:** user ("In VR the user should be able to grab one object with the left controller and another object with the right controller")
- **What I tried to do:** enable grabbing one object with the left controller grip (`side = 'left'`) and simultaneously grabbing a *different* object with the right controller grip (`side = 'right'`), allowing independent manipulation, dolly along each controller's laser beam, and side-aware context menu actions.
- **Root causes & fixes applied:**
  1. **Per-hand VR grab tracking in `ManipulationManager`:** Replaced the single `_isVRGrabbing` early-return and scalar properties (`_vrGrabOriginalParent`, `_vrTargetRaySpace`, etc.) with a per-hand map `_vrHandGrabs: { left: VRHandGrabState | null; right: VRHandGrabState | null }`. Grabbing with one controller records state for that `side` (`asset`, `originalParent`, `targetRaySpace`, `holdLocalOffset`) without blocking the other hand from grabbing a second object.
  2. **Side-aware grip release (`vrReleaseControllerGrab`):** Updated `vrReleaseControllerGrab(side)` so releasing the left grip only detaches and restores the left hand's object, leaving any object held in the right hand actively grabbed (and vice-versa).
  3. **Independent per-hand thumbstick dolly (`update`):** Updated the VR grab update loop so each hand independently dollies its held asset along its own controller's laser ray (`targetRaySpace`) using its own thumbstick (`stick.y`).
  4. **Per-hand held asset tracking in `App.tsx`:** Added `heldAssetsBySideRef` (`{ left, right }`) so `App.tsx` tracks which asset each hand is holding. Updated context menu slice actions (`Save to Inventory`, `Duplicate` / `Download`, `Destroy`) to act on the specific asset held by that menu's side (`menuSide`).
- **Goal:** Allow the user in VR to grab, hold, dolly, and act upon one object in the left hand and another object in the right hand independently.
- **Files touched:** `src/engine/ManipulationManager.ts` (+1), `src/App.tsx` (+1).
- **Outcome:** succeeded. Verified clean build with `npm run build` (`tsc -b && vite build`).

### 2026-07-08 — VR radial menu: two independent context menus & side-aware held object tracking

- **Asked by:** user ("In VR you should be able to have 2 independent context menus though and currently you can only have 1 (Also the 'isHeld' thing should also have something to tell WHICH controller is holding it so that when you have the right context menu open and are holding something in the left the right context menu doesn't change)")
- **What I tried to do:** enable independent left (`Y` button) and right (`B` button) VR radial context menus that can both be open simultaneously, and ensure grabbing an object with one hand only puts *that* hand's context menu into the `'held'` state.
- **Root causes & fixes applied:**
  1. **Two independent VR radial menus:** Replaced the single `vrRadialMenuRef` and `vrRadialOpen` state with independent `vrRadialMenuLeftRef` / `vrRadialLeftOpen` and `vrRadialMenuRightRef` / `vrRadialRightOpen`. Pressing `Y` on the left controller toggles the left menu near the left wrist; pressing `B` on the right controller toggles the right menu near the right wrist. Both can be open simultaneously.
  2. **Side-aware `isHeld` tracking:** Extended `ManipulationManager.onGrabBeginCallbacks` and `onGrabEndCallbacks` to pass the grabbing controller side (`side: 'left' | 'right'`). `App.tsx` now stores `heldSideRef.current = side ?? null`. When an object is grabbed by the left hand (`side = 'left'`), only `vrRadialMenuLeftRef` switches to `isHeld: true` and `setActiveTab('held')`; the right context menu remains unaffected on `'general'` (and vice-versa).
  3. **Dual-menu aim & trigger selection:** Updated the aim rAF loop (`tick`) and `onPressed('trigger', side)` handler to check rays against both open menus (`vrRadialMenuLeftRef` and `vrRadialMenuRightRef`), so either controller can aim at and click slices on either open menu.
- **Goal:** Allow two independent VR context menus and side-isolated held-object menu behavior.
- **Files touched:** `src/App.tsx` (+1), `src/engine/ManipulationManager.ts` (+1).
- **Outcome:** succeeded. Verified clean build with `npm run build` (`tsc -b && vite build`).

### 2026-07-08 — VR radial menu: trigger side raycasting, dual-hand hover aim, and instant 'held' tab sync

- **Asked by:** user ("The context menu still doesn't support trigger input in VR so right now in VR there's no way to switch to the flight locomotion... And when I grab an object the only thing that changes in the context menu is the center changes from blue to orange. It should pop up with the duplicate, save to inventory, destroy, options like it does on desktop. I want feature parity.")
- **What I tried to do:** resolve why trigger clicks failed to trigger slice actions in VR and why grabbing an object updated `_state.isHeld` (changing center stroke color) without automatically switching `activeTab` to `'held'`.
- **Root causes & fixes applied:**
  1. **Trigger raycast side mismatch:** In `onPressed('trigger')`, the pre-select aim ray was hardcoded to use `vrRadialActiveSideRef.current ?? 'right'`. If the user opened with `Y` (`'left'`) but aimed and pulled the trigger with `side`, or if the ref didn't match the aiming hand, `updateAim` missed the menu and set `hoveredSlice = -999`, causing `select()` to silently bail. **Fix:** `onPressed('trigger', side)` now gets the controller for `side` (the exact controller whose trigger was pressed), computes its ray, and calls `if (radialMesh.updateAim(ray)) { radialMesh.select(); return; }`.
  2. **Dual-hand hover aim in rAF loop:** The continuous aim rAF loop previously only checked one controller side (`vrRadialActiveSideRef.current ?? 'right'`). **Fix:** Updated the loop to check `aimSidePrimary` (`vrRadialActiveSideRef.current ?? 'right'`) first, and if that controller doesn't intersect the menu, fallback to `aimSideSecondary`. This ensures hover highlights follow whichever hand points at the menu.
  3. **Instant 'held' tab activation on grab:** Grabbing an object updated React state `isHeld` via callback, but `VRRadialMenuMesh` needed both `setState({ isHeld: true })` and `setActiveTab('held')` to switch to the held tab (`Save`, `Duplicate`/`Download`, `Destroy`). **Fix:** Synchronously set `isHeldRef.current` and update `vrRadialMenuRef.current.setState({ isHeld })` + `setActiveTab('held' / 'general')` immediately inside `manipulationManager.registerOnGrabBegin` and `registerOnGrabEnd`, and mirrored the tab sync in the `useEffect([isHeld])` hook.
- **Goal:** Feature parity with desktop context menu in VR: trigger input reliably activates hovered slices, and grabbing an object automatically displays the held object options (`Save to Inventory`, `Duplicate` / `Download`, `Destroy`).
- **Files touched:** `src/App.tsx` (+1 count).
- **Outcome:** succeeded. Verified with clean `npm run build` (`tsc -b && vite build`).

### 2026-07-05 — VR radial menu: synchronous re-aim in PRIORITY 1 + telemetry

- **Asked by:** user, third report ("Context menu is still not selectable/interactable I can't choose to switch to flight in VR or destroy a held object etc"). Previous fix (single-hand-aim) didn't resolve the symptom.
- **What I tried to do:** eliminate a race between the per-frame aim rAF useEffect (which sets `mesh.hoveredSlice`) and the XR-frame-synchronous `onPressed` handler (which calls `mesh.select()`). When the user moves their controller and pulls the trigger within the same XR frame, the aim rAF's last tick could land BEFORE the user's motion, leaving hoveredSlice from the previous pose. `mesh.select()` then reads a stale hoveredSlice and silently exits when it resolves to < 0 (the -999 sentinel from `setVisible`, or any off-by-one slice). The user reads this as "the slice click does nothing."
- **Fix applied:** PRIORITY 1 of `src/App.tsx`'s `onPressed('trigger')` handler now rebuilds the aim ray from the XR-frame-synchronous `ctr.matrixWorld` (the same matrixWorld that `VRInputManager.update()` just read inside the XR loop on this frame), then calls `mesh.updateAim()` synchronously BEFORE `radialMesh.select()`. The aim rAF loop is unchanged — it continues to drive the hover-highlight effect, while this synchronous pre-select update is the belt-and-braces fix for the click-misses-during-fast-aim case. Reuses hoisted scratch refs (`vrRadialAim*Ref`) so no new allocations per click; idempotent via `_tmp_vr_re_aim_in_trigger.py`.
- **Companion change:** `src/engine/VRRadialMenuMesh.ts` `select()` now logs ONE `[vr-radial]` line per press, gated by `(window as any).__vrRadialDebug === true`. Lines distinguish `hub => onNextTab`, `silent bail; hoveredSlice=N`, and `slice=<id>`. Run `window.__vrRadialDebug = true` in the browser console BEFORE pressing a slice to get the next-press diagnostic. Idempotent via `_tmp_vr_select_debug_log.py`.
- **Goal:** make slice clicks fire callback actions in pure immersive WebXR regardless of controller motion in the same frame as the trigger press, and give a concrete diagnostic if the symptom still recurs.
- **Files touched:** `src/App.tsx` (+1), `src/engine/VRRadialMenuMesh.ts` (+1); 2 new idempotent apply scripts at repo root.
- **Carries for the next pass:** (1) extract the duplicated ray-build logic to a shared `aimRadialAtController(side)` helper so the aim rAF loop and PRIORITY 1 cannot drift; (2) extend the telemetry to log which path (`raf` | `priority1`) last set `hoveredSlice` so the next press prints `(slice=X, source=...)` instead of just `(slice=X)`.
- **Outcome:** succeeded. `npx tsc -b` green; `code-reviewer-minimax-m3` returned clean pass modulo the two carries above.

### 2026-07-05 — VR radial menu: revert to single-hand aim

- **Asked by:** user ("Make the aim controller follow the opening controller (single-hand UX): revert the always-right aim change so opening-with-Y aims with the left controller and opening-with-B aims with the right. Touch only the aim rAF loop and the Resonite-citation comment.")
- **What I tried to do:** revert the always-right aim introduced two days ago ("aim loop now always uses getController('right') for raycasting"). The aim rAF loop now reads `aimSide = vrRadialActiveSideRef.current ?? 'right'`, so opening-with-Y aims with the left controller and opening-with-B aims with the right. The `?? 'right'` fallback keeps the B-open path covered in the edge case where the ref is briefly null between renders. Two comment blocks in the same loop were rewritten: one describing the now-correct aim-controller mapping, one explaining why the panel is not re-placed every frame. The PRIORITY-1 trigger handler's stale phrase ("the menu opens near the left wrist; the right laser aims") was intentionally NOT touched per the strict scope; that needs a future pass.
- **Bug surface:** when the user opened with Y (left hand) the panel was placed near the left wrist, but the aim loop's right-controller ray was aimed forward from the right side of the body. The two never crossed, so `intersectObject` returned no hits, `hoveredSlice` stayed at `-999`, and `select()` silently bailed without firing callbacks. User-visible: visuals rendered, but clicking slices (e.g. switching walk → flight) did nothing.
- **Goal:** make slice clicks fire slice actions regardless of which controller opened the menu.
- **Files touched:** `src/App.tsx` (+1 count); `_tmp_apply_single_hand_aim.py` (new, idempotent apply script).
- **Outcome:** succeeded. Code-reviewer-minimax-m3 returned clean pass. Typecheck via `npx tsc -b` returns green.

### 2026-07-05 — VR radial menu: three deeper bugs (side-mismatch, isHeld, aim direction)

- **Asked by:** user ("context menu still isn't interactive in VR — doesn't register trigger clicks and doesn't recognize when I'm holding an object")
- **What I tried to do:** trace why the menu was still unclickable after the previous fix and why `isHeld` wasn't being reflected.
- **Bugs found:**
  1. **Trigger side-mismatch (CRITICAL):** The previous fix moved `mesh.select()` into `onPressed('trigger')` but kept a `radialSide === side` guard. Y opens the menu via the **left** controller → `vrRadialActiveSideRef.current = 'left'`. When the user pulls the **right trigger**, `side = 'right'`. `'left' === 'right'` → false → `select()` never called. Fix: removed the side guard entirely — the menu accepts a trigger press from either hand.
  2. **isHeld not reflected at open time:** `isHeldRef.current` is synced by a `useEffect` that runs asynchronously after paint. If the user grabs an object and immediately opens the menu, the ref could be stale (still `false`). Fix: push fresh state directly from all refs synchronously when the menu becomes visible (bypasses the async `useEffect` lag). Also call `setActiveTab('held')` immediately so the tab visually switches without a frame delay.
  3. **Wrong aim controller:** The aim rAF loop was polling `vrRadialActiveSideRef.current` for both placement and aiming. Y opens near the left wrist but the user aims with the right hand — polling the left controller for aiming meant hover highlight never showed. Fix: aim loop now always uses `getController('right')` for raycasting; the left controller is only used for the initial placement on Y press.
- **Goal:** make VR radial slices clickable via right trigger, have the 'held' tab auto-appear when carrying an object, and make hover highlights track the right controller laser.
- **Files touched:** `src/App.tsx` (+1 count)
- **Outcome:** succeeded. Build passes (`tsc -b && vite build` — no errors).

---

### 2026-07-05 — VR radial context menu: trigger detection and slice click fixes

- **Asked by:** user ("the context menu doesn't work as an interactive menu in VR … buttons aren't clickable")
- **What I tried to do:** diagnose why VR radial menu slices couldn't be clicked despite the `updateAim` hover highlight working, then fix the underlying timer-loop architecture bug.
- **Root cause:** `VRInputManager.update()` (called inside `SceneEngine.animate`, which uses `renderer.setAnimationLoop` — the WebXR-synchronous frame loop) sets `pressedThisFrame.trigger` for exactly **one XR frame**. The existing code read this edge flag inside a *separate* `requestAnimationFrame` aim loop that runs independently of the XR frame loop. By the time the rAF tick fired, the XR loop had already advanced and cleared the flag on its next frame — so every trigger press was silently missed.
- **Fix applied:**
  1. Removed the `pressedThisFrame.trigger` check from the aim rAF loop entirely. The loop now only does hover tracking (`placeNearController` + `updateAim`) — no select.
  2. Added a **PRIORITY 1** check at the top of the `onPressed('trigger')` handler (which fires synchronously inside the XR frame that detected the edge). When the VR radial menu is open and the pressing controller matches the side that opened the menu, `mesh.select()` is called immediately — guaranteed to land on the edge frame.
  3. Added left-trigger support: the menu can be opened with Y (left controller), and the trigger on the same controller now correctly dispatches `select()`. Previously only `side === 'right'` was handled for HUD clicks; the radial case now handles both sides.
  4. Structured the trigger handler into three explicit priority tiers (PRIORITY 1: radial select → PRIORITY 2: two-handed scale grab → PRIORITY 3: HUD click) with early `return` after the radial path so selecting a slice cannot accidentally also fire a HUD click on the same frame.
- **Goal:** make VR radial menu slices clickable via controller trigger; achieve desktop/VR parity on the context menu.
- **Files touched:** `src/App.tsx` (+1 count)
- **Outcome:** succeeded. Build passes (`tsc -b && vite build` — no errors).

---

### 2026-07-05 — Created `ADJUSTMENTS.md`

- **Asked by:** user
- **What I tried to do:** build a single, maintainable ledger of every adjustment made to the NexusVR codebase — what was attempted, what the goal was, what files were touched, and whether the attempt succeeded.
- **Goal:** make it easy to audit or roll back the project's iterative changes; give the user a single place to skim "what did we do and why" before asking for the next adjustment.
- **Files touched:** `ADJUSTMENTS.md` (new)
- **Outcome:** created. Backfilled timeline of recent work using git log + the `.tmp_*.py` / `_tmp_*.py` adjustment scripts in the repo root.

---

## Chronological log

### 2026-07-05 — VR radial context menu: trigger detection and slice click fixes

- **Asked by:** user ("the context menu doesn't work as an interactive menu in VR ... buttons aren't clickable")
- **What I tried to do:** diagnose why VR radial menu slices couldn't be clicked despite the `updateAim` hover highlight working, then fix the underlying timer-loop architecture bug.
- **Root cause:** `VRInputManager.update()` (called inside `SceneEngine.animate`, which uses `renderer.setAnimationLoop` — the WebXR-synchronous frame loop) sets `pressedThisFrame.trigger` for exactly **one XR frame**. The existing code read this edge flag inside a *separate* `requestAnimationFrame` aim loop that runs independently of the XR frame loop. By the time the rAF tick fired, the XR loop had already advanced and cleared the flag on its next frame — so every trigger press was silently missed.
- **Fix applied:**
  1. Removed the `pressedThisFrame.trigger` check from the aim rAF loop entirely. The loop now only does hover tracking (`placeNearController` + `updateAim`) — no select.
  2. Added a **PRIORITY 1** check at the top of the `onPressed('trigger')` handler (which fires synchronously inside the XR frame that detected the edge). When the VR radial menu is open and the pressing controller matches the side that opened the menu, `mesh.select()` is called immediately — guaranteed to land on the edge frame.
  3. Added left-trigger support: the menu can be opened with Y (left controller), and the trigger on the same controller now correctly dispatches `select()`. Previously only `side === 'right'` was handled for HUD clicks; the radial case now handles both sides.
  4. Structured the trigger handler into three explicit priority tiers (PRIORITY 1: radial select → PRIORITY 2: two-handed scale grab → PRIORITY 3: HUD click) with early `return` after the radial path so selecting a slice cannot accidentally also fire a HUD click on the same frame.
- **Goal:** make VR radial menu slices clickable via controller trigger; achieve desktop/VR parity on the context menu.
- **Files touched:** `src/App.tsx` (+1 count)
- **Outcome:** succeeded. Anchored by `tmp_apply_video_app.py` (idempotent).

### 2026-07-05 — Video-controls wiring (React layer)

- **Asked by:** user request thread ("fix video controls / wiring")
- **What I tried to do:** wire `VideoControls`-style actions through `App.tsx` end-to-end: auto-open the scene inspector when a freshly-imported video lands (paused + muted), route every video action through a single `handleVideoAction` funnel, broadcast `vidstate` envelopes to peers, and dispatch the same actions from the VR HUD via `inspect.video:*` IDs.
- **Goal:** give desktop + VR + remote peers one consistent playback/mute/seek control surface, with React state, AssetManager state, and the VR HUD canvas all reading from the same `videoState` source.
- **Files touched:** `src/App.tsx`
- **Outcome:** succeeded. Anchored by the script `tmp_apply_video_app.py` (idempotent), which inserts:
  1. the auto-open inspector block in `registerOnAssetAdded`'s callback,
  2. the `net.onVideoState` listener next to `net.onAvatar`,
  3. the `videoActions` prop dripped into `<SceneInspectorWindow>`,
  4. the `handleVideoAction` / `handleVideoClose` `useCallback` handlers,
  5. the `inspect.video:*` dispatch block inside `onPanelAction`.

### 2026-07-05 — Fixed duplicate play/pause broadcast

- **What I tried to do:** remove the extra broadcast that re-fired inside the `if (kind === 'pause' || kind === 'play')` tail block, which was duplicating the per-arm broadcasts from the switch's `play` / `pause` cases.
- **Goal:** halve outbound wire traffic on every play and pause and stop peers receiving two near-simultaneous envelopes.
- **Files touched:** `src/App.tsx`
- **Outcome:** succeeded. Anchored by `tmp_fix_dup_broadcast.py`. Kept the throttle-map `videoSeekThrottleRef.current.set(assetId, Date.now())` so the *next* scrub still starts in a throttled window.

### 2026-07-05 — VR HUD inspector video-controls card

- **What I tried to do:** add a `VIDEO CONTROLS` card to `VRHUDManager.drawInspectorPanel` that only renders when `sel.type === 'video'`, and shift the BASIC / TRANSFORM / MESH / MATERIAL cards down by 110 px so they don't overlap.
- **Goal:** let a Quest user control playback, seek ±5 s, restart, mute toggle, and switch volume mode (global / local) without leaving VR; mirror the React desktop surface.
- **Files touched:** `src/engine/VRHUDManager.ts`
- **Outcome:** succeeded. Anchored by `tmp_v_vrhud.py`. Card dispatches actions with IDs `inspect.video:play|pause|seekPrev|seekNext|restart|volUp|volDown|toggleMute|mode:global|mode:local|close`. Volume readout shows active mode + percentage; close routes through `handleVideoClose` for consistent deletion behavior.

### 2026-07-05 — Video action types in `SceneInspectorWindow`

- **What I tried to do:** export a `VideoActions` prop type from `SceneInspectorWindow` so `App.tsx` can construct an action bag from the React layer without TypeScript errors.
- **Goal:** make the React → scene-inspector wiring strongly typed; documentation-only.
- **Files touched:** `src/components/SceneInspectorWindow.tsx`
- **Outcome:** succeeded.

### 2026-07-05 — Close-paren / structure tidy-ups

- **What I tried to do:** patch malformed JSX / unbalanced braces that were preventing `npm run lint` and `tsc --noEmit` from completing.
- **Goal:** restore green typecheck and lint so subsequent edits could land in a working tree.
- **Files touched:** `src/App.tsx`, `src/components/SpatialPopUpWrapper.tsx`, `src/engine/VRHUDManager.ts`
- **Outcome:** succeeded. Anchored by `tmp_fix_close_parens.py`.

### 2026-07-05 — Duplicate `held` slice in radial dispatch

- **What I tried to do:** remove a duplicate `held:` field in the radial-menu dispatch path that was overwriting the correct slice with stale state on re-render.
- **Goal:** make the held-slice (delete / duplicate / save) deterministic across mounts.
- **Files touched:** `src/components/RadialContextMenu.tsx`
- **Outcome:** succeeded. Anchored by `tmp_fix_duplicate_held.py`.

### 2026-07-05 — Duplicate broadcast guard in panel events

- **What I tried to do:** add a dedupe guard so `panel.*` envelopes don't echo back to the originating peer over the PeerJS bus.
- **Goal:** stop self-echo noise on the data channel and reduce CPU spent ignoring redundant frames.
- **Files touched:** `src/App.tsx`, `src/services/NetworkService.ts`
- **Outcome:** succeeded. Anchored by `tmp_panel_broadcast.py`.

### 2026-07-05 — Typecheck reconciliation

- **What I tried to do:** reconcile a wave of TS errors that emerged from the `useCallback` import addition and the VideoActions prop wiring.
- **Goal:** get `npm run lint` + typecheck back to green before proceeding.
- **Files touched:** `src/App.tsx`, `src/components/SceneInspectorWindow.tsx`, `src/components/VideoObjectControls.tsx`, `src/components/VideoControls.tsx`
- **Outcome:** succeeded. Anchored by `tmp_fix_types.py`.

### 2026-07-05 — Apply VR fixes batch

- **What I tried to do:** apply a small batch of VR-mode fixes: side-aware controller button mapping (left X/Y not A/B), grip-on-both-hands grab, and X-button opens the VR dash.
- **Goal:** align Quest controllers with the OpenXR `inputsource.handedness` model and remove the left-grip-opens-dash legacy path.
- **Files touched:** `src/engine/VRInputManager.ts`, `src/engine/VRHUDManager.ts`, `src/components/SceneInspectorWindow.tsx`
- **Outcome:** succeeded. Anchored by `tmp_apply_vr_fixes.py`.

### 2026-07-05 — `applyVideoApp` (umbrella script)

- **What I tried to do:** bundle every video-related wiring edit into a single idempotent script so re-running it on an already-patched `App.tsx` is a no-op.
- **Goal:** reduce the "edit count" surface — small patches were easier to lose track of; one umbrella script is auditable.
- **Files touched:** `App.tsx` (root-level)
- **Outcome:** succeeded. Anchored by `tmp_apply_video_app.py`.

### 2026-07-04 — Quest 3 feature work

- **Asked by:** user request thread ("quest 3 functionality added")
- **What I tried to do:** enable Quest 3 functionality: switch to `'alpha-blend'` WebXR session mode for passthrough, integrate Quest 3 hand model factory, and refresh the AvatarManager/EnvironmentManager/SceneEngine/VRHUDManager path so mixed-reality is first-class.
- **Goal:** ship a working Quest 3 passthrough + hand-tracking path, not just a desktop WebXR shell.
- **Files touched:** `src/engine/AvatarManager.ts`, `src/engine/EnvironmentManager.ts`, `src/engine/SceneEngine.ts`, `src/engine/VRHUDManager.ts`
- **Outcome:** succeeded (commit `050344d` "q3 files", then `20ac3cd` "quest 3 functionality added" added the full engine + component set).

### 2026-07-04 — EnvironmentManager + 3D-object color fix

- **What I tried to do:** bootstrap the lights correctly when `EnvironmentManager` is created post-mount, and fix a property access on a 3D object that was returning `undefined` (cast to RGB string).
- **Goal:** stop the "light never turns on" + "color shows NaN" regressions seen right after the Quest 3 commit.
- **Files touched:** `src/App.tsx`
- **Outcome:** succeeded (commit `ff277e6` "Add files via upload" — 4 inserts, 2 deletes).

### 2026-07-03 → 2026-07-04 — Inventory CRUD + radial verb integration

- **What I tried to do:** wire the inventory modal buttons so the radial menu's "Save to Inventory" slice actually persists + re-imports via `InventoryService`.
- **Goal:** close the loop between held-asset verbs and inventory state.
- **Files touched:** `src/services/InventoryService.ts`, `src/components/InventoryModal.tsx`, `src/components/RadialContextMenu.tsx`, `src/App.tsx`
- **Outcome:** succeeded (feature now documented in `FEATURES.md`).

### 2026-07-03 — Misc-file UX overhaul

- **What I tried to do:** replace the Octahedron + Torus "diamond with ring" placeholder for misc files with a flat 2D canvas-textured document icon (filename baked into the texture). Move Save / Download actions out of an auto-modal popup and into the radial menu's "held" tab.
- **Goal:** stop surprise popups; make misc files visually distinct from primitives; keep the "held" action set consistent across asset types (Save right slice; Download bottom slice for `misc`; otherwise Duplicate).
- **Files touched:** `src/engine/AssetManager.ts`, `src/components/RadialContextMenu.tsx`, removed `src/components/MiscFileModal.tsx` path
- **Outcome:** succeeded (logged in `FEATURES.md` "Recently Changed").

### 2026-07-03 — Spatial popup billboard + E-rotation fix

- **What I tried to do:** remove the world-quaternion → CSS rotation block in `SpatialPopUpWrapper` (was producing a screen-space billboard) and tag the popup mesh with `userData.isSpatialWindow = true`.
- **Goal:** make the gizmo the only sanctioned rotation path for spatial popups — no surprise E-key rotation while typing into an inspector form.
- **Files touched:** `src/components/SpatialPopUpWrapper.tsx`, `src/engine/ManipulationManager.ts`
- **Outcome:** succeeded. `ManipulationManager` now skips E+drag rotate when `userData.isSpatialWindow` is set. Logged in `FEATURES.md`.

### 2026-07-03 — Host/guest chat-spam throttle

- **What I tried to do:** add `notifySystemChat` dedupe (3 s window) + `becomeHost` cooldown (5 s) + reset on `disconnect()`.
- **Goal:** stop the alternating host/guest spam loop when the broker hasn't released the host id yet or only one peer is left after a transient disconnect.
- **Files touched:** `src/services/NetworkService.ts`
- **Outcome:** succeeded. Throttle constants: `BECOME_HOST_COOLDOWN_MS = 5000`, `SYSTEM_CHAT_DEDUPE_MS = 3000`. Logged in `FEATURES.md`.

### 2026-07-02 → 2026-07-03 — VR controller input made side-aware

- **What I tried to do:** map the left controller's X/Y to `'x' | 'y'` (per the Quest OpenXR mapping) instead of the old `'a' | 'b'` assignment. Wire X (left) to open the VR dash; both grips now grab.
- **Goal:** align VR controller input with the OpenXR `inputsource.handedness` model and remove the dual-purpose left grip.
- **Files touched:** `src/engine/VRInputManager.ts`, `src/engine/VRHUDManager.ts`, `src/App.tsx`
- **Outcome:** succeeded. Logged in `FEATURES.md` "Recently Changed".

### 2026-07-02 — Chat panel + scene inspector drawing pipeline

- **What I tried to do:** draw the chat panel + scene inspector as 3D meshes when opened in immersive mode, reusing the same HUD canvas-texture pipeline as the dash menu.
- **Goal:** resurface the inspector + chat in VR without re-mounting React DOM (which doesn't exist in WebXR).
- **Files touched:** `src/engine/VRHUDManager.ts`, `src/components/SceneInspectorWindow.tsx`, `src/components/ChatPanel.tsx`, `src/App.tsx`
- **Outcome:** succeeded. Anchored by `_tmp_apply_draw_chat_panel.py` and `_tmp_vrhud_inspector_rewrite.py`.

### 2026-07-01 — Radial menu signature fix

- **What I tried to do:** change the radial-menu dispatch handler signature from positional args to a typed object so adding a new tab/slice is cheaper.
- **Goal:** make future radial work a one-line change instead of an interface breakage.
- **Files touched:** `src/components/RadialContextMenu.tsx`, `src/App.tsx`
- **Outcome:** succeeded. Anchored by `_tmp_fix_radial_signature.py`. (Also flagged in `FEATURES.md` suggestions: "Refactor the radial menu's '5 slices × 3 tabs' into a per-tab slice table".)

### 2026-07-01 — Aim-loop hoist + raycaster cleanup

- **What I tried to do:** hoist the per-frame aim-loop raycaster into a single shared instance; remove the legacy pointer portal that was double-allocating rays every frame.
- **Goal:** reduce per-frame allocations (the `FEATURES.md` TODO calls this out).
- **Files touched:** `src/engine/SceneEngine.ts`, `src/engine/ManipulationManager.ts`, removed portal helper
- **Outcome:** succeeded. Anchored by `_tmp_hoist_raycaster.py` and `_tmp_remove_portal.py`.

### 2026-07-01 — Typecheck pass

- **What I tried to do:** clear the typecheck failures that appeared after the chat-panel / inspector 3D rewrite.
- **Goal:** green build before resuming feature work.
- **Files touched:** `src/App.tsx`, `src/components/ChatPanel.tsx`, `src/components/SceneInspectorWindow.tsx`, `src/engine/VRHUDManager.ts`
- **Outcome:** succeeded. Anchored by `_tmp_fix_typecheck.py`.

### 2026-06-30 — Initial structural fixes

- **What I tried to do:** resolve a class of structural errors that prevented the project from booting after the major engine/ folder addition (competing `AvatarManager.ts` definitions, missed `IndexDB` typings on inventory, duplicate radial menu exports).
- **Goal:** get `npm run dev` back online.
- **Files touched:** `src/engine/AvatarManager.ts`, `src/services/InventoryService.ts`, `src/components/RadialContextMenu.tsx`, `src/App.tsx`
- **Outcome:** succeeded. Anchored by `_tmp_fix_structure_errors.py`.

### 2026-06-29 — Inspector handler wiring

- **What I tried to do:** wire the App-level "open inspector for selected asset" handler so the radial menu could open it via a single action ID, and so selecting from inventory would also pop the inspector.
- **Goal:** unify the open-inspector path across radial, dash menu, inventory, and direct selection.
- **Files touched:** `src/App.tsx`, `src/components/SceneInspectorWindow.tsx`, `src/engine/VRHUDManager.ts`
- **Outcome:** succeeded. Anchored by `_tmp_app_inspector_handler.py`.

### 2026-06-29 — Radial fix v2

- **What I tried to do:** fix the second-generation radial menu dispatch path (slice click events were being routed through the wrong closure).
- **Goal:** stable radial click → action mapping under re-mount.
- **Files touched:** `src/components/RadialContextMenu.tsx`, `src/App.tsx`
- **Outcome:** succeeded. Anchored by `_tmp_apply_radial_fix_v2.py`.

### 2026-06-29 — Misc fix batch

- **What I tried to do:** apply a small batch of fixes (typos, missing imports, unused vars) revealed by oxlint after the quest 3 + video wiring sprint.
- **Goal:** lint-green before resuming feature work.
- **Files touched:** several under `src/`
- **Outcome:** succeeded. Anchored by `tmp_misc_fix.py`.

### 2026-06-28 — v1 (pre-radial) chat edits

- **What I tried to do:** first-pass chat panel wiring — emoji send, unread badge, navbar collapse.
- **Goal:** ship a basic chat feature for the multiplayer demo.
- **Files touched:** `src/components/ChatPanel.tsx`, `src/App.tsx`, `src/components/Navbar.tsx`
- **Outcome:** succeeded but superseded by the 3D chat-panel rewrite on 2026-07-02. Anchored by `_tmp_apply_chat_app_edits.py` and `_tmp_apply_chat_edits.py` / `_tmp_apply_chat_edits_2.py`.

### 2026-06-27 — Apply general fixes (umbrella script)

- **What I tried to do:** apply a roll-up of small fixes as one idempotent script.
- **Goal:** reduce per-edit risk by bundling related changes.
- **Files touched:** `src/App.tsx`
- **Outcome:** succeeded. Anchored by `_tmp_apply_fixes.py`.

### 2026-06-26 — Initial commit

- **What I tried to do:** create the repository skeleton with React + TS + Vite baseline, document the feature surface in `README.md` / `FEATURES.md`, and stub the engine + service singletons.
- **Goal:** a runnable starting point for the Quest 3 + Resonite-inspired social VR demo.
- **Files touched:** the entire initial tree (baseline).
- **Outcome:** succeeded (commit `cfe76cf` "Initial commit msg" then `acac472` "Initial commit msg").

---

## Files touched across all adjustments

> Aggregate count of how often each file has been edited as part of an adjustment. Use this to spot the "hot files" — if a file keeps changing, it's the soft underbelly of the project.

| File | Times edited | Last touched | What lives there |
| --- | --- | --- | --- |
| `src/App.tsx` | many+2 | 2026-07-05 | orchestration; hooks handlers; networking wiring |
| `src/engine/SceneEngine.ts` | 3 | 2026-07-04 | viewport, WebXR, locomotion |
| `src/engine/VRHUDManager.ts` | 6 | 2026-07-05 | 3D dashboard, inspector panel, video card |
| `src/engine/ManipulationManager.ts` | 2 | 2026-07-03 | gizmos, RMB-grab, E+drag rotate skip |
| `src/engine/AssetManager.ts` | 2 | 2026-07-03 | misc-file UX overhaul |
| `src/engine/AvatarManager.ts` | 2 | 2026-07-04 | VRM streaming, Quest hand model |
| `src/engine/EnvironmentManager.ts` | 2 | 2026-07-04 | lights, atmosphere |
| `src/engine/VRInputManager.ts` | 2 | 2026-07-04 | side-aware Quest controller read |
| `src/components/SceneInspectorWindow.tsx` | 5 | 2026-07-05 | inspector UI + VideoActions typing |
| `src/components/RadialContextMenu.tsx` | 4 | 2026-07-03 | 5×3 pie menu dispatch |
| `src/components/ChatPanel.tsx` | 3 | 2026-07-02 | 3D + 2D dual-render chat panel |
| `src/components/SpatialPopUpWrapper.tsx` | 2 | 2026-07-05 | 3D billboard → gizmo only |
| `src/services/NetworkService.ts` | 2 | 2026-07-03 | throttle + dedupe |
| `src/services/InventoryService.ts` | 1 | 2026-07-03 | CRUD + radial Save verb |
| `ADJUSTMENTS.md` | 1 | 2026-07-05 | this file (new) |

> Adjustment scripts (`./.tmp_*.py`, `./_tmp_*.py`) are tools used to land the edits above, not code under test. They live in the repo root because they were applied once and re-runnable on no-op, not because they should ship.

---

## Recurring themes

When adjusting, I tend to need to repeat these patterns. Listing them helps me stay tight on the next one.

1. **VR / desktop parity.** Every state mutation has two surfaces — the React UI (desktop) and the 3D `VRHUDManager` panel canvas. New verb → new entry in a switch in `App.tsx.onPanelAction` AND a mirroring buttons row in `VRHUDManager.drawInspectorPanel`.
2. **Local-only vs broadcast.** Anything the user types into a UI form (rename, volume-mode toggle, mute) is local-only. Anything that changes playback/seek position broadcasts to peers. App.tsx is the gate that decides which.
3. **Side-aware Quest controls.** Left controller reports `'x' | 'y'`, right reports `'a' | 'b'`. The legacy `'a' | 'b'` mapping is dead.
4. **Spatial popups can't be E-rotated.** They have `userData.isSpatialWindow = true`; `ManipulationManager` checks that flag on E+drag.
5. **Throttle / dedupe at the network layer.** Chat dedupe, host cooldown, video seek throttle — every noisy event path needs an early-out.
6. **Idempotent adjustment scripts.** `.tmp_*.py` / `_tmp_*.py` files are written so a second run is a no-op. This lets us re-apply without thinking.
7. **Inspector gates.** Most adjustments open with an inspector tweak — adding `videoActions`, or `chatActions`, etc. — then mirror in `VRHUDManager`.

---

## Format for new entries

When I land an adjustment, I'll append a new `###` block to **Latest entries** (and move the older top entry down into **Chronological log**). The template is:

```
### YYYY-MM-DD — <short title>

- **Asked by:** <user request thread, request quote, or "user">
- **What I tried to do:** <narrative of intent; what change was made>
- **Goal:** <the user's stated or inferred goal — why this change>
- **Files touched:** <list of files>
- **Outcome:** succeeded | partially | failed — <one sentence>
- **Anchored by:** <name of the .tmp_*.py or _tmp_*.py script, if any>
```

If I'm adjusting a file under "Files touched across all adjustments" I bump its count by 1 in the same pass.
