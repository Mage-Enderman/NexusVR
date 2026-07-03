import { joinRoom } from 'trystero';
import type { Room, JoinRoomConfig, MessageContext } from 'trystero';
import type { TransformUpdate } from '../engine/ManipulationManager.ts';
import type { AvatarTransform } from '../engine/AvatarManager.ts';
import type { AssetType, LoadedAsset } from '../engine/AssetManager.ts';
import type { UserRole, ModerationActionPayload, RoleUpdatePayload } from '../types/permissions.ts';

export type ConnectionMode = 'offline' | 'online' | 'paired';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface AssetSpawnData {
  id: string;
  name: string;
  type: AssetType;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  url?: string;
  primitiveType?: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
  fileData?: ArrayBuffer;
  isCollidable: boolean;
}

export interface SceneStateSnapshot {
  assets: AssetSpawnData[];
  hostId: string;
}

export class NetworkService {
  public mode: ConnectionMode = 'offline';
  public roomId: string | null = null;
  public localPeerId: string;
  public localUserName = 'Traveler';
  public peers: Set<string> = new Set();
  public hostId: string;
  public isHost = true;
  public isCompanion = false;
  
  private room: Room | null = null;
  private localAudioStream: MediaStream | null = null;
  public isMuted = false;
  public isDeafened = false;

  public localRole: UserRole = 'admin';
  public peerRoles: Map<string, UserRole> = new Map();
  public peerNames: Map<string, string> = new Map();
  public bannedPeers: Set<string> = new Set();
  public mutedPeers: Set<string> = new Set();

  // Action senders
  private sendTransform!: (data: TransformUpdate, target?: string) => void;
  private sendAvatar!: (data: AvatarTransform, target?: string) => void;
  private sendSpawn!: (data: AssetSpawnData, target?: string) => void;
  private sendRemove!: (id: string, target?: string) => void;
  private sendChat!: (msg: ChatMessage, target?: string) => void;
  private sendSyncReq!: (req: { from: string }, target?: string) => void;
  private sendSyncResp!: (snapshot: SceneStateSnapshot, target?: string) => void;
  private sendRole!: (data: RoleUpdatePayload, target?: string) => void;
  private sendMod!: (data: ModerationActionPayload, target?: string) => void;
  private sendHandshake!: (data: { peerId: string; userName: string; role: UserRole }, target?: string) => void;

  // Event callbacks
  private onPeerJoinCallbacks: Set<(peerId: string) => void> = new Set();
  private onPeerLeaveCallbacks: Set<(peerId: string) => void> = new Set();
  private onHostChangeCallbacks: Set<(newHostId: string, isSelf: boolean) => void> = new Set();
  private onTransformCallbacks: Set<(update: TransformUpdate) => void> = new Set();
  private onAvatarCallbacks: Set<(update: AvatarTransform) => void> = new Set();
  private onSpawnCallbacks: Set<(data: AssetSpawnData) => void> = new Set();
  private onRemoveCallbacks: Set<(id: string) => void> = new Set();
  private onChatCallbacks: Set<(msg: ChatMessage) => void> = new Set();
  private onStreamCallbacks: Set<(stream: MediaStream, peerId: string) => void> = new Set();
  private onSyncReqCallbacks: Set<(fromPeerId: string) => void> = new Set();
  private onSyncRespCallbacks: Set<(snapshot: SceneStateSnapshot) => void> = new Set();
  private onRoleCallbacks: Set<(data: RoleUpdatePayload) => void> = new Set();
  private onModCallbacks: Set<(data: ModerationActionPayload) => void> = new Set();

  constructor() {
    this.localPeerId = `peer-${Math.random().toString(36).substring(2, 9)}`;
    this.hostId = this.localPeerId;
  }

