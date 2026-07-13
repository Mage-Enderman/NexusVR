            // ==== Splat Graphics (splat.* actions from VRHUDManager.drawSplatPanel) ====
            // Mirrors the desktop SplatGraphicsSection.tsx controls inside the
            // VR 3D canvas. Every MaxSplat mutation sets
            // splatMaxCountUserTouched: true so the scene-startup auto-apply
            // (200K) does NOT silently re-clamp explicit user choices on the
            // next VR entry/exit cycle.
            //
            // We intentionally do NOT call vrHudRef.current?.redrawPanel() here:
            // the active-highlight state is read from data.graphicsSettings,
            // which is supplied via panelDataCtx and only refreshes when
            // setDataContext fires from the post-commit useEffect. A forced
            // redraw at this point would render with STALE graphicsSettings
            // (the previous frame's values) and force a second, correct
            // redraw on the next commit. The existing settings.* handlers in
            // this block follow the same no-explicit-redraw convention.
            // Splat-specific negative/zero guards are explicit so a future
            // caller sending splat.lodScale:-1 or splat.maxCount:0 doesn't
            // pass through to the engine (which would silently mutate
            // SparkRenderer state).
            if (actionId === 'splat.lodEnabled:toggle') {
              const cur = se?.settings?.splatLodEnabled !== false;
              se?.updateSettings({ splatLodEnabled: !cur });
              return;
            }
            if (actionId.startsWith('splat.lodScale:')) {
              const v = parseFloat(actionId.substring('splat.lodScale:'.length));
              if (!Number.isNaN(v) && v >= 0 && v <= 4) {
                se?.updateSettings({ splatLodScale: v });
              }
              return;
            }
            if (actionId === 'splat.maxCount:reset') {
              se?.updateSettings({ splatMaxCount: undefined, splatMaxCountUserTouched: true });
              return;
            }
            if (actionId.startsWith('splat.maxCount:')) {
              const raw = actionId.substring('splat.maxCount:'.length);
              if (raw === 'undefined') {
                se?.updateSettings({ splatMaxCount: undefined, splatMaxCountUserTouched: true });
              } else {
                const next = parseInt(raw, 10);
                // Reject 0 (engine maps it back to undefined -- confusing UX),
                // negative, NaN, and absurdly-large (>10M splats) inputs.
                if (!Number.isNaN(next) && next > 0 && next <= 10_000_000) {
                  se?.updateSettings({ splatMaxCount: next, splatMaxCountUserTouched: true });
                }
              }
              return;
            }

