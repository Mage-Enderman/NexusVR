# Codebase Audit: Bugs, Conflicts, and Quirks

> Auto-generated audit of the Freebuff/Nexus VR Model Viewer webapp.
> Sorted by by severity.

---

## 🔴 CRITICAL

### 1. Five Network Listeners Leak on Unmount (Memory Leak / Duplicate Execution)

**File:** `src/App.tsx` — lines ~1613–1625, ~1690, ~1693, ~1710

Five network listeners are registered **without** pushing their cleanup functions into the `disposers` array:

```ts
// ❌ These are NOT wrapped in disposers.push(...)
net.onTransform((update) => {
  manipulationManager.applyRemoteTransform(update, assetManager.assets);
});

net.onMaterialUpdate((update) => { ... });
net.onSpawn((data) => { ... });
net.onAvatar((update) => { ... });
net.onVideoState((data) => { ... });
```

Every other `net.on*` call in the same effect is wrapped in `disposers.push(net.on*(...))` — these five are not. Since `NetworkService` is a stable ref (`useRef(new NetworkService())`) that outlives React's `StrictMode` double-mount, the first mount's listeners stay attached permanently, and the second mount adds **duplicates**. In development, every incoming transform, spawn, material update, avatar update, and video state update fires **twice** per event. In production (single mount), the listeners are still never cleaned up on hot-reload or remount, leaking closures.

**Impact:** Duplicate network event processing causes wasted CPU, potential race conditions on asset imports, and stale closure references to torn-down engines.

**Suggested Fix:**
```ts
disposers.push(net.onTransform((update) => {
  manipulationManager.applyRemoteTransform(update, assetManager.assets);
}));

disposers.push(net.onMaterialUpdate((update) => { ... }));
disposers.push(net.onSpawn((data) => { ... }));
disposers.push(net.onAvatar((update) => { ... }));
disposers.push(net.onVideoState((data) => { ... }));
```

---

## 🟡 HIGH

### 2. Stale Closure Over `showChatPanel` in VR HUD Handler

**File:** `src/App.tsx` — ~line 1387 (inside `[]`-deps engine-init `useEffect`)

The `vrHud` constructor's item-click callback references `showChatPanel` directly:

```ts
case 'sys-chat':
  if (sceneEngineRef.current?.renderer.xr.isPresenting) {
    vrHudRef.current?.openPanel('sys-chat');
  } else {
    if (!showChatPanel) {  // ← always `true` (the initial useState value)
      setUnreadChatCount(0);
    }
    setShowChatPanel(true);
  }
  break;
```

Because this closure is created once (`[]` deps), `showChatPanel` is captured as its initial value (`true`). The `!showChatPanel` check is therefore always `false`, so `setUnreadChatCount(0)` **never fires** when the VR HUD's system card triggers the desktop chat panel. The unread badge counter will accumulate indefinitely until the user manually opens the chat.

**Suggested Fix:** Add a `showChatPanelRef` (same pattern as the existing `showRadialMenuRef`) and read it inside the closure:
```ts
const showChatPanelRef = useRef(true);
showChatPanelRef.current = showChatPanel;
// Then in the handler:
if (!showChatPanelRef.current) {
  setUnreadChatCount(0);
}
```

---

### 3. No-op `setPeerCount(prev => prev)` Forces Unnecessary Re-render

**File:** `src/App.tsx` — line 523

```ts
const handleToggleMute = useCallback(async () => {
  await networkServiceRef.current.toggleMute();
  const isMuted = networkServiceRef.current.isMuted;
  vrRadialMenuLeftRef.current?.setState({ isMuted });
  vrRadialMenuRightRef.current?.setState({ isMuted });
  ...
  setPeerCount(prev => prev);  // ← sets the same value, triggers full App re-render
}, []);
```

This is a hack to force a re-render so the VR menu updates its mute icon. It causes a full re-render of the entire `<App>` component tree (all children) for a cosmetic update. React 19 may even skip this re-render if it detects the value is identical, making the hack ineffective.

**Suggested Fix:** Use a dedicated bump counter or pass mute state through a ref + targeted UI update:
```ts
const [muteBump, setMuteBump] = useState(0);
// In handleToggleMute:
setMuteBump(b => b + 1);
```

---

## 🟡 MEDIUM

### 4. `environmentManager` Typed as `any` in SceneEngine

**File:** `src/engine/SceneEngine.ts` — line 170

