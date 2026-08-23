// Global window property declarations used for cross-cutting state
// communicated between React components and imperative engine code.

export {};

declare global {
  interface Window {
    /** True when the radial context menu is open. Set by RadialContextMenu.tsx,
     *  read by ManipulationManager.ts and SceneEngine.ts to suppress camera
     *  look and raycast selection while the menu overlay is active. */
    __isRadialMenuOpen?: boolean;

    /** True while an immersive WebXR session is active. Set by SceneEngine.ts
     *  on sessionstart/sessionend, read by ManipulationManager.ts to route
     *  pointer events correctly in VR. */
    __NEXUS_VR_PRESENTING?: boolean;

    /** Set by VRRadialMenuMesh.select() when __vrRadialDebug is true.
     *  Enables per-press diagnostic logging for VR radial menu. */
    __vrRadialDebug?: boolean;
  }
}
