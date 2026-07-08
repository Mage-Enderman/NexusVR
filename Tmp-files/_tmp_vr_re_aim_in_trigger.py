"""Re-aim inside PRIORITY 1 of the trigger handler before select().

The aim rAF useEffect loop in App.tsx fires tick() on its own schedule,
which is NOT guaranteed to align with WebXR's `setAnimationLoop` frame
that fires onPressed. When the user moves their controller and then
pulls the trigger within the same frame, the aim rAF's last tick could
land BEFORE the user's movement, leaving hoveredSlice stale relative to
the controller pose at the moment select() is called -> select() returns
silently when hoveredSlice < 0 (no slice dispatched).

The fix: in PRIORITY 1, immediately before radialMesh.select(), rebuild
the aim ray from the same XR-frame-synchronous matrixWorld that
VRInputManager.update() just used (it ran inside the XR loop and is
guaranteed current on this frame) and call mesh.updateAim() on it. That
guarantees hoveredSlice matches the controller's actual current pose at
the moment select() fires. The aim rAF loop stays — it still drives
hover highlighting because the loop's throttle is fast enough for those.
"""

from pathlib import Path

PATH = Path("src/App.tsx")
src = PATH.read_text(encoding="utf-8")

# NOTE on uniqueness: this is a unique-sequence match. The PRIORITY 1
# block that I'm changing has a tell — its check is the only
# `radialMesh.isVisible && !radialMesh.disposed` site in the file.
A_OLD = (
    "            const radialMesh = vrRadialMenuRef.current;\n"
    "            if (radialMesh && radialMesh.isVisible && !radialMesh.disposed) {\n"
    "              // The right trigger is always the select trigger for the VR\n"
    "              // radial menu, regardless of which hand (B or Y) opened it.\n"
    "              // The menu opens near the left wrist; the right laser aims.\n"
    "              // Accept either trigger so left-hand-dominant users who open\n"
    "              // with B can also click with the left trigger if they prefer.\n"
    "              radialMesh.select();\n"
    "              return;\n"
    "            }\n"
)

A_NEW = (
    "            const radialMesh = vrRadialMenuRef.current;\n"
    "            if (radialMesh && radialMesh.isVisible && !radialMesh.disposed) {\n"
    "              // PRIORITY 1 must re-aim BEFORE select().\n"
    "              // The per-frame aim rAF useEffect (around line 432) ticks on\n"
    "              // its OWN requestAnimationFrame schedule, which runs\n"
    "              // independently of WebXR's setAnimationLoop. When the user\n"
    "              // moves their controller and pulls the trigger within the\n"
    "              // same frame, the aim rAF's last tick could land BEFORE the\n"
    "              // user's movement, leaving hoveredSlice from the previous\n"
    "              // pose. select() then reads a stale hoveredSlice: if it\n"
    "              // resolves to <0 (sentinel -999 from setVisible, or any\n"
    "              // off-by-one slice number), select() exits silently without\n"
    "              // firing any callback and the user reads it as \"the slice\n"
    "              // click does nothing\".\n"
    "              //\n"
    "              // Rebuild the aim ray from the XR-frame-synchronous\n"
    "              // matrixWorld that VRInputManager.update() just used (it ran\n"
    "              // inside the XR loop on this same frame and is guaranteed\n"
    "              // current), then call mesh.updateAim() so hoveredSlice is\n"
    "              // authoritative for this press. The aim rAF loop still\n"
    "              // runs for the continuous hover-highlight effect — this\n"
    "              // synchronous pre-select update is the belt-and-braces\n"
    "              // fix for the click-misses-during-fast-aim case.\n"
    "              const se1 = sceneEngineRef.current;\n"
    "              if (se1?.vrInput) {\n"
    "                const aimSide1 = vrRadialActiveSideRef.current ?? 'right';\n"
    "                const ctr1 = se1.vrInput.getController(aimSide1);\n"
    "                if (ctr1) {\n"
    "                  ctr1.updateWorldMatrix(true, false);\n"
    "                  vrRadialAimOriginRef.current.setFromMatrixPosition(ctr1.matrixWorld);\n"
    "                  vrRadialAimDirQuatRef.current.setFromRotationMatrix(ctr1.matrixWorld);\n"
    "                  vrRadialAimDirRef.current\n"
    "                    .set(0, 0, -1)\n"
    "                    .applyQuaternion(vrRadialAimDirQuatRef.current)\n"
    "                    .normalize();\n"
    "                  vrRadialAimRayRef.current.set(\n"
    "                    vrRadialAimOriginRef.current,\n"
    "                    vrRadialAimDirRef.current\n"
    "                  );\n"
    "                  radialMesh.updateAim(vrRadialAimRayRef.current);\n"
    "                }\n"
    "              }\n"
    "              // The menu was opened with the active side controller; either\n"
    "              // trigger press dispatches a select(). Left-handed users who\n"
    "              // opened with B can aim with the left trigger; right-handed\n"
    "              // users who opened with Y can aim with the right. The mesh's\n"
    "              // hoveredSlice takes care of WHICH slice is fired.\n"
    "              radialMesh.select();\n"
    "              return;\n"
    "            }\n"
)

n_a = src.count(A_OLD)
if n_a == 0:
    print("already patched, no-op")
    raise SystemExit(0)
if n_a != 1:
    raise SystemExit(f"expected exactly one match for A block, found {n_a}")

new = src.replace(A_OLD, A_NEW)
PATH.write_text(new, encoding="utf-8")
print(f"applied: A={n_a} replaced; size grew {len(new) - len(src)} chars")