  public async initSession(roomId: string, mode: ConnectionMode = 'online', isCompanion = false): Promise<void> {
    // Fire-and-forget cleanup of the previous room. disconnect() nulls the
    // room's peer event handlers synchronously before awaiting `leave()`, so
    // no stale callbacks from the old room can leak into the new session
    // even though we don't block on the teardown.
    this.disconnect();

    this.mode = mode;
    this.roomId = roomId;
    this.isCompanion = isCompanion;
    
    // STUN servers are critical for WebRTC NAT traversal — without them, peers
    // on different home networks can't establish a connection and the room
    // appears empty on both sides (both clients believe they are host).
    // TURN servers relay traffic when STUN alone can't punch through
    // (symmetric NATs, strict corporate firewalls, some mobile carriers).
    const config: JoinRoomConfig = {
      appId: 'nexusvr-p2p-metaverse-v1',
      rtcConfig: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          // Free TURN/STUN relay from Open Relay Project (openrelay.metered.ca)
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
      },
      // Explicit relay URLs: trystero defaults include many small/unreliable
      // relays. Specifying a curated set of well-known, high-uptime Nostr
      // relays ensures peers can discover each other via the signaling phase.
      // Redundancy of 6 means 6 relays are used simultaneously so discovery
      // succeeds even if a couple are temporarily down.
      relayConfig: {
        urls: [
          'wss://relay.damus.io',
          'wss://nos.lol',
          'wss://relay.primal.net',
          'wss://nostr-pub.wellorder.net',
          'wss://relay.nostr.band',
          'wss://nostr.wine',
          'wss://relay.snort.social',
          'wss://eden.nostr.land',
          'wss://nostr.mom',
          'wss://relay.orangepill.dev'
        ],
        redundancy: 6
      }
    };
    this.room = joinRoom(config, roomId, {
      onJoinError: (err) => {
        console.error('Trystero join error:', err);
        // JoinError is a tagged union — safely stringify without assuming
        // it has a `.message` property.
        const reason = err ? String((err as { message?: unknown }).message ?? err) : 'Check your internet connection.';
        this.notifySystemChat(`Network error: failed to join room. ${reason}`);
      }
    });
    
    // Setup Action channels. We pass `onMessage` via MessageActionConfig so
    // there's no race window between `makeAction` returning and the handler
    // being attached — messages that arrive in that gap would otherwise be
    // silently dropped (onMessage defaults to null on a freshly-built action).
    // All actions use `<any>` as the payload generic because Trystero's
    // `DataPayload` constraint (JsonValue | Blob | ArrayBuffer | ArrayBufferView)
    // rejects interfaces that contain tuple types or nested object types, even
    // when they're fully JSON-serializable at runtime. The `onMessage` handlers
    // below re-apply the proper TypeScript type to the payload so the rest of
    // the codebase keeps full type safety.
    const transAction = this.room.makeAction<any>('trans', {
      onMessage: (data: TransformUpdate) => { for (const cb of this.onTransformCallbacks) cb(data); }
    });
    const avAction = this.room.makeAction<any>('av', {
      onMessage: (data: AvatarTransform) => { for (const cb of this.onAvatarCallbacks) cb(data); }
    });
    const spAction = this.room.makeAction<any>('spawn', {
      onMessage: (data: AssetSpawnData) => { for (const cb of this.onSpawnCallbacks) cb(data); }
    });
    const remAction = this.room.makeAction<any>('rem', {
      onMessage: (id: string) => { for (const cb of this.onRemoveCallbacks) cb(id); }
    });
    const chAction = this.room.makeAction<any>('chat', {
      onMessage: (msg: ChatMessage) => { for (const cb of this.onChatCallbacks) cb(msg); }
    });
    const reqAction = this.room.makeAction<any>('syncreq', {
      onMessage: (_req: { from: string }, context: MessageContext) => {
        if (this.isHost) {
          for (const cb of this.onSyncReqCallbacks) cb(context.peerId);
        }
      }
    });
    const respAction = this.room.makeAction<any>('syncresp', {
      onMessage: (snapshot: SceneStateSnapshot) => { for (const cb of this.onSyncRespCallbacks) cb(snapshot); }
    });
    const roleAction = this.room.makeAction<any>('role', {
      onMessage: (data: RoleUpdatePayload) => {
        this.peerRoles.set(data.targetPeerId, data.newRole);
        if (data.targetPeerId === this.localPeerId) {
          this.localRole = data.newRole;
          this.notifySystemChat(`Your permission role was updated to: ${data.newRole.toUpperCase()}`);
        }
        for (const cb of this.onRoleCallbacks) cb(data);
      }
    });
    const modAction = this.room.makeAction<any>('mod', {
      onMessage: (data: ModerationActionPayload) => {
        if (data.action === 'silence') {
          this.mutedPeers.add(data.targetPeerId);
        } else if (data.action === 'unsilence') {
          this.mutedPeers.delete(data.targetPeerId);
        } else if (data.action === 'ban') {
          this.bannedPeers.add(data.targetPeerId);
        }
        for (const cb of this.onModCallbacks) cb(data);
      }
    });
    const hsAction = this.room.makeAction<{ peerId: string; userName: string; role: UserRole }>('hs', {
      onMessage: (data, context) => {
        if (this.bannedPeers.has(context.peerId)) {
          this.sendMod({ action: 'ban', targetPeerId: context.peerId, fromPeerId: this.localPeerId, reason: 'You are banned from this session.' }, context.peerId);
          return;
        }
        this.peerNames.set(data.peerId || context.peerId, data.userName || 'Traveler');
        if (data.role) this.peerRoles.set(data.peerId || context.peerId, data.role);
      }
    });

