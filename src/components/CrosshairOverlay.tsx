import React from 'react';

export interface CrosshairOverlayProps {
  showRadialMenu: boolean;
  isCrosshairOverPanel: boolean;
  cameraMode: 'orbit' | 'first-person';
  centerRayHitAssetId: string | null;
  activeTool: string | null;
}

/**
 * Center Crosshair HUD Overlay for first-person desktop view.
 * Color indicators:
 * - Cyan (idle)
 * - Amber (hovering selectable asset with Dev tool)
 * - Green (hovering interactive spatial panel)
 */
export const CrosshairOverlay: React.FC<CrosshairOverlayProps> = React.memo(({
  showRadialMenu,
  isCrosshairOverPanel,
  cameraMode,
  centerRayHitAssetId,
  activeTool,
}) => {
  if (showRadialMenu) return null;

  const overPanel = isCrosshairOverPanel && cameraMode === 'first-person';
  const overAsset =
    !overPanel &&
    centerRayHitAssetId !== null &&
    activeTool === 'dev' &&
    cameraMode === 'first-person';

  const stroke = overPanel
    ? 'rgba(52,211,153,0.95)' // green - panel hover
    : overAsset
    ? 'rgba(245,158,11,0.95)' // amber - asset hover
    : 'rgba(0,240,255,0.7)'; // cyan  - idle

  const strokeOuter = overPanel
    ? 'rgba(52,211,153,0.55)'
    : overAsset
    ? 'rgba(245,158,11,0.65)'
    : 'rgba(0,240,255,0.5)';

  const fillDot = overPanel
    ? 'rgba(52,211,153,1)'
    : overAsset
    ? 'rgba(245,158,11,1)'
    : 'rgba(0,240,255,0.9)';

  const outerR = overPanel ? 5 : overAsset ? 3.6 : 3;
  // Gap: panel hover shows wider gap to feel more like a pointer
  const gapInner = overPanel ? 7 : 8;
  const gapOuter = overPanel ? 10 : 8;

  return (
    <div className="absolute inset-0 z-[5] pointer-events-none flex items-center justify-center">
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        pointerEvents="none"
        style={{ pointerEvents: 'none' }}
        className="pointer-events-none"
      >
        {/* Outer ring - larger and coloured when over panel */}
        <circle cx="14" cy="14" r={outerR} stroke={strokeOuter} strokeWidth="1.5" fill="none" pointerEvents="none" />
        {/* Crosshair lines - gap widens on panel hover to look like a hand cursor */}
        <line x1="14" y1="2" x2="14" y2={gapInner} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" pointerEvents="none" />
        <line x1="14" y1={28 - gapInner} x2="14" y2="26" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" pointerEvents="none" />
        <line x1="2" y1="14" x2={gapInner} y2="14" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" pointerEvents="none" />
        <line x1={28 - gapOuter} y1="14" x2="26" y2="14" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" pointerEvents="none" />
        {/* Centre dot - square on panel hover to echo a pointer/cursor icon */}
        {overPanel ? (
          <rect x="12.5" y="12.5" width="3" height="3" fill={fillDot} rx="0.5" pointerEvents="none" />
        ) : (
          <circle cx="14" cy="14" r="1" fill={fillDot} pointerEvents="none" />
        )}
        {/* Subtle pulse ring on panel hover */}
        {overPanel && (
          <circle cx="14" cy="14" r="7" stroke="rgba(52,211,153,0.25)" strokeWidth="1" fill="none" pointerEvents="none" />
        )}
      </svg>
    </div>
  );
});
