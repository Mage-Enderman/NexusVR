#!/usr/bin/env python3
"""
Fix the 5 unbalanced `disposers.push(X.onY((args) => {` openings left by
the previous script. Each opening adds one `(` that wasn't balanced by a
matching `)`. Bracket-depth tracking with naive string-literal handling
finds the matching `});` for each block so we can rewrite it to `}));`.
"""
import sys
from pathlib import Path

SRC = Path("src/App.tsx")
text = SRC.read_text(encoding="utf-8")

# Unique opening line for each unbalanced block.
UNBALANCED_OPENS = [
    "    disposers.push(manipulationManager.registerOnDragChange((dragging) => {",
    "    disposers.push(assetManager.registerOnAssetAdded((asset) => {",
    "    disposers.push(net.onRemove((id) => {",
    "    disposers.push(net.onSyncReq((fromPeerId) => {",
    "    disposers.push(net.onSyncResp((snapshot) => {",
]


def find_matching_close(text: str, open_line_start: int):
    """Given the byte offset of the opening text (the line including
    `disposers.push(X.onY(...) => {`), walk the character stream,
    tracking `{`/`}` depth (with crude string/comment skipping) and
    return the byte offsets of (close_brace, close_paren, close_semi)
    for the OUTER `});` that ends this block.
    """
    # The opening brace is somewhere after `=>` on the opening line.
    start = text.find('{', open_line_start)
    if start == -1:
        return None
    depth = 0
    i = start
    # Track whether we're inside a string literal to skip nested braces
    # in object / regex literals. Naive single-char handling -- the file
    # doesn't contain complex string escapes that would confuse this.
    in_str = None  # one of '"', "'", '`', '/' (regex), or None
    # Also crude single-line comment skip.
    while i < len(text):
        c = text[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        # Single-line comment: skip to end of line.
        if c == '/' and i + 1 < len(text) and text[i + 1] == '/':
            nl = text.find('\n', i)
            i = nl + 1 if nl != -1 else len(text)
            continue
        # Block comment: skip to `*/`.
        if c == '/' and i + 1 < len(text) and text[i + 1] == '*':
            end = text.find('*/', i + 2)
            i = end + 2 if end != -1 else len(text)
            continue
        if c in ('"', "'", '`'):
            in_str = c
            i += 1
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                # Verify that immediately after this `}` (skipping WS)
                # we have `)` then optional `;`. That marks the close of
                # the `(... => { ... })` callback.
                j = i + 1
                while j < len(text) and text[j] in ' \t\r\n':
                    j += 1
                if j < len(text) and text[j] == ')':
                    k = j + 1
                    while k < len(text) and text[k] in ' \t\r\n':
                        k += 1
                    if k < len(text) and text[k] == ';':
                        return (i, j, k)
                    # No trailing `;` -- still the right close for `(...)))`
                    # pattern, but report anyway.
                    if k == len(text) or text[k] in '}\n)\r\t ':
                        return (i, j, k)
                # If the next char isn't `)` then we hit a stray `}` whose
                # matching `{` we missed (e.g., lone closing in a false branch).
                # Continue scanning -- the block's close is later.
        i += 1
    return None


fixed = skipped = 0
for open_line in UNBALANCED_OPENS:
    pos = text.find(open_line)
    if pos == -1:
        print(f"[SKIP] Anchor missing: {open_line[:60]!r}...")
        skipped += 1
        continue
    info = find_matching_close(text, pos)
    if not info:
        print(f"[ERR]  No matching close for {open_line[:60]!r}")
        sys.exit(1)
    close_brace, close_paren, close_semi_or_ws = info
    # Build the original substring `...});` (or `...)` if no semicolon).
    end_idx = close_semi_or_ws
    # Include the `;` if present at close_semi_or_ws.
    if (
        close_semi_or_ws < len(text)
        and text[close_semi_or_ws] == ';'
    ):
        end_idx = close_semi_or_ws + 1
    original = text[close_brace:end_idx]
    if '});' in original:
        rewritten = original.replace('});', '}));', 1)
    elif original.endswith(')'):
        rewritten = original + ');'
    else:
        print(f"[ERR]  Unexpected close shape: {original!r}")
        sys.exit(1)
    text = text[:close_brace] + rewritten + text[end_idx:]
    print(f"[OK]   Fixed close for {open_line[4:50]!r}: ...{original[-4:]!r} -> ...{rewritten[-4:]!r}")
    fixed += 1

SRC.write_text(text, encoding="utf-8")
print(f"\n[DONE] Fixed={fixed}, skipped={skipped}. Wrote {SRC} ({len(text)} chars).")
print("Run `npx vite build` to confirm TS compiles.")
