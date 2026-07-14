"""Fix the syntax errors left in SceneInspectorWindow.tsx by the prior
Python patch script. Two broken sites:

1. The useEffect that resets tree state got concatenated onto the same
   line as the applyTransform arrow. We need a newline + closing
   `}    const applyTransform` to read as `};\n\n  const applyTransform`.

2. Inside applyTransform, one line was dedented one space too far and
   the regex accidentally appended `;.prefix_broadcast` as a junk
   terminator. We need `  };.prefix_broadcast` to read as `  };`.
"""
import re
from pathlib import Path

p = Path("src/components/SceneInspectorWindow.tsx")
src = p.read_text(encoding="utf-8")

# --- Fix 1: useEffect + applyTransform smushed onto one line -----------
# The exact broken line we observed:
#   }, [selectedAsset?.id]);  const applyTransform = (newPos = pos, newRot = rot, newScale = scale) => {
# Replace with two statements properly separated.
broken1 = "  }, [selectedAsset?.id]);  const applyTransform = (newPos = pos, newRot = rot, newScale = scale) => {"
fixed1 = "  }, [selectedAsset?.id]);\n\n  const applyTransform = (newPos = pos, newRot = rot, newScale = scale) => {"
count1 = src.count(broken1)
assert count1 == 1, f"Expected exactly 1 match for fix1, got {count1}"
src = src.replace(broken1, fixed1)

# --- Fix 2: dedented broadcast line + garbage terminator ----------------
# The exact broken block (the closing of applyTransform):
#               selectedAsset.object3d.scale.set(newScale.x, newScale.y, newScale.z);
#     onUpdateAsset({ ...selectedAsset });
#   onBroadcastAssetUpdate?.(selectedAsset);
#   };.prefix_broadcast
# Replace it with the correct closing.
broken2 = (
    "    selectedAsset.object3d.scale.set(newScale.x, newScale.y, newScale.z);\n"
    "    onUpdateAsset({ ...selectedAsset });\n"
    "  onBroadcastAssetUpdate?.(selectedAsset);\n"
    "  };.prefix_broadcast\n"
)
fixed2 = (
    "    selectedAsset.object3d.scale.set(newScale.x, newScale.y, newScale.z);\n"
    "    onUpdateAsset({ ...selectedAsset });\n"
    "    onBroadcastAssetUpdate?.(selectedAsset);\n"
    "  };\n"
)
count2 = src.count(broken2)
assert count2 == 1, f"Expected exactly 1 match for fix2, got {count2}"
src = src.replace(broken2, fixed2)

# --- Fix 3: ensure the giant useEffect id-change reset properly closes -
# Already fixed by Fix 1.

# --- Fix 4: verify the early-return gate exists in applyTransform -------
gate = "    if (!interactive) return;\n    if (!selectedAsset) return;\n\n    selectedAsset.object3d.position.set(newPos.x, newPos.y, newPos.z);"
assert gate in src, "applyTransform is missing the !interactive gate; expected a reapplied safety check from the diff."

p.write_text(src, encoding="utf-8")
print("OK -- both syntax errors fixed.")
print(f"file_size_chars={len(src)}")
