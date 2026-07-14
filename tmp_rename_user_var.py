"""Targeted variable rename: my Bug 2 fix at App.tsx line 332 references
`localUserName`, but the useState in App.tsx is named `userName`
(declared at line 427). Typecheck fails:

    src/App.tsx(332,27): error TS2304: Cannot find name 'localUserName'.

Patch only the line inside my new useEffect. The other `localUserName`
references in App.tsx (line 4447, 4453, 4573, 4580) are property
accesses on `net` (networkService) and are unrelated — they should
NOT change. The anchor below is unique to my new useEffect because
`originatorUserName: localUserName` is a payload-field assignment
and only appears in the broadcastPanelState call I added.
"""
from pathlib import Path

p = Path("src/App.tsx")
app = p.read_text(encoding="utf-8")

# Anchor: the exact line in my new useEffect. The 4-space indent
# matches what's inside the useEffect body (after the `useEffect(() => {`).
old = "      originatorUserName: localUserName,\n"
new = "      originatorUserName: userName,\n"
n = app.count(old)
assert n == 1, f"App.tsx originatorUserName anchor: expected 1 match, got {n}"
app = app.replace(old, new, 1)
p.write_text(app, encoding="utf-8")
print(f"OK renamed to userName (file_size_chars={len(app)})")