    this.sendTransform = (data, target) => transAction.send(data, target ? { target } : undefined);
    this.sendAvatar = (data, target) => avAction.send(data, target ? { target } : undefined);
    this.sendSpawn = (data, target) => spAction.send(data, target ? { target } : undefined);
    this.sendRemove = (data, target) => remAction.send(data, target ? { target } : undefined);
    this.sendChat = (data, target) => chAction.send(data, target ? { target } : undefined);
    this.sendSyncReq = (data, target) => reqAction.send(data, target ? { target } : undefined);
    this.sendSyncResp = (data, target) => respAction.send(data, target ? { target } : undefined);
    this.sendRole = (data, target) => roleAction.send(data, target ? { target } : undefined);
    this.sendMod = (data, target) => modAction.send(data, target ? { target } : undefined);
    this.sendHandshake = (data, target) => hsAction.send(data, target ? { target } : undefined);

    // Peer lifecycle in Trystero 0.25: properties on room
    this.room.onPeerJoin = (peerId: string) => {
      if (this.bannedPeers.has(peerId)) {
        this.sendMod({ action: 'ban', targetPeerId: peerId, fromPeerId: this.localPeerId, reason: 'Banned' }, peerId);
        return;
      }
      this.peers.add(peerId);
      this.evaluateHost();
      
      // Send handshake
      this.sendHandshake({
        peerId: this.localPeerId,
        userName: this.localUserName,
        role: this.localRole
      }, peerId);

      // If the peer who just joined is the host, request initial scene sync
      // directly from them. The previous 1-second setTimeout race was
      // unreliable: Nostr relay discovery often takes 2–5 seconds, so the
      // timer would fire before `this.peers` was populated and the request
      // would be skipped. Tying the request to `onPeerJoin` (which only fires
      // once a real peer connection is established) fixes that.
      if (!this.isHost && peerId === this.hostId) {
        this.sendSyncReq({ from: this.localPeerId }, peerId);
      }

      for (const cb of this.onPeerJoinCallbacks) cb(peerId);

      this.notifySystemChat(`User joined the room`);

      if (this.localAudioStream && !this.isMuted) {
        this.room?.addStream(this.localAudioStream, { target: peerId });
      }
    };

    this.room.onPeerLeave = (peerId: string) => {
      this.peers.delete(peerId);
      this.peerRoles.delete(peerId);
      this.peerNames.delete(peerId);
      this.evaluateHost();
      for (const cb of this.onPeerLeaveCallbacks) cb(peerId);
      this.notifySystemChat(`User left the room`);
    };

