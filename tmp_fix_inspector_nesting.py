#!/usr/bin/env python3
"""
Fix the bug where onInspectorUpdate receive handler is nested inside
onMaterialUpdate callback. Uses line-based matching to be robust to
whitespace differences.
"""
import sys

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the comment line that marks the misplaced block
comment_idx = None
for i, line in enumerate(lines):
    if 'Apply generic inspector updates' in line:
        comment_idx = i
        break

if comment_idx is None:
    print("ERROR: could not find the comment line")
    sys.exit(1)

print(f"Found misplaced comment at line {comment_idx + 1}")
print(f"Comment text: {lines[comment_idx]!r}")

# Look backwards to find the line that says `setSelectedAsset({ ...asset });`
# (the one inside the material callback's if (sel && sel.id...) block).
# We want the LAST such line BEFORE the misplaced comment.
target_setAsset_line_idx = None
for i in range(comment_idx - 1, -1, -1):
    if 'setSelectedAsset({ ...asset });' in lines[i] and lines[i].strip() == 'setSelectedAsset({ ...asset });':
        target_setAsset_line_idx = i
        break

if target_setAsset_line_idx is None:
    print("ERROR: could not find the setSelectedAsset line above the comment")
    sys.exit(1)

print(f"Found setSelectedAsset line at {target_setAsset_line_idx + 1}: {lines[target_setAsset_line_idx]!r}")

# Now look forward from the comment to find the closing of the inspector
# handler and the orphaned braces. The pattern after the misplaced
# comment+handler is:
#   }));             <- closes the onInspectorUpdate callback
#       }            <- orphaned (was meant to close material's inner if)
#     }              <- orphaned (was meant to close material's if (asset))
#   });              <- orphaned (was meant to close material callback)
# We need to find the })); line, then remove the next 3 lines.

handler_close_idx = None
for i in range(comment_idx, len(lines)):
    if lines[i].rstrip() == '    }));':
        handler_close_idx = i
        break

if handler_close_idx is None:
    print("ERROR: could not find the })); line after the comment")
    sys.exit(1)

print(f"Found handler-close line at {handler_close_idx + 1}: {lines[handler_close_idx]!r}")

# Verify the 3 lines after are the orphaned braces
if handler_close_idx + 3 >= len(lines):
    print("ERROR: not enough lines after handler close to check for orphans")
    sys.exit(1)

orphan1 = lines[handler_close_idx + 1].rstrip()
orphan2 = lines[handler_close_idx + 2].rstrip()
orphan3 = lines[handler_close_idx + 3].rstrip()
print(f"Orphan 1: {orphan1!r}")
print(f"Orphan 2: {orphan2!r}")
print(f"Orphan 3: {orphan3!r}")

# The orphans should be '}', '}', '});' at increasing indents
# but we need to verify they're closing braces, not real code.
# Take the raw whitespace too.
if not orphan1.endswith('}') or not orphan2.endswith('}') or not orphan3.endswith('});'):
    print("ERROR: lines after })); don't look like orphaned braces - aborting to be safe")
    sys.exit(1)

# === Now make the edits ===
# Edit 1: After the setSelectedAsset line, insert the missing closing braces.
# Edit 2: Remove the 3 orphaned lines after the }));.

# Verify the setSelectedAsset line is followed by an empty line and the comment
print(f"Line after setSelectedAsset: {lines[target_setAsset_line_idx + 1]!r}")
print(f"Line after that: {lines[target_setAsset_line_idx + 2]!r}")

# Build the new lines list
new_lines = []

# Lines 0 .. target_setAsset_line_idx (inclusive)
new_lines.extend(lines[:target_setAsset_line_idx + 1])

# Get the indentation of the setSelectedAsset line for proper closing
# We need to close:
#   if (sel && sel.id === update.assetId) {  (indented at 8 spaces)
#   if (asset) {                             (indented at 6 spaces)
#   net.onMaterialUpdate((update) => {       (indented at 4 spaces)
# So we add: 8-space }, 6-space }, 4-space });
new_lines.append('        }\n')
new_lines.append('      }\n')
new_lines.append('    });\n')