```ts
public environmentManager: any = null;
```

This should be `EnvironmentManager | null`. The `any` type bypasses all type checking on every access to `this.environmentManager.settings`, `this.environmentManager.applySettings()`, etc. If the EnvironmentManager API changes, TypeScript will not catch breaking changes at the call site.

**Suggested Fix:**
```ts
import { EnvironmentManager } from './EnvironmentManager.ts';
// ...
public environmentManager: EnvironmentManager | null = null;
```

---

### 5. Three Duplicate `SceneInspectorWindow` Component Files

**Files:** `src/components/`

| File | Lines | Status |
|------|-------|--------|
| `SceneInspectorWindow.tsx` | 2841 | **Active** — imported by App.tsx |
| `SceneInspectorWindow-.tsx` | 2769 | Dead code — intermediate revision |
| `SceneInspectorWindow-old.tsx` | 1238 | Dead code — old version |

Only `SceneInspectorWindow.tsx` is imported. The other two add ~4000 lines of dead code that inflates the bundle scan, confuses contributors, and can become a merge-conflict magnet.

**Suggested Fix:** Delete the `-old` and `-` suffixed files (git history preserves them).

---

### 6. Stale/Orphaned Files in Project Root

**Files:** Project root directory

The root contains numerous stale artifacts that should not be in the repository:

| File(s) | Origin |
|---------|--------|
| `nul` | Windows artifact from accidental `> /dev/null` shell redirect |
| `fix_app.cjs`, `fix_app2.cjs`, `fix_app3.cjs` | One-shot Node fix scripts |
| `tmp_add_diag_logs.py`, `tmp_apply_bug_fixes.py`, etc. (9 files) | Temporary Python patch scripts |
| `App.tsx`, `App_orig.tsx`, `App_orig_sections.txt` | Root-level copies of `src/App.tsx` |
| `app_createplaceholder.txt`, `app_end2_raw.txt`, etc. | Extracted text snippets |
| `_on.txt`, `_pl.txt` | Debug snippets |
| `Tmp-files/` directory | Leftover temp directory |
| `ERROR.txt` | Debug output |
| `app_p2p_helper.txt`, `net_header.txt`, etc. | Code review fragments |

**Suggested Fix:** Delete all of these. Add `*.py`, `fix_app*.cjs`, `app_*.txt`, `Tmp-files/`, `nul`, `ERROR.txt`, `_*.txt` to `.gitignore` to prevent re-introduction.

---

### 7. `@types/canvas-confetti` in `dependencies` Instead of `devDependencies`

**File:** `package.json`

```json
"dependencies": {
  "@types/canvas-confetti": "^1.9.0",
  ...
}
```

Type definitions are only needed at build time. Including them in `dependencies` ships unnecessary type declaration files in the production bundle/install.

**Suggested Fix:** Move to `devDependencies`:
```json
"devDependencies": {
  "@types/canvas-confetti": "^1.9.0",
  ...
}
```

---

### 8. Global State via `window` Globals Without Type Declarations

**Files:** Multiple

Two cross-cutting concerns are communicated through untyped `window` properties:

| Global | Set by | Read by | Purpose |
|--------|--------|---------|---------|
| `(window as any).__isRadialMenuOpen` | `RadialContextMenu.tsx` (lines 272, 281) | `ManipulationManager.ts` (lines 858–860), `SceneEngine.ts` (line 856) | Suppress camera look while radial menu is open |
| `(window as any).__NEXUS_VR_PRESENTING` | `SceneEngine.ts` (lines 488, 518) | `ManipulationManager.ts` (line 1296) | VR mode detection |

These are fragile — a race between `RadialContextMenu` unmounting (clears flag) and the scene engine reading the flag can leave stale state. TypeScript has no visibility into these reads/writes.

**Suggested Fix:** Declare on a global interface:
```ts
// src/types/globals.d.ts
declare global {
  interface Window {
    __isRadialMenuOpen?: boolean;
    __NEXUS_VR_PRESENTING?: boolean;
  }
}
export {};
```

---

### 9. Triple Keyboard Listener Architecture

**Files:** `src/engine/SceneEngine.ts` (lines 317–319), `src/engine/ManipulationManager.ts` (lines 362–363), `src/App.tsx` (multiple useEffect blocks)

Three independent classes/components each register their own `window.addEventListener('keydown', ...)`:

1. **SceneEngine** — stores key state in `this.keysPressed` 