    this.room.onPeerStream = (stream: MediaStream, peerId: string) => {
      if (this.isDeafened) return;
      for (const cb of this.onStreamCallbacks) cb(stream, peerId);
    };

  }

  private evaluateHost(): void {
    const allIds = [this.localPeerId, ...Array.from(this.peers)].sort();
    const newHostId = allIds[0];
    const oldIsHost = this.isHost;
    
    this.hostId = newHostId;
    this.isHost = (newHostId === this.localPeerId);

    if (this.isHost !== oldIsHost) {
      for (const cb of this.onHostChangeCallbacks) cb(this.hostId, this.isHost);
      if (this.isHost) {
        this.notifySystemChat(`Host migrated. You are now the authoritative Host.`);
      }
    }
  }

  private notifySystemChat(text: string): void {
    const msg: ChatMessage = {
      id: `sys-${Date.now()}`,
      senderId: 'system',
      senderName: 'System',
      text,
      timestamp: Date.now(),
      isSystem: true
    };
    for (const cb of this.onChatCallbacks) cb(msg);
  }

  // Broadcast Actions
  public broadcastTransform(update: TransformUpdate): void {
    if (this.mode === 'offline') return;
    this.sendTransform?.(update);
  }

  /**
   * Convenience: derive a TransformUpdate from a LoadedAsset and broadcast
   * it to peers. Used by inspector edits, "Bring To Me", and other UI-driven
   * asset mutations that don't go through the gizmo.
   */
  public broadcastAssetUpdate(asset: LoadedAsset): void {
    if (this.mode === 'offline') return;
    const obj = asset.object3d;
    this.sendTransform?.({
      assetId: asset.id,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      isCollidable: asset.isCollidable
    });
  }

  public broadcastAvatar(update: AvatarTransform): void {
    if (this.mode === 'offline') return;
    this.sendAvatar?.(update);
  }

  public broadcastSpawn(data: AssetSpawnData): void {
    if (this.mode === 'offline') return;
    this.sendSpawn?.(data);
  }

  public broadcastRemove(id: string): void {
    if (this.mode === 'offline') return;
    this.sendRemove?.(id);
  }

  public sendChatMessage(text: string): ChatMessage {
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      senderId: this.localPeerId,
      senderName: this.localUserName,
      text,
      timestamp: Date.now()
    };
    if (this.mode !== 'offline') {
      this.sendChat?.(msg);
    }
    for (const cb of this.onChatCallbacks) cb(msg);
    return msg;
  }

  public sendSceneSnapshot(targetPeerId: string, assets: AssetSpawnData[]): void {
    if (!this.isHost || this.mode === 'offline') return;
    const snapshot: SceneStateSnapshot = {
      assets,
      hostId: this.hostId
    };
    this.sendSyncResp?.(snapshot, targetPeerId);
  }

  // Voice Chat Controls
  public async enableVoiceChat(): Promise<boolean> {
    try {
      if (!this.localAudioStream) {
        this.localAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
      }

      this.isMuted = false;
      this.localAudioStream.getAudioTracks().forEach(track => track.enabled = true);

      if (this.room) {
        this.room.addStream(this.localAudioStream);
      }
      return true;
    } catch (err) {
      console.warn('Microphone access denied or unavailable:', err);
      return false;
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.localAudioStream) {
      this.localAudioStream.getAudioTracks().forEach(track => track.enabled = !this.isMuted);
    }
    if (this.isMuted && this.room && this.localAudioStream) {
      this.room.removeStream(this.localAudioStream);
    } else if (!this.isMuted && this.room && this.localAudioStream) {
      this.room.addStream(this.localAudioStream);
    }
    return this.isMuted;
  }

  public toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    return this.isDeafened;
  }

  // Event Registration
  public onPeerJoin(cb: (peerId: string) => void): () => void {
    this.onPeerJoinCallbacks.add(cb);
    return () => this.onPeerJoinCallbacks.delete(cb);
  }
  public onPeerLeave(cb: (peerId: string) => void): () => void {
    this.onPeerLeaveCallbacks.add(cb);
    return () => this.onPeerLeaveCallbacks.delete(cb);
  }
  public onHostChange(cb: (newHostId: string, isSelf: boolean) => void): () => void {
    this.onHostChangeCallbacks.add(cb);
    return () => this.onHostChangeCallbacks.delete(cb);
  }
  public onTransform(cb: (update: TransformUpdate) => void): () => void {
    this.onTransformCallbacks.add(cb);
    return () => this.onTransformCallbacks.delete(cb);
  }
  public onAvatar(cb: (update: AvatarTransform) => void): () => void {
    this.onAvatarCallbacks.add(cb);
    return () => this.onAvatarCallbacks.delete(cb);
  }
  public onSpawn(cb: (data: AssetSpawnData) => void): () => void {
    this.onSpawnCallbacks.add(cb);
    return () => this.onSpawnCallbacks.delete(cb);
  }
  public onRemove(cb: (id: string) => void): () => void {
    this.onRemoveCallbacks.add(cb);
    return () => this.onRemoveCallbacks.delete(cb);
  }
  public onChat(cb: (msg: ChatMessage) => void): () => void {
    this.onChatCallbacks.add(cb);
    return () => this.onChatCallbacks.delete(cb);
  }
  public onStream(cb: (stream: MediaStream, peerId: string) => void): () => void {
    this.onStreamCallbacks.add(cb);
    return () => this.onStreamCallbacks.delete(cb);
  }
  public onSyncReq(cb: (fromPeerId: string) => void): () => void {
    this.onSyncReqCallbacks.add(cb);
    return () => this.onSyncReqCallbacks.delete(cb);
  }
  public onSyncResp(cb: (snapshot: SceneStateSnapshot) => void): () => void {
    this.onSyncRespCallbacks.add(cb);
    return () => this.onSyncRespCallbacks.delete(cb);
  }
  public onRoleUpdate(cb: (data: RoleUpdatePayload) => void): () => void {
    this.onRoleCallbacks.add(cb);
    return () => this.onRoleCallbacks.delete(cb);
  }
  public onModerationAction(cb: (data: ModerationActionPayload) => void): () => void {
    this.onModCallbacks.add(cb);
    return () => this.onModCallbacks.delete(cb);
  }

  public broadcastRoleUpdate(targetPeerId: string, newRole: UserRole): void {
    this.peerRoles.set(targetPeerId, newRole);
    if (targetPeerId === this.localPeerId) {
      this.localRole = newRole;
    }
    if (this.mode !== 'offline') {
      this.sendRole?.({ targetPeerId, newRole, fromPeerId: this.localPeerId });
    }
  }

  public broadcastModeration(action: 'kick' | 'ban' | 'silence' | 'unsilence' | 'respawn', targetPeerId: string, reason?: string): void {
    if (action === 'silence') {
      this.mutedPeers.add(targetPeerId);
    } else if (action === 'unsilence') {
      this.mutedPeers.delete(targetPeerId);
    } else if (action === 'ban') {
      this.bannedPeers.add(targetPeerId);
    }
    if (this.mode !== 'offline') {
      this.sendMod?.({ action, targetPeerId, fromPeerId: this.localPeerId, reason });
    }
  }

  public async disconnect(): Promise<void> {
    if (this.room) {
      // Detach all peer event handlers before leaving so stale callbacks
      // from the old room can't corrupt the new session's state when
      // `initSession` is called again (e.g. after a room switch).
      this.room.onPeerJoin = null;
      this.room.onPeerLeave = null;
      this.room.onPeerStream = null;
      this.room.onPeerTrack = null;
      if (this.localAudioStream) {
        this.room.removeStream(this.localAudioStream);
      }
      await this.room.leave();
      this.room = null;
    }
    this.peers.clear();
    this.peerRoles.clear();
    this.peerNames.clear();
    this.mode = 'offline';
    this.roomId = null;
    this.isHost = true;
    this.hostId = this.localPeerId;
  }
}
