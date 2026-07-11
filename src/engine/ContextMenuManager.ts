export interface ContextMenuItemDef {
  id: string;
  label: string;
  subLabel?: string;
  color: string;
  icon?: string; // e.g. 'mic', 'redo', 'undo', 'locomotion', 'scaling', 'laser', 'grab', 'grid', 'shield', 'bookmark', 'copy', 'download', 'trash', 'lightbulb', 'zap', 'sun', 'eyeoff', 'palette', 'x', 'back', 'custom'
  closeOnClick?: boolean; // defaults to true unless specified false or item opens a submenu
  action?: () => void;
  submenu?: ContextMenuItemDef[]; // Child menu items for ContextMenuSubmenu support
}

export interface ComputedArcSlice extends ContextMenuItemDef {
  startDeg: number;
  endDeg: number;
}

export interface ContextMenuContext {
  locomotionMode: 'walk' | 'flight' | 'noclip';
  scalingEnabled: boolean;
  laserEnabled: boolean;
  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  isHeld?: boolean;
  heldAssetType?: string | null;
  heldAssetCustomItems?: ContextMenuItemDef[];
  isMuted?: boolean;
  activeTool?: string | null;
  noShadows?: boolean;
  lightColor?: string;
  selectionMode?: 'single' | 'multi';
  gizmoMode?: 'translate' | 'rotate' | 'scale';
  gizmoSpace?: 'local' | 'world';
  // Actions
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleMute?: () => void;
  onNextLocomotion?: () => void;
  onToggleScaling?: () => void;
  onToggleLaser?: () => void;
  onNextGrabMode?: () => void;
  onSaveHeld?: () => void;
  onDuplicate?: () => void;
  onDownloadHeld?: () => void;
  onDestroy?: () => void;
  onSpawnPointLight?: () => void;
  onSpawnSpotLight?: () => void;
  onSpawnSunLight?: () => void;
  onToggleNoShadows?: () => void;
  onChangeLightColor?: () => void;
  onUnequipTool?: () => void;
  onOpenInspector?: () => void;
  onToggleSelectionMode?: () => void;
  onDeselectAll?: () => void;
  onSetGizmoMode?: (mode: 'translate' | 'rotate' | 'scale') => void;
  onToggleGizmoSpace?: () => void;
  onSpawnPrimitive?: (type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane') => void;
}

/**
 * Dynamically partitions 360 degrees around the radial menu for any number of items.
 * 0 deg is North (top), increasing clockwise.
 */
export function computeArcSlices(items: ContextMenuItemDef[], separationDeg = 6): ComputedArcSlice[] {
  const n = items.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{
      ...items[0],
      startDeg: -180 + separationDeg / 2,
      endDeg: 180 - separationDeg / 2,
    }];
  }

  const spanPerItem = 360 / n;
  const actualSeparation = Math.min(separationDeg, spanPerItem * 0.25);
  const sliceWidth = spanPerItem - actualSeparation;

  return items.map((item, i) => {
    const centerDeg = i * spanPerItem;
    return {
      ...item,
      startDeg: centerDeg - sliceWidth / 2,
      endDeg: centerDeg + sliceWidth / 2,
    };
  });
}

/**
 * Single source of truth for generating active context menu items across VR and Desktop.
 * Guarantees 1:1 parity between VR and Desktop menus.
 */
