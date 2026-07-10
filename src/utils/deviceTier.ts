/**
 * deviceTier — coarse-grained device classification for video / texture
 * VRAM budgeting.
 *
 * Why this exists
 * ---------------
 * AssetManager wants to bound GPU memory before a video starts decoding so a
 * 4K HEVC file picked from a desktop folder doesn't OOM a Quest 2 the moment
 * its first full-resolution 8 MB RGBA frame hits the Adreno's 3 GB working
 * set. The MediaCapabilities gate alone is not enough: on Quest, HEVC and
 * H.264 *are* power-efficient HW-decoded, so `powerEfficient: true` short-
 * circuits any downscale we would otherwise apply. We need an explicit
 * capacity tier on top of the codec probe so VRAM stays bounded even when HW
 * decode is "free".
 *
 * Tier rules (chosen to be conservative — false-positives just give us a
 * softer picture, false-negatives crash the tab on Quest):
 *
 *   `quest-low`   — UA mentions Oculus / Quest / MetaHorizon, OR
 *                    (cores ≤ 4 AND UA is mobile-class). Covers Quest 2
 *                    (4c Adreno 650, ~3 GB usable VRAM) and Quest 3 in
 *                    mobile-class browser mode (some builds expose
 *                    fewer cores), AND future Quest headsets that may
 *                    drop the explicit UA strings without warning. The
 *                    `cores ≤ 4 + mobile UA` fallback ensures the
 *                    tier doesn't quietly downgrade to 'mobile' on a
 *                    new Quest model that we haven't whitelisted yet —
 *                    the additive VRAM cap is safer than missing it.
 *                    Cap → 1280×720 @ 60fps.
 *   `mobile`      — UA mentions Mobile / Android / iPhone / iPad AND
 *                    cores ≤ 8. Covers phones (where decode hardware
 *                    is shared with the OS display pipeline and we
 *                    can't afford full-res RGBA uploads every frame).
 *                    Cap → 1280×720.
 *   `desktop`     — anything else. Cap → 1920×1080 (still bounded, but
 *                    comfortable on a 4K monitor for one or two videos).
 *
 * The Quest family is the explicit minority case the whole flag is built
 * for — leave the heuristic above as the single source of truth and any
 * future headset identifications ('quest pro', 'quest 4', etc.) flow
 * through it.
 *
 * Cached at module load (one-shot read of navigator) so callers don't
 * hammer UA-strip / hardwareConcurrency on every video import. Browsers
 * that change device state at runtime (e.g. connecting a second display)
 * will need a page reload to pick up a tier shift.
 */
export type DeviceTier = 'quest-low' | 'mobile' | 'desktop';

interface TierProfile {
  /** Cap for CanvasTexture downscaling in device pixels. */
  width: number;
  height: number;
  /** Long-edge aspect: 16:9 always; this is for size math only. */
  aspect: number;
}

const TIER_PROFILES: Record<DeviceTier, TierProfile> = {
  // Quest 2/3 prefer 720p60 even at 4K source — VRAM dominant cost is
  // texture *bytes*, so 1280×720 × 4 (RGBA) = 3.6 MB per frame is well
  // inside the GPU cache footprint for a long-running texture. Going
  // larger (e.g. 1080p) adds ~50% more bandwidth every rVFC tick with
  // no perceptual gain at the Quest's per-eye ~1080p render target.
  'quest-low': { width: 1280, height: 720, aspect: 16 / 9 },
  // Phones share decode bandwidth with the compositor; same 720p cap.
  'mobile':    { width: 1280, height: 720, aspect: 16 / 9 },
  // Desktop GPUs have plenty of VRAM but we still cap to bound the
  // upload bandwidth so a single 4K video doesn't eat a third of a
  // 1080p monitor frame budget. 1080p is the sweet spot for full-screen
  // viewing and stays well under a 4K monitor's downscaling bandwidth.
  'desktop':   { width: 1920, height: 1080, aspect: 16 / 9 },
};