# Now we need to skip from the empty line after setSelectedAsset up to
# the line BEFORE the misplaced comment. The misplaced comment is at
# comment_idx, and the empty line is at target_setAsset_line_idx + 1.
# But wait - actually the misplaced comment is INSIDE the material callback.
# So we need to skip everything from target_setAsset_line_idx + 1 (the
# empty line after setSelectedAsset) up to and including the
# handler_close_idx + 3 (the last orphaned line).
#
# But we want to KEEP the comment and the disposers.push at the new
# (correct) indentation. The comment is at comment_idx with '    ' indent
# (4 spaces), which IS the correct indent for a top-level statement in
# the useEffect. So we keep it.
#
# Lines to skip: target_setAsset_line_idx+1 .. comment_idx-1
# Lines to keep: comment_idx .. handler_close_idx
# Lines to skip: handler_close_idx+1 .. handler_close_idx+3

# Actually, the comment is already at 4-space indent (correct useEffect level).
# And the disposers.push is at 4-space indent. We just need to:
# - Skip the empty line + everything between setSelectedAsset and comment
# - Keep the comment + handler
# - Skip the 3 orphaned lines after }));

# Re-think: we want to keep the comment and the disposers.push and the
# entire handler. We just want to:
# 1. Add the closing braces after setSelectedAsset
# 2. Remove the 3 orphaned lines after }));

# So the new_lines should be:
# - All lines up to and including setSelectedAsset
# - The 3 new closing braces
# - Skip the empty line after setSelectedAsset
# - All lines from comment_idx up to and including })); (handler_close_idx)
# - Skip the 3 orphaned lines

# But the empty line between setSelectedAsset and the comment is
# already at target_setAsset_line_idx + 1. We want to skip that.
# But what if there's no empty line? Let's check.

# Actually, looking at the basher output, there IS an empty line between
# setSelectedAsset and the comment. So we need to skip from
# target_setAsset_line_idx + 1 to comment_idx - 1 (which would be the
# empty line(s) and any code between).

# Wait, we also need to keep the comment line. Let me re-examine.
# Lines:
#   target_setAsset_line_idx: '          setSelectedAsset({ ...asset });'
#   target_setAsset_line_idx + 1: '' (empty line)
#   target_setAsset_line_idx + 2: '    // Apply generic inspector updates...'
#   ... handler ...
#   handler_close_idx: '    }));'
#   handler_close_idx + 1: '        }'  (orphan)
#   handler_close_idx + 2: '      }'    (orphan)
#   handler_close_idx + 3: '    });'    (orphan)

# So we need to:
# 1. Keep up to and including setSelectedAsset (target_setAsset_line_idx)
# 2. Add 3 closing braces
# 3. Add the empty line that was between setSelectedAsset and the comment
#    (to preserve formatting)
# 4. Keep the comment and handler (comment_idx to handler_close_idx)
# 5. Skip the 3 orphaned lines (handler_close_idx+1 to handler_close_idx+3)
# 6. Continue with the rest

# The empty line at target_setAsset_line_idx + 1 should be kept.
# Let me check if lines[target_setAsset_line_idx + 1] is empty.
print(f"Empty line check: {lines[target_setAsset_line_idx + 1]!r}")

# Add the empty line if it exists
if target_setAsset_line_idx + 1 < len(lines) and lines[target_setAsset_line_idx + 1].strip() == '':
    new_lines.append(lines[target_setAsset_line_idx + 1])

# Add lines from comment_idx to handler_close_idx (inclusive)
new_lines.extend(lines[comment_idx:handler_close_idx + 1])

# Skip the 3 orphaned lines, add everything after them
new_lines.extend(lines[handler_close_idx + 4:])

# Write the file
new_content = ''.join(new_lines)
with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"SUCCESS: file updated, removed {len(lines) - len(new_lines)} lines, kept {len(new_lines)} lines")
