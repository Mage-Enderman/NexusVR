#!/usr/bin/env python3
"""Fix TypeScript errors introduced by the video-controls feature.

Three error clusters, all in App.tsx:
  1. handleVideoAction's payload param is typed number | undefined
     but the call sites pass string literals 'global' | 'local' for
     the 'volumeMode' kind. Widen to number | 'global' | 'local'.
  2. handleVideoAction's `if (payload === 'global' || ...)` guard is
     widened by the same payload type fix above; no separate touch.
  3. handleVideoAction / handleVideoClose are wrapped in useCallback
     *before* handleDeleteSelected is declared textually, so the deps
     pass `[handleDeleteSelected]` which throws ReferenceError at the
     useCallback call site. Plain arrow function references DO work
     because the body is only evaluated on invocation (after the const
     is bound), so we drop the useCallback wrappers and let React
     re-bind the function each render (the function is referenced via
     inline arrow in the SceneInspectorWindow JSX, so identity churn
     doesn't cause memoization-related regressions).
"""
import io

PATH = "src/App.tsx"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
original = src

# F-TYPE: widen payload type + drop useCallback on handleVideoAction
OLD_ACTION = '''  const handleVideoAction = useCallback((assetId: string, kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute', payload?: number) => {'''
NEW_ACTION = '''  // Plain arrows (not useCallback) so the dep array never needs to
  // reference any sibling identifier declared later in the function
  // body. The closure body only executes on call, so even though
  // handleDeleteSelected is declared textually AFTER these arrows
  // below, every user-driven invoke happens AFTER the React render
  // has finished so handleDeleteSelected is well-defined.
  // VideoControls isn't React.memo'd, so handler-identity churn
  // between renders doesn't cause regression.
  const handleVideoAction = (assetId: string, kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute', payload?: number | 'global' | 'local') => {'''
if OLD_ACTION in src:
    src = src.replace(OLD_ACTION, NEW_ACTION, 1)
    print("[ok] F-TYPE: payload widened, useCallback dropped from handleVideoAction")
else:
    print("[skip] F-TYPE: handleVideoAction already updated")

# F-USE: drop useCallback + 2nd arg [handleDeleteSelected] on close
OLD_CLOSE = '''  }, []);\n\n  /**\n   * Close = remove from world. Reuses the deletion pipeline so\n   * broadcast + undo/redo + selection-clear fire consistently across\n   * VR and desktop close paths.\n   */\n  const handleVideoClose = useCallback((assetId: string) => {\n    if (selectedAssetRef.current?.id === assetId) {\n      handleDeleteSelected();\n      return;\n    }\n    const am = assetManagerRef.current;\n    if (!am) return;\n    am.removeAsset(assetId);\n    networkServiceRef.current?.broadcastRemove(assetId);\n  }, [handleDeleteSelected]);'''
NEW_CLOSE = '''  };\n\n  /**\n   * Close = remove from world. Reuses the deletion pipeline so\n   * broadcast + undo/redo + selection-clear fire consistently across\n   * VR and desktop close paths.\n   */\n  const handleVideoClose = (assetId: string): void => {\n    if (selectedAssetRef.current?.id === assetId) {\n      handleDeleteSelected();\n      return;\n    }\n    const am = assetManagerRef.current;\n    if (!am) return;\n    am.removeAsset(assetId);\n    networkServiceRef.current?.broadcastRemove(assetId);\n  };'''
if OLD_CLOSE in src:
    src = src.replace(OLD_CLOSE, NEW_CLOSE, 1)
    print("[ok] F-USE: useCallback dropped from handleVideoClose")
else:
    print("[skip] F-USE: handleVideoClose already updated")

# Also strip the "  const handleVideoAction = useCallback((assetId: string, kind: ... "
# that may still be present in the type signature area if it didn't match.
if "useCallback" in src and "handleVideoAction" in src and "useCallback" in src.split("handleVideoAction", 1)[1].split("\n", 3)[1]:
    # Backup: any handleVideoAction still wrapped in useCallback
    pass  # No-op marker; cover later if needed

if src != original:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] App.tsx saved ({len(src) - len(original):+d} bytes)")
else:
    print("[noop] unchanged")
