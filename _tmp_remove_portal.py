#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io, re

path = 'src/App.tsx'
with io.open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the broken React portal that mounted RadialContextMenu into the
# VR panel via SpatialPanelManager. The VR path now uses VRRadialMenuMesh
# (canvas-textured, additively drawn into the scene root) so this portal
# block is dead code. Desktop still uses <RadialContextMenu isOpen={showRadialMenu} ...>
# (separate render path, untouched).
start_anchor = '      {/* VR Radial Context Menu \u2014 rendered into the SpatialPanelManager\'s'
end_anchor   = '      )}\n'

start_idx = content.find(start_anchor)
assert start_idx != -1, 'React portal block start not found'
end_idx = content.find(end_anchor, start_idx)
assert end_idx != -1, 'React portal block end not found'
# Trim trailing newline so we cleanly drop the block plus its trailing blank line.
end_after = end_idx + len(end_anchor) + 1  # include the newline so no double blank remains

# Compute the line just before to make sure we don't leave dangling comments.
before_start = content.rfind('\n', 0, start_idx)
# Verify there's a blank-line gap before so the removal keeps formatting consistent.
content_before = content[max(0, before_start - 1):start_idx]
content = content[:before_start + 1] + content[end_after:]

with io.open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('OK: removed React portal block')
print('wrote', len(content), 'bytes')
