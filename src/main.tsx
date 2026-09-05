import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'

// Global safety guard for setPointerCapture / releasePointerCapture.
// Three.js controls (TransformControls, OrbitControls) call setPointerCapture without try/catch.
// When an element is unmounted during a click (e.g. closing an import dialog), or when
// synthetic pointer events are dispatched while pointer lock is active, the browser throws
// an uncaught InvalidStateError. Catching this gracefully prevents crashes across the application.
if (typeof Element !== 'undefined') {
  if (Element.prototype.setPointerCapture) {
    const origSet = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function (pointerId: number) {
      try {
        return origSet.call(this, pointerId);
      } catch (err: any) {
        if (err?.name === 'InvalidStateError' || err?.name === 'NotFoundError') {
          return;
        }
        throw err;
      }
    };
  }
  if (Element.prototype.releasePointerCapture) {
    const origRelease = Element.prototype.releasePointerCapture;
    Element.prototype.releasePointerCapture = function (pointerId: number) {
      try {
        return origRelease.call(this, pointerId);
      } catch (err: any) {
        if (err?.name === 'InvalidStateError' || err?.name === 'NotFoundError') {
          return;
        }
        throw err;
      }
    };
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
