"""Repair the parse-broken bytes-phase block in src/engine/AssetManager.ts.

Root cause: an earlier regex sweep over-zealously stripped the identifier
`useFileReaderForProgress` from three sites inside one block:
  - the `const useFileReaderForProgress = ...` declaration,
  - the inline ternary `  : useFileReaderForProgress ? ...`
  - the guard `if (!useFileReaderForProgress && onProgress) { ... }`
Stripping the name (and not the surrounding operators / ternary colons)
left syntax-invalid fragments:
  - `const  = file.size >= 1024 * 1024 && !isVideoExt;`
  - a ternary whose second arm starts with `:` and the conditional is both
    the operator-only `: ? await file.arrayBuffer() : await file.arrayBuffer()`
  - `if (! && onProgress) { ... }`
The cleanest repair is to replace the broken span with a simplified block
that matches the actually-shipped behaviour (one 50% tick after bytes),
keeping the explanatory comment aligned with the implementation.
"""
import re

P = 'D:/0-Antigravity/NexusVR/NexusVR/src/engine/AssetManager.ts'
with open(P, 'r', encoding='utf-8') as fh:
    src = fh.read()

# Anchor on the unique broken `const  = file.size >= 1024 * 1024 && !isVideoExt;`
# and walk back to the preceding comment block + forward to the `}` that
# closes the bytes-phase if-guard. The replacement is scoped to JUST this
# span so the rest of _loadFile (and the rest of the file) is untouched.
ANCHOR_START = '    // Bytes-phase progress:'
# The block ends at the closing brace of `if (! && onProgress) { ... }`
# immediately before `const blobUrl = URL.createObjectURL`.
ANCHOR_END = '    }\n    const blobUrl = URL.createObjectURL'

i1 = src.find(ANCHOR_START)
assert i1 != -1, 'bytes-phase comment anchor missing'
i2 = src.find(ANCHOR_END, i1)
assert i2 != -1, 'closing brace anchor missing'
i_end = i2 + len(ANCHOR_END)

broken = src[i1:i_end]
print('---- BROKEN BLOCK ----')
print(broken)
print('---- END ----')

REPLACEMENT = '''    // Bytes-phase progress (simplified). We deliberately DON'T stream
    // through FileReader.readAsArrayBuffer.onprogress here even though it
    // would give a more granular 0..50% readout, because:
    //   (a) FileReader.onprogress fires at roughly 10 Hz per spec, so the
    //       UI smoothness is the same as a single 50% post-bytes tick on
    //       any modern browser.
    //   (b) The bulk of import latency lives in the GLTF/Texture decode
    //       phase (50 -> 95%) which runs UNOBSERVED for blob: URLs anyway
    //       (GLTFLoader's XHRLoader onProgress does not fire when loading
    //       from blob: URLs).
    //   (c) Adding a streaming helper here would also need a matching
    //       helper for URL imports, doubling the surface area.
    // Therefore: one 50% tick after the bytes resolve, then the loader
    // resolves at 100%. The placeholder shows a smooth 0 -> 50 -> 100
    // sweep with no visible percentage jitter.
    const arrayBuffer = (isVideoExt && !isSmallVideo && !config?.importAsRawFile)
      ? null
      : await file.arrayBuffer();
    if (onProgress) {
      try { onProgress(50); } catch { /* ignore listener errors */ }
    }
    const blobUrl = URL.createObjectURL'''

new_src = src[:i1] + REPLACEMENT + src[i_end:]
with open(P, 'w', encoding='utf-8') as fh:
    fh.write(new_src)

# Sanity: confirm zero broken fragments remain anywhere in the file.
for needle in [
    'const  =',
    'let  =',
    'var  =',
    'if (! &&',
    ': ? await',
    'await file.arrayBuffer()\n',
]:
    cnt = new_src.count(needle)
    flag = 'OK' if (needle == 'await file.arrayBuffer()\n' and cnt >= 1) or cnt == 0 else 'FAIL'
    print(f'  [{flag}] residual {needle!r} count={cnt}')

print('before len=', len(src), 'after len=', len(new_src))
