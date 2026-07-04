path = 'src/engine/VRInputManager.ts'

def apply(old, new, label):
    global src
    if old not in src:
        print(f'WARN: {label} not found, skipping')
        return False
    src = src.replace(old, new, 1)
    print(f'OK: {label}')
    return True

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# 1) Extend BUTTON_IDS to include 'x' and 'y' so the per-frame edge
# detection (pressed/released) iterates over them and fires the
# onPressed/onReleased callbacks.
apply(
"const BUTTON_IDS: VRButtonId[] = ['trigger', 'grip', 'thumbstick', 'a', 'b'];",
"const BUTTON_IDS: VRButtonId[] = ['trigger', 'grip', 'thumbstick', 'a', 'b', 'x', 'y'];",
'BUTTON_IDS')

# 2) Make the AB/XY button reads side-aware. OpenXR Quest mapping:
#   right gamepad: buttons[4]=A, buttons[5]=B
#   left  gamepad: buttons[4]=X, buttons[5]=Y
# The previous code unconditionally read buttons[4] as 'a' and
# buttons[5] as 'b' — which meant on the left controller, X and Y
# were being reported as A and B (X->a, Y->b). Fix: read the
# controller's handedness (stashed by SceneEngine.setupXR on
# userData.handedness per the comment at line 78) and branch.
apply(
"    // A/B and thumbstick-click are pure booleans (no analog on Quest/Touch).\n    state.buttons.thumbstick = readPressed(gamepad.buttons[3]);\n    state.buttons.a = readPressed(gamepad.buttons[4]);\n    state.buttons.b = readPressed(gamepad.buttons[5]);",
"    // A/B/X/Y and thumbstick-click are pure booleans (no analog on Quest/Touch).\n    // OpenXR Quest mapping: right gamepad has buttons[4]=A / [5]=B;\n    // left gamepad has buttons[4]=X / [5]=Y. Read the controller's\n    // handedness (stashed by SceneEngine.setupXR on userData.handedness\n    // per the getController docblock above) and branch so the LEFT\n    // controller's X/Y are reported as 'x'/'y' and the RIGHT's A/B\n    // as 'a'/'b' — matching VRControls.txt where X is the left dash\n    // button and Y is the left context-menu button.\n    state.buttons.thumbstick = readPressed(gamepad.buttons[3]);\n    const handedness = (controller.userData as { handedness?: XRHandedness })?.handedness;\n    if (handedness === 'left') {\n      state.buttons.x = readPressed(gamepad.buttons[4]);\n      state.buttons.y = readPressed(gamepad.buttons[5]);\n    } else {\n      state.buttons.a = readPressed(gamepad.buttons[4]);\n      state.buttons.b = readPressed(gamepad.buttons[5]);\n    }",
'AB_XY_read')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('VRInputManager X/Y side-aware fix applied')
