import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface TooltipProps {
  text: string;
  children: React.ReactElement;
}

export const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
    setVisible(true);
  }, []);

  const hide = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (!visible || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  }, [visible]);

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
          show();
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
            transform: 'translate(-50%, -100%)',
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
