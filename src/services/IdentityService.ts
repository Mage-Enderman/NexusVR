/**
 * IdentityService — UUID-based player identity and permission groups.
 * Inspired by BasisVR's BasisDID (UUID identity) and hierarchical permission
 * groups with parent inheritance and global lock system.
 *
 * Key features:
 * - Persistent UUID generated once and stored in IndexedDB/localStorage
 * - Permission groups with parent inheritance
 * - Global lock flags (server-pushed)
 * - Permission node checking
 */

import { v4 as uuidv4 } from 'uuid';

// ─── Permission Types ───────────────────────────────────────────────────────

export type PermissionNode =
  | 'basis.moderation.kick'
  | 'basis.moderation.ban'
  | 'basis.moderation.ipban'
  | 'basis.moderation.mute'
  | 'basis.moderation.forceavatar'
  | 'basis.moderation.locomotionoverride'
  | 'basis.moderation.shout'
  | 'basis.moderation.globallock'
  | 'basis.moderation.configuration'
  | 'basis.chat.lockbypass'
  | 'basis.voice.lockbypass'
  | 'basis.prop.grab'
  | 'basis.prop.spawn'
  | 'basis.world.change'
  | 'basis.avatar.change'
  | 'basis.protection'
  | string; // Allow custom nodes

export interface PermissionGroup {
  name: string;
  nodes: PermissionNode[];
  parents: string[]; // parent group names (inherited)
}

export interface PermissionUser {
  uuid: string;
  displayName: string;
  groups: string[];
  nodes: PermissionNode[];
}

// ─── Global Lock Flags ──────────────────────────────────────────────────────

export interface GlobalLockState {
  avatarsLocked: boolean;
  propsLocked: boolean;
  worldsLocked: boolean;
  textChatLocked: boolean;
  voiceChatLocked: boolean;
  mediaPlayerLocked: boolean;
  cameraCaptureLocked: boolean;
  propGrabbingLocked: boolean;
  thirdPersonDisabled: boolean;
  directConnectLocked: boolean;
  cilboxLocked: boolean;
  imagesLocked: boolean;
}

// ─── Identity Service ───────────────────────────────────────────────────────

const STORAGE_KEY = 'nexus_player_uuid';
const DISPLAY_NAME_KEY = 'nexus_display_name';

export class IdentityService {
  private static _uuid: string | null = null;
  private static _displayName: string = 'Traveler';

  // Permission groups
  private static _groups: Map<string, PermissionGroup> = new Map();
  private static _users: Map<string, PermissionUser> = new Map();

  // Global lock state
  private static _globalLocks: GlobalLockState = {
    avatarsLocked: false,
    propsLocked: false,
    worldsLocked: false,
    textChatLocked: false,
    voiceChatLocked: false,
    mediaPlayerLocked: false,
    cameraCaptureLocked: false,
    propGrabbingLocked: false,
    thirdPersonDisabled: false,
    directConnectLocked: false,
    cilboxLocked: false,
    imagesLocked: false,
  };

  // Local player's permission nodes (resolved from groups)
  private static _localNodes: Set<PermissionNode> = new Set();
  private static _localGroups: Set<string> = new Set();