export function buildActiveMenuItems(
  context: ContextMenuContext,
  activeTab: 'general' | 'grab' | 'held' | 'light' | 'dev' = 'general'
): ContextMenuItemDef[] {
  // 1. Dev Tool override (Resonite Dev Tool equipped)
  if (context.activeTool === 'dev' || activeTab === 'dev') {
    return [
      {
        id: 'redo',
        label: 'Redo',
        subLabel: 'Next Action',
        color: '#64748b',
        icon: 'redo',
        action: context.onRedo,
        closeOnClick: true,
      },
      {
        id: 'locomotion',
        label: 'Locomotion',
        subLabel: context.locomotionMode === 'walk' ? 'Walk/Run (with climbing)' : context.locomotionMode,
        color: '#f59e0b',
        icon: 'locomotion',
        action: context.onNextLocomotion,
        closeOnClick: false,
      },
      {
        id: 'scaling',
        label: 'Scaling',
        subLabel: context.scalingEnabled ? 'Enabled' : 'Disabled',
        color: context.scalingEnabled ? '#10b981' : '#ef4444',
        icon: 'scaling',
        action: context.onToggleScaling,
        closeOnClick: false,
      },
      {
        id: 'create',
        label: 'Create New...',
        subLabel: 'Spawn Object',
        color: '#22c55e',
        icon: 'create',
        closeOnClick: false,
        submenu: [
          {
            id: 'spawn_cube',
            label: '3D Cube',
            subLabel: 'Primitive',
            color: '#00f0ff',
            icon: 'cube',
            action: () => context.onSpawnPrimitive?.('cube'),
            closeOnClick: true,
          },
          {
            id: 'spawn_sphere',
            label: '3D Sphere',
            subLabel: 'Primitive',
            color: '#00f0ff',
            icon: 'sphere',
            action: () => context.onSpawnPrimitive?.('sphere'),
            closeOnClick: true,
          },
          {
            id: 'spawn_cylinder',
            label: 'Cylinder',
            subLabel: 'Primitive',
            color: '#00f0ff',
            icon: 'cylinder',
            action: () => context.onSpawnPrimitive?.('cylinder'),
            closeOnClick: true,
          },
          {
            id: 'spawn_plane',
            label: 'Plane',
            subLabel: 'Primitive',
            color: '#00f0ff',
            icon: 'plane',
            action: () => context.onSpawnPrimitive?.('plane'),
            closeOnClick: true,
          },
          {
            id: 'spawn_point_light',
            label: 'Point Light',
            subLabel: 'Light',
            color: '#f59e0b',
            icon: 'lightbulb',
            action: () => context.onSpawnPointLight?.(),
            closeOnClick: true,
          },
          {
            id: 'spawn_spot_light',
            label: 'Spot Light',
            subLabel: 'Light',
            color: '#00f0ff',
            icon: 'zap',
            action: () => context.onSpawnSpotLight?.(),
            closeOnClick: true,
          },
        ],
      },
      {
        id: 'inspector',
        label: 'Open Inspector',
        subLabel: 'Scene Inspector',
        color: '#f8fafc',
        icon: 'inspector',
        action: context.onOpenInspector,
        closeOnClick: true,
      },
      {
        id: 'gizmo',
        label: 'Gizmo Options',
        subLabel: context.gizmoMode ? context.gizmoMode.toUpperCase() : 'TRANSLATE',
        color: '#10b981',
        icon: 'gizmo',
        closeOnClick: false,
        submenu: [
          {
            id: 'gizmo_translate',
            label: 'Translate',
            subLabel: context.gizmoMode === 'translate' ? 'Active' : 'Move Gizmo',
            color: context.gizmoMode === 'translate' ? '#10b981' : '#94a3b8',
            icon: 'move',
            action: () => context.onSetGizmoMode?.('translate'),
            closeOnClick: true,
          },
          {
            id: 'gizmo_rotate',
            label: 'Rotate',
            subLabel: context.gizmoMode === 'rotate' ? 'Active' : 'Rotate Gizmo',
            color: context.gizmoMode === 'rotate' ? '#10b981' : '#94a3b8',
            icon: 'redo',
            action: () => context.onSetGizmoMode?.('rotate'),
            closeOnClick: true,
          },
          {
            id: 'gizmo_scale',
            label: 'Scale',
            subLabel: context.gizmoMode === 'scale' ? 'Active' : 'Scale Gizmo',
            color: context.gizmoMode === 'scale' ? '#10b981' : '#94a3b8',
            icon: 'scaling',
            action: () => context.onSetGizmoMode?.('scale'),
            closeOnClick: true,
          },
          {
            id: 'gizmo_space',
            label: context.gizmoSpace === 'world' ? 'World Space' : 'Local Space',
            subLabel: 'Toggle Space',
            color: '#00f0ff',
            icon: 'grid',
            action: () => context.onToggleGizmoSpace?.(),
            closeOnClick: false,
          },
        ],
      },
      {
        id: 'selectionMode',
        label: context.selectionMode === 'multi' ? 'Multi' : 'Single',
        subLabel: 'Selection Mode',
        color: '#d946ef',
        icon: 'selectionMode',
        action: context.onToggleSelectionMode,
        closeOnClick: false,
      },
      {
        id: 'deselectAll',
        label: 'Deselect All',
        subLabel: 'Clear Selection',
        color: '#f97316',
        icon: 'deselectAll',
        action: context.onDeselectAll,
        closeOnClick: true,
      },
      {
        id: 'destroy',
        label: 'Destroy Selected',
        subLabel: 'Remove Object',
        color: '#ef4444',
        icon: 'trash',
        action: context.onDestroy,
        closeOnClick: true,
      },
      {
        id: 'unequip',
        label: 'Dequip',
        subLabel: 'Unequip Tool',
        color: '#f8fafc',
        icon: 'unequip',
        action: context.onUnequipTool,
        closeOnClick: true,
      },
      {
        id: 'undo',
        label: 'Undo',
        subLabel: 'Last Action',
        color: '#ef4444',
        icon: 'undo',
        action: context.onUndo,
        closeOnClick: true,
      },
    ];
  }

  // 2. Tool overrides (e.g. Light Tool)
  if (context.activeTool === 'light' || activeTab === 'light') {
    return [
      {
        id: 'destroy',
        label: 'Destroy',
        subLabel: 'Remove Object',
        color: '#ef4444',
        icon: 'trash',
        action: context.onDestroy,
        closeOnClick: true,
      },
      {
        id: 'undo',
        label: 'Undo',
        subLabel: 'Last Action',
        color: '#a855f7',
        icon: 'undo',
        action: context.onUndo,
        closeOnClick: true,
      },
      {
        id: 'redo',
        label: 'Redo',
        subLabel: 'Next Action',
        color: '#6366f1',
        icon: 'redo',
        action: context.onRedo,
        closeOnClick: true,
      },
      {
        id: 'locomotion',
        label: 'Locomotion',
        subLabel: context.locomotionMode,
        color: '#f59e0b',
        icon: 'locomotion',
        action: context.onNextLocomotion,
        closeOnClick: false,
      },
      {
        id: 'scaling',
        label: 'Scaling',
        subLabel: context.scalingEnabled ? 'Enabled' : 'Disabled',
        color: context.scalingEnabled ? '#10b981' : '#ef4444',
        icon: 'scaling',
        action: context.onToggleScaling,
        closeOnClick: false,
      },
      {
        id: 'point',
        label: 'Point Light',
        subLabel: 'Spawn',
        color: '#f59e0b',
        icon: 'lightbulb',
        action: context.onSpawnPointLight,
        closeOnClick: true,
      },
      {
        id: 'spot',
        label: 'Spot Light',
        subLabel: 'Spawn',
        color: '#00f0ff',
        icon: 'zap',
        action: context.onSpawnSpotLight,
        closeOnClick: true,
      },
      {
        id: 'sun',
        label: 'Sun Light',
        subLabel: 'Spawn',
        color: '#ffffff',
        icon: 'sun',
        action: context.onSpawnSunLight,
        closeOnClick: true,
      },
      {
        id: 'noshadows',
        label: 'No Shadows',
        subLabel: context.noShadows ? 'On' : 'Off',
        color: context.noShadows ? '#f59e0b' : '#94a3b8',
        icon: 'eyeoff',
        action: context.onToggleNoShadows,
        closeOnClick: false,
      },
      {
        id: 'color',
        label: 'Change Color',
        color: context.lightColor || '#00f0ff',
        icon: 'palette',
        action: context.onChangeLightColor,
        closeOnClick: false,
      },
      {
        id: 'unequip',
        label: 'Unequip Tool',
        subLabel: 'Close',
        color: '#94a3b8',
        icon: 'x',
        action: context.onUnequipTool,
        closeOnClick: true,
      },
    ];
  }

  // 2. Held Object menu (standard actions + any custom items attached to the held asset)
  if (context.isHeld || activeTab === 'held') {
    const baseHeldItems: ContextMenuItemDef[] = [
      {
        id: 'save',
        label: 'Save Held',
        subLabel: 'To Inventory',
        color: '#f59e0b',
        icon: 'bookmark',
        action: context.onSaveHeld,
        closeOnClick: true,
      },
      {
        id: 'copy',
        label: context.heldAssetType === 'misc' ? 'Download' : 'Duplicate',
        subLabel: context.heldAssetType === 'misc' ? 'Save File' : 'Make Copy',
        color: '#06b6d4',
        icon: context.heldAssetType === 'misc' ? 'download' : 'copy',
        action: context.heldAssetType === 'misc' ? context.onDownloadHeld : context.onDuplicate,
        closeOnClick: true,
      },
      {
        id: 'destroy',
        label: 'Destroy',
        subLabel: 'Remove',
        color: '#ef4444',
        icon: 'trash',
        action: context.onDestroy,
        closeOnClick: true,
      },
    ];

    if (context.heldAssetCustomItems && context.heldAssetCustomItems.length > 0) {
      return [...baseHeldItems, ...context.heldAssetCustomItems];
    }
    return baseHeldItems;
  }

  // 3. Grab settings menu
  if (activeTab === 'grab') {
    return [
      {
        id: 'mute',
        label: 'Mute',
        subLabel: context.isMuted ? 'Muted' : 'Live',
        color: context.isMuted ? '#ef4444' : '#10b981',
        icon: 'mic',
        action: context.onToggleMute,
        closeOnClick: true,
      },
      {
        id: 'redo',
        label: 'Redo',
        color: '#6366f1',
        icon: 'redo',
        action: context.onRedo,
        closeOnClick: true,
      },
      {
        id: 'grabMode',
        label: 'Grab Mode',
        subLabel: context.grabMode.toUpperCase(),
        color: '#f59e0b',
        icon: 'grab',
        action: context.onNextGrabMode,
        closeOnClick: false,
      },
      {
        id: 'grid',
        label: 'Snap Grid',
        subLabel: 'Toggle',
        color: '#06b6d4',
        icon: 'grid',
        closeOnClick: false,
      },
      {
        id: 'collision',
        label: 'Collision',
        subLabel: 'Toggle',
        color: '#a855f7',
        icon: 'shield',
        closeOnClick: false,
      },
      {
        id: 'undo',
        label: 'Undo',
        color: '#6366f1',
        icon: 'undo',
        action: context.onUndo,
        closeOnClick: true,
      },
    ];
  }

  // 4. Default Root general context menu
  return [
    {
      id: 'mute',
      label: 'Mute',
      subLabel: context.isMuted ? 'Muted' : 'Live',
      color: context.isMuted ? '#ef4444' : '#10b981',
      icon: 'mic',
      action: context.onToggleMute,
      closeOnClick: true,
    },
    {
      id: 'redo',
      label: 'Redo',
      color: '#6366f1',
      icon: 'redo',
      action: context.onRedo,
      closeOnClick: true,
    },
    {
      id: 'locomotion',
      label: 'Locomotion',
      subLabel: context.locomotionMode,
      color: '#f59e0b',
      icon: 'locomotion',
      action: context.onNextLocomotion,
      closeOnClick: false,
    },
    {
      id: 'scaling',
      label: 'Scaling',
      subLabel: context.scalingEnabled ? 'Enabled' : 'Disabled',
      color: context.scalingEnabled ? '#10b981' : '#ef4444',
      icon: 'scaling',
      action: context.onToggleScaling,
      closeOnClick: false,
    },
    {
      id: 'laser',
      label: 'Laser',
      subLabel: context.laserEnabled ? 'Enabled' : 'Disabled',
      color: context.laserEnabled ? '#00f0ff' : '#94a3b8',
      icon: 'laser',
      action: context.onToggleLaser,
      closeOnClick: false,
    },
    {
      id: 'undo',
      label: 'Undo',
      color: '#6366f1',
      icon: 'undo',
      action: context.onUndo,
      closeOnClick: true,
    },
  ];
}
