export type UserRole = 'admin' | 'builder' | 'moderator' | 'guest' | 'spectator';

export interface UserPermissions {
  canAdmin: boolean;      // Full administrative capabilities of the world and its users
  canEditWorld: boolean;  // Full editing permissions of the world (spawn, delete, transform, environment)
  canModerate: boolean;   // Ability to kick, silence, respawn, and change role of users
  canSpawnItems: boolean; // Ability to interact with the world and spawn items
  canMoveAndChat: boolean;// Base-level permissions (avatar, movement, chat)
}

export const ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
  admin: {
    canAdmin: true,
    canEditWorld: true,
    canModerate: true,
    canSpawnItems: true,
    canMoveAndChat: true,
  },
  builder: {
    canAdmin: false,
    canEditWorld: true,
    canModerate: false,
    canSpawnItems: true,
    canMoveAndChat: true,
  },
  moderator: {
    canAdmin: false,
    canEditWorld: false,
    canModerate: true,
    canSpawnItems: false,
    canMoveAndChat: true,
  },
  guest: {
    canAdmin: false,
    canEditWorld: false,
    canModerate: false,
    canSpawnItems: true,
    canMoveAndChat: true,
  },
  spectator: {
    canAdmin: false,
    canEditWorld: false,
    canModerate: false,
    canSpawnItems: false,
    canMoveAndChat: true,
  },
};

export interface PeerRoleInfo {
  peerId: string;
  userName: string;
  role: UserRole;
  isMuted: boolean;
  isHost: boolean;
  isSelf?: boolean;
}

export interface ModerationActionPayload {
  action: 'kick' | 'ban' | 'silence' | 'unsilence' | 'respawn';
  targetPeerId: string;
  fromPeerId: string;
  reason?: string;
}

export interface RoleUpdatePayload {
  targetPeerId: string;
  newRole: UserRole;
  fromPeerId: string;
}

export interface DefaultPermissionsConfig {
  anonymousDefaultRole: UserRole;
  registeredDefaultRole: UserRole;
  contactsDefaultRole: UserRole;
  hostRole: UserRole;
}