  /**
   * Initialize identity. Loads or generates a persistent UUID.
   */
  static init(): string {
    if (this._uuid) return this._uuid;

    // Try to load existing UUID
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && stored.length > 0) {
        this._uuid = stored;
        this._displayName = localStorage.getItem(DISPLAY_NAME_KEY) || 'Traveler';
        return this._uuid;
      }
    } catch { /* localStorage unavailable */ }

    // Generate new UUID
    this._uuid = uuidv4();
    try {
      localStorage.setItem(STORAGE_KEY, this._uuid);
    } catch { /* localStorage unavailable */ }

    return this._uuid;
  }

  /** Get the local player's UUID. */
  static get uuid(): string {
    if (!this._uuid) this.init();
    return this._uuid!;
  }

  /** Get/set display name. */
  static get displayName(): string { return this._displayName; }
  static set displayName(name: string) {
    this._displayName = name.trim() || 'Traveler';
    try {
      localStorage.setItem(DISPLAY_NAME_KEY, this._displayName);
    } catch { /* localStorage unavailable */ }
  }

  // ─── Permission Groups ──────────────────────────────────────────────────

  /**
   * Set the full permission snapshot from the server.
   */
  static setPermissionSnapshot(groups: PermissionGroup[], users: PermissionUser[]): void {
    this._groups.clear();
    this._users.clear();
    for (const g of groups) this._groups.set(g.name, g);
    for (const u of users) this._users.set(u.uuid, u);
    this.rebuildLocalPermissions();
  }

  /**
   * Add or remove a permission node for a user.
   */
  static setLocalUserNode(node: PermissionNode, add: boolean): void {
    if (add) this._localNodes.add(node);
    else this._localNodes.delete(node);
  }

  /**
   * Add or remove the local user from a group.
   */
  static setLocalUserGroup(group: string, add: boolean): void {
    if (add) this._localGroups.add(group);
    else this._localGroups.delete(group);
    this.rebuildLocalPermissions();
  }

  /**
   * Check if the local player has a specific permission node.
   * Walks group hierarchy (parent groups inherit their nodes).
   */
  static hasNode(node: PermissionNode): boolean {
    return this._localNodes.has(node);
  }

  /**
   * Check if the local player is in a specific group.
   */
  static inGroup(group: string): boolean {
    return this._localGroups.has(group);
  }

  /**
   * Get all resolved permission nodes for the local player.
   */
  static get localNodes(): ReadonlySet<PermissionNode> {
    return this._localNodes;
  }

  private static rebuildLocalPermissions(): void {
    this._localNodes.clear();
    const visited = new Set<string>();

    const resolveGroup = (groupName: string): void => {
      if (visited.has(groupName)) return; // circular ref guard
      visited.add(groupName);

      const group = this._groups.get(groupName);
      if (!group) return;

      for (const node of group.nodes) this._localNodes.add(node);
      for (const parent of group.parents) resolveGroup(parent);
    };

    for (const groupName of this._localGroups) resolveGroup(groupName);
  }

  // ─── Global Lock State ──────────────────────────────────────────────────

  /** Get the current global lock state. */
  static get globalLocks(): Readonly<GlobalLockState> {
    return this._globalLocks;
  }

  /** Update a specific lock flag (server-pushed). */
  static setGlobalLock(key: keyof GlobalLockState, value: boolean): void {
    this._globalLocks[key] = value;
  }

  /** Update multiple lock flags at once. */
  static setGlobalLocks(locks: Partial<GlobalLockState>): void {
    Object.assign(this._globalLocks, locks);
  }

  /** Reset all locks to defaults (on disconnect). */
  static resetGlobalLocks(): void {
    this._globalLocks = {
      avatarsLocked: false,
      propsLocked: false,
      worldsLocked: false,
      textChatLocked: false,
      voiceChatLocked: false,
      mediaPlayerLocked: false,
      cameraCaptureLocked: false,
      propGrabbingLocked: false,
      thirdPersonDisabled: false,
      directConnectLocked: false,
      cilboxLocked: false,
      imagesLocked: false,
    };
  }

  // ─── Permission Snapshot Serialization ──────────────────────────────────

  /**
   * Serialize the local user's identity for sending to peers/server.
   */
  static serializeIdentity(): {
    uuid: string;
    displayName: string;
    groups: string[];
    nodes: string[];
  } {
    return {
      uuid: this.uuid,
      displayName: this._displayName,
      groups: Array.from(this._localGroups),
      nodes: Array.from(this._localNodes),
    };
  }

  /**
   * Reset everything (on disconnect/reconnect).
   */
  static reset(): void {
    this.resetGlobalLocks();
    this._groups.clear();
    this._users.clear();
    this._localNodes.clear();
    this._localGroups.clear();
  }
}
