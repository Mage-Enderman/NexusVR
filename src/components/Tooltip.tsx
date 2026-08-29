import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface TooltipProps {
  text: string;
  children: React.ReactElement;
}

/** Delay before the tooltip appears, so sweeping the mouse across a row of
 *  buttons doesn't strobe tooltips (flicker was very noticeable on Navbar /
 *  Toolbar). */
const SHOW_DELAY_MS = 400;

export const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
  const [visible, setVisible] = useState(false);
  // 'above' renders over the trigger; 'below' flips under it. Flipping is
  // decided at show-time: triggers pinned near the viewport top (the whole
  // Navbar!) previously rendered their tooltip off-screen above the page.
  const [pos, setPos] = useState({ x: 0, y: 0, placement: 'above' as 'above' | 'below' });
  const triggerRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const computeAndShow = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // If there isn't room for a ~28px tooltip above the trigger, flip below.
    const placement = rect.top < 40 ? ('below' as const) : ('above' as const);
    setPos({
      x: rect.left + rect.width / 2,
      y: placement === 'above' ? rect.top - 8 : rect.bottom + 8,
      placement,
    });
    setVisible(true);
  }, []);

  const show = useCallback(() => {
    // Touch devices have no hover: without this guard a tap shows a tooltip
    // that never leaves (there is no mouseleave), covering the UI.
    if (window.matchMedia?.('(hover: none)').matches) return;
    clearShowTimer();
    showTimerRef.current = setTimeout(computeAndShow, SHOW_DELAY_MS);
  }, [clearShowTimer, computeAndShow]);

  const hide = useCallback(() => {
    clearShowTimer();
    setVisible(false);
  }, [clearShowTimer]);

  // Reposition while visible (layout shifts / scroll).
  useEffect(() => {
    if (!visible || !triggerRef.current) return;
    computeAndShow();
  }, [visible, computeAndShow]);

  useEffect(() => clearShowTimer, [clearShowTimer]);

  const mergedRef = useCallback((el: HTMLElement | null) => {
    (triggerRef as React.MutableRefObject<HTMLElement | null>).current = el;
    // Preserve original ref if the child has one
    const { ref } = children as any;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }, [children]);

  // Wrap in a span to avoid React 19's cloneElement ref limitation
  return (
    <>
      <span
        ref={mergedRef}
        style={{ display: 'contents' }}
        onMouseEnter={(e) => {
          show();
          (children.props as any).onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          hide();
          (children.props as any).onMouseLeave?.(e);
        }}
        onFocus={(e) => {
          // Keyboard focus shows immediately (no delay) — it's intentional.
          computeAndShow();
          (children.props as any).onFocus?.(e);
        }}
        onBlur={(e) => {
          hide();
          (children.props as any).onBlur?.(e);
        }}
      >
        {children}
      </span>
      {visible && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform: pos.placement === 'above'
              ? 'translate(-50%, -100%)'
              : 'translate(-50%, 0)',
            padding: '6px 10px',
            borderRadius: '8px',
            background: 'rgba(10, 15, 25, 0.95)',
            border: '1px solid rgba(0, 240, 255, 0.3)',
            color: '#e2e8f0',
            fontSize: '11px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 9999,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
            opacity: 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
};