let cachedTier: DeviceTier | null = null;

export function classifyDevice(): DeviceTier {
  if (cachedTier) return cachedTier;
  try {
    const ua = navigator.userAgent.toLowerCase();
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    // Quest family — covers Quest 2, Quest Pro, Quest 3, Quest 3S, the
    // Meta Horizon OS rebranding, etc. UA strings consistently include
    // "OculusBrowser" or "Quest" today, but future headset builds could
    // drop those tokens. Pair the UA match with the cores check below
    // for a forward-compatible fallback.
    if (ua.includes('oculus') || ua.includes('quest') || ua.includes('metahorizon')) {
      cachedTier = 'quest-low';
      return cachedTier;
    }
    // Future-Quest fallback: ≤ 4 cores on a mobile-class device is the
    // most reliable signal that we don't have a desktop GPU budget.
    // Gated on the mobile UA marker so a low-end Chromebook or test
    // VM doesn't accidentally fall into the Quest VRAM cap (which
    // would over-restrict them to 720p). The Quest 2's 4c Adreno is
    // the threshold this is tuned against; Quest 3's 8c falls into
    // `mobile` here, which is fine — it shares the same 1280×720 cap
    // via shouldAlwaysDownscaleVideo.
    const isMobileClassUa = ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipad');
    const isDesktopUa = ua.includes('windows') || ua.includes('macintosh') || ua.includes('cros') || ua.includes('linux');
    if (cores <= 4 && isMobileClassUa && !isDesktopUa) {
      cachedTier = 'quest-low';
      return cachedTier;
    }
    // Phone-class device (any mobile UA with at most 8 cores). Tablets
    // usually expose 8+ cores and fall through to 'desktop' — fine since
    // most tablets can hold their own against HW decode at native rates.
    if (isMobileClassUa && cores <= 8) {
      cachedTier = 'mobile';
      return cachedTier;
    }
    cachedTier = 'desktop';
    return cachedTier;
  } catch {
    // Defensive fallback — if anything in the heuristic throwsf
    // (browser without UA, sandboxed iframe, etc.), treat as desktop
    // so we don't over-restrict a device we can't classify.
    cachedTier = 'desktop';
    return cachedTier;
  }
}

/**
 * Return the CanvasTexture resolution cap for the active tier. The
 * caller uses this in AssetManager.shouldDownscaleVideoForVRAM to size
 * the off-screen canvas that gets pumped into a CanvasTexture; the
 * drawFrame loop inside the asset manager then aspect-fits the source
 * video into this canvas so a 9:16 portrait video presented on a 16:9
 * display still respects the cap on its long edge.
 */
export function getMaxCanvasResolution(tier: DeviceTier = classifyDevice()): { width: number; height: number } {
  const profile = TIER_PROFILES[tier];
  return { width: profile.width, height: profile.height };
}

/**
 * Indicates whether the active tier should ALWAYS use CanvasTexture
 * downscale regardless of the MediaCapabilities `powerEfficient`
 * probe. Quest-low and mobile return true — VRAM is the binding
 * constraint on those class-of-device, not whether HW decode exists.
 * Desktop returns false because its MediaCapabilities gate is
 * authoritative (HW decode capability + bandwidth are both plentiful).
 *
 * This is the single switch that turns "Quest stays alive on 4K
 * imports" from an aspirational comment into an actual code path.
 */
export function shouldAlwaysDownscaleVideo(tier: DeviceTier = classifyDevice()): boolean {
  return tier !== 'desktop';
}

/**
 * Test-only / dev override — lets callers (e.g. a `?forceTier=quest-low`
 * URL flag in a future debug build) pretend the active device is a
 * different tier without faking navigator globals. Production code
 * shouldn't use this; the cached read of navigator.userAgent in
 * classifyDevice() is the source of truth.
 */
export function _setDeviceTierForTesting(tier: DeviceTier): void {
  cachedTier = tier;
}
