import * as THREE from 'three';
import Peer, { type DataConnection, type MediaConnection } from 'peerjs';
import type { TransformUpdate } from '../engine/ManipulationManager.ts';
import type { AvatarTransform } from '../engine/AvatarManager.ts';
import type { AssetType, LoadedAsset } from '../engine/AssetManager.ts';
import type { UserRole, ModerationActionPayload, RoleUpdatePayload } from '../types/permissions.ts';
import type { ResoniteLightConfig } from '../engine/ResoniteLightSync.ts';

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
  // Set by buildEnvelope when the original fileData was above
  // MAX_INLINED_FILE_BYTES and stripped from the broadcast to keep
  // WebRTC envelopes under the size that crashes the Quest browser.
  // Receivers should render a "Too Large" placeholder instead of
  // trying to import — see App.tsx onSpawn / onSyncResp handlers.
  fileDataOversized?: boolean;
  isCollidable: boolean;
  // Optional persistent flag. Mirrored on the spawn / scene-snapshot
  // broadcast paths so late-joining guests get the host's pre-existing
  // `userData.isPersistent` value on first import. Receivers should
  // write through to `asset.object3d.userData.isPersistent` so the
  // inspector checkbox and tree-orange-dot indicator both reflect the
  // synced state.
  isPersistent?: boolean;
  materialState?: MaterialUpdate | MaterialUpdate[] | Record<string, MaterialUpdate>;
  videoAspectRatio?: '16:9' | '9:16' | '1:1' | 'auto';
  // Phase 3A: when the host imports a video too large for the sync
  // envelope, the spawn carries `fileData: undefined` +
  // `fileDataOversized: true` AND this streamingHint. Receivers use it
  // to attach a VideoStreamingService receiver and bring up an MSE-
  // backed <video> element which then feeds THREE.VideoTexture via the
  // existing Phase 2 cap.
  streamingHint?: {
    id: string;
    fileSize: number;
    mimeHint?: string;
  };
  p2pTransferHint?: {
    id: string;
    size: number;
  };
  senderPeerId?: string;
}

export interface MaterialUpdate {
  assetId: string;
  materialIndex?: number;
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  wireframe?: boolean;
  flatShading?: boolean;
  normalScale?: number;
  aoMapIntensity?: number;
  map?: string | null;
  normalMap?: string | null;
  roughnessMap?: string | null;
  metalnessMap?: string | null;
  emissiveMap?: string | null;
  aoMap?: string | null;
}

/**
 * Inspector-driven object/component update. Mirrors the editable
 * fields exposed by SceneInspectorWindow that are NOT already covered
 * by the dedicated transform / material / video channels.
 */
export interface InspectorUpdateData {
  assetId: string;
  /** If provided, the update targets this descendant node by UUID;
   *  otherwise the update applies to the asset's root object3d. */
  nodeUuid?: string;
  /** Peer that originated this update. Receivers can skip re-applying
   *  their own broadcasts (echo suppression). */
  senderPeerId?: string;

  // Basic object bits
  name?: string;
  active?: boolean;
  persistent?: boolean;
  tag?: string;

  // Mesh renderer toggle
  meshEnabled?: boolean;

  // Component operations
  resoniteLight?: Partial<ResoniteLightConfig> | null;
  rotatorSpeed?: { x: number; y: number; z: number } | null;
  bobbingSpeed?: number | null;

  // Hierarchy actions
  hierarchyAction?: {
    type: 'insertParent' | 'addChild' | 'parentToWorld';
    /** UUID assigned to the newly-created node so peers stay in sync. */
    newNodeUuid?: string;
  };
}

/**
 * Action + identity payload for a shared UI panel (inspector /
 * import dialog). Sent whenever one user opens OR closes a panel
 * that peers are meant to see. The originator's identity rides
 * along so peers can render a "X is choosing… / X is inspecting…"
 * header on their mirror instance. close is sent ONLY by the
 * originator; peers that hide their mirror locally must NOT
 * broadcast — that would race-condition with the originator's
 * intent and could prematurely close the originator's panel from
 * a peer's POV.
 *
 * targetAssetId is inspector-only (import has no asset context).
 * Receivers keys the open action on (panelId) and uses
 * targetAssetId to look up which asset the panel was opened for.
 * Empty targetAssetId + open means the originator opened the panel
 * with no selection (the panel would still render — fine to render
 * peer-side, the peer's SceneInspector handleEmpty-selection path
 * kicks in).
 */
export interface PanelStateData {
  action: 'open' | 'close';
  panelId: 'inspector' | 'import';
  originatorPeerId: string;
  originatorUserName?: string;
  /** Originator's role at broadcast time. Used by peers for header
      "X is choosing…" rendering; ROLE_PERMISSIONS[localRole] is the
      actual gate on peer interactivity, originator role does NOT
      elevate peer permissions (thinker recommendation E). */
  originatorRole?: 'admin' | 'builder' | 'moderator' | 'guest' | 'spectator';
  /** Inspector-only: id of the asset the originator was inspecting
      at open time. Receivers use this to set their own selectedAsset
      so the panel renders with the same target. */
  targetAssetId?: string | null;
  ts: number;
}

/**
 * Header payload for an in-flight 'pending' broadcast. The host
 * emits this RIGHT BEFORE awaiting `AssetManager.importFile` /
 * `importFromUrl` (the async loads can take seconds for large GLB /
 * OBJ / FBX files), so peers can render a placeholder mesh + label
 * that says "Loading <name> by <requester>". The placeholder id
 * will equal the eventual `AssetSpawnData.id` once the host's
 * import resolves, so the network round-trip naturally maps
 * placeholder → real asset (consumed by App.tsx's
 * `registerOnAssetAdded` id-match check).
 */
export interface PendingSpawnData {
  id: string;
  type: AssetType;
  name: string;
  requesterId: string;
  requesterName: string;
  position: [number, number, number];
  fileSize?: number;
  url?: string;
}

/**
 * Pay-per-update video playback state. Sent whenever one user's
 * playback / seek / global-volume decisions should change what other
 * users see. Only the SHARED fields ride the wire — local volume,
 * volumeMode toggle position, and the personal mute flag are local
 * UI state and never broadcast. Each video asset on each peer keeps
 * its own elements + state mirror with these shared fields driven
 * by `applyVideoState` on receive.
 *
 * Synced intentionally minimal so we don't churn the network on
 * every playhead tick: `currentTime` is sent on play / pause / seek
 * events and on play (so late joiners snap to the host's spot),
 * NOT every frame. `playing` is the toggle mirror. `globalVolume`
 * rides only when the user is in global-volume mode (App.tsx
 * guards that in the broadcast call site).
 */
export interface VideoStateData {
  assetId: string;
  playing: boolean;
  currentTime: number;
  globalVolume: number;
}

export interface SceneStateSnapshot {
  assets: AssetSpawnData[];
  hostId: string;
}

export interface P2PChunkData {
  id: string;
  start: number;
  end: number;
  data: ArrayBuffer;
}

/**
 * Multiplexed-message envelope. One DataConnection per peer carries every
 * message type — we tag each payload with the channel name so the receiver
 * can re-fan out to the same callback sets the rest of the app uses. JSON
 * is fine for the update rate we target (<21 Hz for transforms and avatars);
 * for asset spawns that carry a binary `fileData: ArrayBuffer` we base64
 * encode the bytes inside the JSON so we don't need a second channel.
 *
 * The `src` field is reserved for envelope-level addressing if we ever
 * want to fan-out from a single child message; today we always know the
 * sending peer from `conn.peer` on the DataConnection, so src stays null.
 */
type EnvelopeType =
  | 'trans' | 'av' | 'spawn' | 'rem' | 'chat'
  | 'syncreq' | 'syncresp' | 'role' | 'mod' | 'hs' | 'peerlist'
  // 'pending'          — host broadcasts on import-start (before the
  //                      async load resolves) so peers can render a
  //                      "Loading…" placeholder at the asset's future
  //                      position. Id of the placeholder matches the
  //                      eventual asset so onAssetAdded's id-match
  //                      cleanup swaps it out cleanly.
  // 'pendingcancel'    — host broadcasts when the import rejected so
  //                      peers can dispose their placeholder instead
  //                      of waiting forever.
  // 'chunk'            — reassembly fragment for an envelope whose
  //                      JSON form exceeded the 64KB single-message
  //                      ceiling. sendEnvelopeTo splits large payloads
  //                      (e.g. base64 GLB fileData) into 64KB chunks,
  //                      handleEnvelopeFrom reassembles them by
  //                      (fromPeerId, id) and re-enters the normal
  //                      route with the reconstructed JSON. Without
  //                      this, Quest's WebRTC bindings would crash on
  //                      >~1MB single envelopes.
  // 'vidstate'         — playback / seek / global-volume update for a
  //                      single video asset. Peers apply the change
  //                      via AssetManager.applyVideoState, which drives
  //                      both the HTMLVideoElement and the userData
  //                      mirror so the receiving inspector + UI stay
  //                      in sync. Carries `playing`, `currentTime`,
  //                      `globalVolume` only — local-only fields
  //                      (localVolume, volumeMode, muted) stay local.
  // 'panelstate'       — visibility state for a shared UI panel
  //                      (SceneInspector / AssetImportDialog). When one
  //                      user opens the inspector or import dialog
  //                      with permission, peers see the same panel
  //                      open (anchored to the asset for inspector,
  //                      camera-relative for import). The originator's
  //                      role/identity rides along so peers can
  //                      render a "X is choosing… / X is inspecting…"
  //                      header on their mirror instance. Close is
  //                      also broadcast but ONLY by the originator —
  //                      peers opting out of their mirror view do not
  //                      accidentally close the originator's panel.
  | 'pending' | 'pendingcancel' | 'chunk' | 'vidstate' | 'panelstate' | 'mat'
  | 'inspector'
  | 'leave' | 'ping';

interface Envelope {
  type: EnvelopeType;
  payload: unknown;
}

/**
 * NetworkService — public API stays identical to the previous Trystero
 * version, so App.tsx never references PeerJS directly. We keep the same
 * initSession / disconnect / broadcast* / on* callback registration shape
 * and instead translate those calls into PeerJS's point-to-point machinery
 * behind the scenes:
 *
 *   - one DataConnection per remote peer (vs Trystero's mesh actions)
 *   - JSON envelope `{type, payload}` multiplexes 10 logical channels
 *   - MediaConnection (peer.call / call.answer) replaces mesh addStream
 *   - deterministic `${roomId}-host` peer id replaces room-signaling
 *     (first peer to claim it wins, others fall back to guest dial)
 *
 * The `?room=XYZ` URL still works: `initSession` registers as guest with a
 * random id, dials `${roomId}-host`, and only if that fails (3 s timeout
 * or `peer-unavailable` error) does it destroy its Peer and re-register as
 * the host. Same recovery for `unavailable-id` if two peers race to claim
 * host: the loser stays as guest and dials the now-existing host.
 */
export class NetworkService {
  public mode: ConnectionMode = 'offline';
  public roomId: string | null = null;
  public localPeerId: string;
  public localUserName = (() => {
    try {
      return localStorage.getItem('nexus_username') || 'Traveler';
    } catch {
      return 'Traveler';
    }
  })();

  public setLocalUserName(name: string): void {
    const trimmed = name.trim() || 'Traveler';
    this.localUserName = trimmed;
    try {
      localStorage.setItem('nexus_username', trimmed);
    } catch {}
    if (this.mode !== 'offline') {
      this.broadcastEnvelope(this.buildEnvelope('hs', {
        peerId: this.localPeerId,
        userName: trimmed,
        role: this.localRole
      }));
    }
  }

  public peers: Set<string> = new Set();
  public hostId: string;
  public isHost = true;
  public isCompanion = false;
  public worldRoot: THREE.Object3D | null = null;

  public localRole: UserRole = 'admin';
  public peerRoles: Map<string, UserRole> = new Map();
  public peerNames: Map<string, string> = new Map();
  public bannedPeers: Set<string> = new Set();
  public mutedPeers: Set<string> = new Set();

  // PeerJS internals
  private peer: Peer | null = null;
  private readonly dataConns: Map<string, DataConnection> = new Map();
  // Dedicated low-latency channel for ephemeral, high-frequency updates
  // (transforms, avatars, heartbeats). Uses an unreliable DataConnection
  // so large asset transfers on the reliable channel cannot head-of-line
  // block movement updates.
  private readonly realtimeConns: Map<string, DataConnection> = new Map();
  private readonly hostedAssets: Map<string, ArrayBuffer> = new Map();
  // Phase 3A: outbound binary conns (host's `openBinaryChannel` dials)
  // AND inbound binary conns that arrived via `peer.on('connection')`
  // and matched the `vid-binary` metadata discriminator. Storing both
  // sides in one Map means disconnect()/teardown close them all in one
  // pass without us having to remember which side originated. Receivers
  // use this map's late-registrant check inside `onBinaryChannelOpen`
  // so a listener registered AFTER the host already dialed still gets
  // the open conn (without this check the listener would never fire —
  // 'connection' events are emitted once and never replayed).
  private readonly binaryConns: Map<string, DataConnection> = new Map();
  // Phase 3A: peerId → set of one-shot callbacks waiting for the next
  // inbound `vid-binary` conn. Fired by the `peer.on('connection')`
  // branch above once the conn reaches 'open' state. Cleared after
  // each delivery so a slow receiver registration can't accidentally
  // receive a stale conn from a later video import by the same host.
  private readonly inboundBinaryListeners: Map<string, Set<(dc: DataConnection) => void>> = new Map();
  // Phase 3B: dedicated raw-binary DataConnections for oversized asset
  // chunk transfer. Unlike the JSON envelope path, these carry a tiny
  // binary header (magic + idLen + start + end + assetId) followed by
  // raw bytes — no base64, no JSON.stringify, no head-of-line blocking
  // of realtime movement updates. Each peer gets at most one outbound
  // asset-binary conn; inbound conns are accepted by the same
  // `peer.on('connection')` branch that routes `vid-binary`.
  private readonly assetBinaryConns: Map<string, DataConnection> = new Map();
  // Outgoing asset-binary control messages (`p2preq`) that arrived
  // before the raw-binary DataConnection reached its `open` state.
  // Drained once the channel opens; dropped on close.
  private readonly pendingAssetBinaryRequests: Map<string, string[]> = new Map();
  private readonly mediaConns: Map<string, MediaConnection> = new Map();
  // Inbound voice calls that arrived before the local mic was ready.
  // Answered once enableVoiceChat/switchAudioInputDevice provides a stream.
  private readonly pendingMediaCalls: Set<MediaConnection> = new Set();
  // Outgoing envelopes that arrived while a DataConnection hadn't yet
  // reached its `open` state. We cannot call conn.send() pre-open —
  // PeerJS's internal guard consoles an "ERROR: Connection is not open.
  // You should listen for the 'open' event before sending messages."
  // AND emits 'error' on the conn. Buffet on the way in, drain once
  // open fires, drop on close so envelopes to dead peers never leak.
  private readonly pendingEnvelopes: Map<string, Envelope[]> = new Map();
  // Outgoing realtime envelopes that arrived before the unreliable
  // DataConnection reached its `open` state. Drained once the channel
  // opens; dropped on close.
  private readonly pendingRealtimeEnvelopes: Map<string, Envelope[]> = new Map();
  // Reassembly buffer for chunked envelopes keyed by `${fromPeerId}-${id}`.
  // Each entry holds the in-order string fragments and a count of how many
  // have arrived; when count === total we JSON.parse the concatenation
  // and re-enter handleEnvelopeFrom with the reconstructed payload. Dropped
  // on successful reassembly so a long-lived session doesn't accumulate
  // stale buffers for every chunked message ever sent.
  private readonly chunkedMessages: Map<string, { chunks: Array<string | undefined>; count: number; total: number }> = new Map();
  private hostDialTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastSeenPeers: Map<string, number> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private unloadHandlersRegistered = false;
  // Last timestamp at which `becomeHost()` actually started a host
  // claim (not the dedupe-blocked early-return). Used to throttle the
  // host/guest race loop where `unavailable-id` → guest → host-dial
  // timeout → becomeHost would otherwise fire the chat message
  // "You are the host of …" every 3-4 seconds. Reset to 0 on
  // `disconnect()` so a fresh room always gets its first host message.
  private lastBecomeHostTime = 0;
  // Last system-chat text + timestamp. `notifySystemChat` drops
  // identical text fired within `SYSTEM_CHAT_DEDUPE_MS` so a tight
  // loop in the network code (e.g. unavailable-id re-firing) doesn't
  // spam the chat log with the same line over and over. Different
  // text is always allowed through so a real "host taken" / "host
  // granted" sequence still appears as two separate messages.
  private lastSystemChatText = '';
  private lastSystemChatTime = 0;
  private localAudioStream: MediaStream | null = null;
  public isMuted = false;
  public isDeafened = false;

  // Minimum interval (ms) between two actual `becomeHost()` claims.
  // Used to throttle the host/guest race loop where `unavailable-id`
  // → guest → host-dial timeout → becomeHost would otherwise re-fire
  // the chat message every 3-4 seconds. 5 s is well over the
  // 3-second host-dial timeout (so a single legitimate re-host still
  // gets through) but short enough that a user manually leaving and
  // re-joining a room doesn't have to wait long to see the "host"
  // message again.
  private static readonly BECOME_HOST_COOLDOWN_MS = 5000;
  // Minimum interval (ms) between two identical system-chat messages.
  // `notifySystemChat` drops same-text messages fired within this
  // window so a tight network loop (e.g. unavailable-id re-firing)
  // can't spam the chat log. Different text is always allowed through.
  // 3 s is just over the 3-second host-dial timeout so a legitimate
  // "host granted" / "host taken" sequence (different text) still
  // shows both lines.
  private static readonly SYSTEM_CHAT_DEDUPE_MS = 3000;

  // Envelope types that should travel over the dedicated unreliable
  // realtime DataConnection instead of the reliable one. Keeping
  // transform/avatar/heartbeat traffic on a separate channel prevents
  // large asset spawns from head-of-line blocking peer movement.
  private static readonly REALTIME_TYPES: ReadonlySet<EnvelopeType> = new Set<EnvelopeType>(['trans', 'av', 'ping']);

  // ICE servers — kept identical to the previous Trystero configuration so
  // NAT traversal behavior matches. Google STUN + OpenRelay TURN covers
  // the common home-network / corporate-firewall combinations.
  private static readonly ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ];

  // Event callbacks — mirror the public surface from the Trystero version.
  private onPeerJoinCallbacks: Set<(peerId: string) => void> = new Set();
  private onPeerLeaveCallbacks: Set<(peerId: string) => void> = new Set();
  private onHostChangeCallbacks: Set<(newHostId: string, isSelf: boolean) => void> = new Set();
  private onTransformCallbacks: Set<(update: TransformUpdate) => void> = new Set();
  private onAvatarCallbacks: Set<(update: AvatarTransform) => void> = new Set();
  private onSpawnCallbacks: Set<(data: AssetSpawnData) => void> = new Set();
  private onRemoveCallbacks: Set<(id: string) => void> = new Set();
  private onChatCallbacks: Set<(msg: ChatMessage) => void> = new Set();
  private onStreamCallbacks: Set<(stream: MediaStream, peerId: string) => void> = new Set();
  private onVideoLiveStreamCallbacks: Set<(assetId: string, stream: MediaStream, peerId: string) => void> = new Set();
  private onSyncReqCallbacks: Set<(fromPeerId: string) => void> = new Set();
  private onSyncRespCallbacks: Set<(snapshot: SceneStateSnapshot) => void> = new Set();
  private readonly onRoleCallbacks: Set<(data: RoleUpdatePayload) => void> = new Set();
  private readonly onModerationCallbacks: Set<(data: ModerationActionPayload) => void> = new Set();
  private readonly onP2PChunkDataCallbacks: Set<(data: P2PChunkData) => void> = new Set();
  private onPendingSpawnCallbacks: Set<(data: PendingSpawnData) => void> = new Set();
  private onPendingCancelCallbacks: Set<(id: string) => void> = new Set();
  private onVideoStateCallbacks: Set<(data: VideoStateData) => void> = new Set();
  private onPanelStateCallbacks: Set<(data: PanelStateData) => void> = new Set();
  private onMaterialCallbacks: Set<(update: MaterialUpdate) => void> = new Set();
  private onInspectorUpdateCallbacks: Set<(data: InspectorUpdateData) => void> = new Set();

  constructor() {
    this.localPeerId = `peer-${Math.random().toString(36).substring(2, 9)}`;
    this.hostId = this.localPeerId;
  }

  // ===========================================================================
  // Session lifecycle
  // ===========================================================================
  public async initSession(roomId: string, mode: ConnectionMode = 'online', isCompanion = false): Promise<void> {
    // Tear down any prior session. disconnect() awaits peer destruction so
    // no stale callbacks from the old room can leak into the new one.
    await this.disconnect();

    this.mode = mode;
    this.roomId = roomId;
    this.isCompanion = isCompanion;

    if (mode === 'online') {
      // Start as guest with a random id — we'll try to dial `${roomId}-host`
      // and only fall through to host-claim if no host exists.
      this.localPeerId = `peer-${Math.random().toString(36).substring(2, 9)}`;
    } else if (mode === 'paired') {
      // Pair mode: roomId IS the other peer's full peer id. We still need
      // our OWN id to register with the broker before dialing.
      this.localPeerId = `peer-${Math.random().toString(36).substring(2, 9)}`;
    } else {
      return;
    }

    this.peer = new Peer(this.localPeerId, {
      debug: 1,
      config: { iceServers: NetworkService.ICE_SERVERS }
    });

    this.bindPeerHandlers();
    this.registerUnloadHandlers();
    this.startHeartbeat();
  }

  public onP2PChunkData(cb: (data: P2PChunkData) => void): () => void {
    this.onP2PChunkDataCallbacks.add(cb);
    return () => this.onP2PChunkDataCallbacks.delete(cb);
  }

  /**
   * Request a chunk of a large asset via the raw-binary asset channel.
   * The request is sent as a small JSON control message; the host replies
   * with a binary-framed chunk that fires `onP2PChunkData` listeners.
   * This avoids base64/JSON overhead and does not block realtime
   * movement updates on the reliable channel.
   */
  public requestAssetChunk(assetId: string, peerId: string, start: number, end: number): void {
    if (this.mode === 'offline' || this.bannedPeers.has(peerId)) return;
    let conn: DataConnection;
    try {
      conn = this.openAssetBinaryChannel(peerId);
    } catch (err) {
      console.warn('[PeerJS] failed to open asset-binary channel for', peerId, err);
      return;
    }
    const req = JSON.stringify({ type: 'p2preq', id: assetId, start, end });
    if (conn.open) {
      try { conn.send(req); } catch (err) {
        console.warn('[PeerJS] asset-binary request send failed for', peerId, err);
      }
    } else {
      let pending = this.pendingAssetBinaryRequests.get(peerId);
      if (!pending) {
        pending = [];
        this.pendingAssetBinaryRequests.set(peerId, pending);
      }
      if (pending.length >= SEND_TO_MAX_QUEUED) {
        pending.shift();
      }
      pending.push(req);
    }
  }

  private registerUnloadHandlers(): void {
    if (this.unloadHandlersRegistered) return;
    this.unloadHandlersRegistered = true;
    const handleUnload = () => {
      if (this.localPeerId && this.peers.size > 0) {
        try {
          this.broadcastEnvelope(this.buildEnvelope('leave', this.localPeerId));
        } catch { /* noop */ }
      }
      for (const conn of this.dataConns.values()) {
        try { conn.close(); } catch { /* noop */ }
      }
      for (const conn of this.realtimeConns.values()) {
        try { conn.close(); } catch { /* noop */ }
      }
      try { this.peer?.destroy(); } catch { /* noop */ }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.mode === 'offline' || !this.localPeerId) return;
      try {
        this.broadcastEnvelope(this.buildEnvelope('ping', null));
      } catch { /* noop */ }

      const now = Date.now();
      for (const peerId of Array.from(this.peers)) {
        const lastSeen = this.lastSeenPeers.get(peerId) || now;
        if (now - lastSeen > 45000) {
          console.warn('[NetworkService] Peer timed out (no heartbeat in 45s):', peerId);
          this.removePeer(peerId);
        }
      }
    }, 4000);
  }

  private bindPeerHandlers(): void {
    if (!this.peer) return;

    this.peer.on('open', (_id) => {
      // The broker confirmed our id. If we expected to fall back to host
      // dial or to dial-room-host, fire those now — UNLESS we ARE the
      // host (localPeerId has been re-pinned to `${roomId}-host` after a
      // becomeHost() that destroyed and re-registered the peer). Without
      // this guard the post-becomeHost peer keeps re-firing
      // attemptDialHostOrClaim on every reconnect/refocus, which dials
      // OUR OWN peer id — that conn never legitimately reaches `open`
      // but is briefly added to dataConns by acceptDataConnection and
      // any in-flight broadcast against it errors out with
      // PeerJS "Connection is not open".
      if (this.mode === 'online' && this.roomId) {
        if (this.localPeerId === `${this.roomId}-host`) return;
        void this.attemptDialHostOrClaim(this.roomId);
        void this.enableVoiceChat();
      } else if (this.mode === 'paired' && this.roomId) {
        this.connectToPeer(this.roomId);
        void this.enableVoiceChat();
      }
    });

    this.peer.on('connection', (conn) => {
      // Phase 3A: discriminate inbound by the metadata we attach on
      // outbound openBinaryChannel. JSON envelopes (the default
      // acceptDataConnection path) route to handleEnvelopeFrom —
      // which would try to JSON.parse raw video bytes and crash the
      // peer-side path. Binary conns go to onBinaryChannelOpen instead.
      // The discriminator is `metadata.kind === 'vid-binary'`, set in
      // openBinaryChannel's `peer.connect` argument, and propagated
      // to inbound via PeerJS's standard metadata channel. Forward
      // compatible with future binary streams (raw audio, mesh BVH,
      // etc.) by adding new `kind` values without touching this branch.
      const md = (conn as { metadata?: { kind?: string } | null }).metadata;
      if (md && typeof md === 'object' && md.kind === 'vid-binary') {
        const handleBinaryOpen = () => {
          this.binaryConns.set(conn.peer, conn);
          const listeners = this.inboundBinaryListeners.get(conn.peer);
          if (listeners) {
            for (const cb of listeners) {
              try { cb(conn); } catch (err) { console.warn('[Net] binary listener threw:', err); }
            }
            this.inboundBinaryListeners.delete(conn.peer);
          }
        };
        if (conn.open) {
          handleBinaryOpen();
        } else {
          conn.on('open', handleBinaryOpen);
        }
        conn.on('close', () => { this.binaryConns.delete(conn.peer); });
        conn.on('error', (err) => {
          console.warn('[Net] binary conn error:', conn.peer, err);
          this.binaryConns.delete(conn.peer);
        });
      } else if (md && typeof md === 'object' && md.kind === 'asset-binary') {
        this.acceptAssetBinaryConnection(conn);
      } else if (md && typeof md === 'object' && md.kind === 'realtime') {
        this.acceptRealtimeConnection(conn);
      } else {
        this.acceptDataConnection(conn);
      }
    });

    this.peer.on('call', (call) => {
      this.acceptMediaCall(call);
    });

    this.peer.on('error', (err: any) => {
      // err is a typed union ('peer-unavailable' | 'unavailable-id' |
      // 'network' | 'server-error' | 'socket-error' | 'socket-closed' | …).
      const errType = (err && (err as { type?: string }).type) ?? 'unknown';
      if (errType === 'unavailable-id') {
        // Our chosen peer id was rejected. The most common cause is the
        // race where another peer claimed `${roomId}-host` first.
        // Reset `isHost` and `hostId` BEFORE re-rolling `localPeerId`
        // so any UI / broadcast that reads `net.isHost` in the brief
        // window between fallback and the new outbound-conn's `open`
        // event sees the correct "about to be guest" state instead of
        // stale "is host" left over from the failed becomeHost() attempt.
        // evaluateHost() in conn.on('open') re-evaluates once peers is
        // populated and corrects the value once and for all.
        this.peer?.destroy();
        this.peer = null;
        if (this.mode === 'online' && this.roomId) {
          this.isHost = false;
          this.localPeerId = `peer-${Math.random().toString(36).substring(2, 9)}`;
          this.hostId = this.localPeerId;
          this.peer = new Peer(this.localPeerId, {
            debug: 1,
            config: { iceServers: NetworkService.ICE_SERVERS }
          });
          this.bindPeerHandlers();
          this.notifySystemChat(`Host id was taken — joining as guest.`);
        }
        return;
      }
      console.warn('PeerJS error:', err);
      this.notifySystemChat(`Network error: ${errType}`);
    });

    this.peer.on('disconnected', () => {
      // Socket dropped (e.g. broker connection lost). Try to reconnect with
      // the SAME id so the rest of the room's peer list and our own
      // published id stay stable.
      if (this.peer && !this.peer.destroyed) {
        try { this.peer.reconnect(); } catch { /* noop */ }
      }
    });
  }

  /**
   * "Online" mode discovery: try to dial `${roomId}-host`. If the conn
   * opens within 3 s, we're a guest — leave it bound and exit. If the
   * dial times out or errors with `peer-unavailable`, no host exists —
   * destroy our guest peer and re-register as the host.
   *
   * Race recovery: two clients may BOTH reach this branch simultaneously
   * (each timed out dialing, each trying to claim host). The broker
   * arbitrates — first registration wins. The loser's `unavailable-id`
   * error handler above then falls back to guest + re-dial host.
   */
  private async attemptDialHostOrClaim(roomId: string): Promise<void> {
    if (!this.peer) return;
    const hostId = `${roomId}-host`;

    // Don't let a previous attempt's interval leak into this one.
    if (this.hostDialTimer) {
      clearTimeout(this.hostDialTimer);
      this.hostDialTimer = null;
    }

    const conn = this.peer.connect(hostId, { reliable: true });
    let settled = false;
    const settle = (hostReachable: boolean) => {
      if (settled) return;
      settled = true;
      if (this.hostDialTimer) {
        clearTimeout(this.hostDialTimer);
        this.hostDialTimer = null;
      }
      conn.removeAllListeners();
      if (hostReachable) {
        this.hostId = hostId;
        this.acceptDataConnection(conn);
        this.openRealtimeToPeer(hostId);
      } else {
        conn.close();
        this.becomeHost(roomId);
      }
    };

    conn.on('open', () => settle(true));
    conn.on('error', (e: any) => {
      const t = (e && (e as { type?: string }).type) ?? '';
      if (t === 'peer-unavailable') settle(false);
      // 'network' / 'socket-error' during dial: also treat as no-host so
      // the user isn't stuck waiting forever.
    });
    // Hard timeout — if the broker never replies about the target's
    // existence, treat as no host.
    this.hostDialTimer = setTimeout(() => settle(false), 3000);
  }

  private becomeHost(roomId: string): void {
    // Cooldown: throttle the host/guest race loop where `unavailable-id`
    // → guest → host-dial timeout → becomeHost would otherwise fire the
    // chat message "You are the host of …" every 3-4 seconds. The
    // underlying race (broker hasn't released the old id yet) is still
    // possible, but a single becomeHost per ~5 s is plenty for any
    // legitimate re-host and is a hard cap on the chat-spam loop.
    // Paired with `notifySystemChat`'s 3 s text dedupe, the two
    // together guarantee the chat log can't fill with alternating
    // host/guest lines. Reset to 0 on `disconnect()` so a fresh room
    // always gets its first host message.
    const now = Date.now();
    if (now - this.lastBecomeHostTime < NetworkService.BECOME_HOST_COOLDOWN_MS) {
      return;
    }
    this.lastBecomeHostTime = now;

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.dataConns.clear();
    this.realtimeConns.clear();
    this.pendingRealtimeEnvelopes.clear();
    this.mediaConns.clear();
    // Tear down any asset-binary channels from a previous session so
    // stale conns don't leak into the new host identity.
    for (const conn of this.assetBinaryConns.values()) {
      try { conn.removeAllListeners(); conn.close(); } catch { /* noop */ }
    }
    this.assetBinaryConns.clear();
    this.pendingAssetBinaryRequests.clear();
    this.hostedAssets.clear();
    this.chunkedMessages.clear();
    this.pendingEnvelopes.clear();
    this.localPeerId = `${roomId}-host`;
    this.hostId = this.localPeerId;
    this.isHost = true;
    this.peer = new Peer(this.localPeerId, {
      debug: 1,
      config: { iceServers: NetworkService.ICE_SERVERS }
    });
    this.bindPeerHandlers();
    void this.enableVoiceChat();
    this.notifySystemChat(`You are the host of "${roomId}".`);
  }

  private connectToPeer(peerId: string): void {
    if (!this.peer) return;
    // Defensive self-dial guard. Collision probability with a random
    // 7-char local id is astronomically small, but `peer.connect(selfId)`
    // would still try to open a self-conn and produce the same
    // "Connection is not open..." console spam if any broadcast hit
    // during the brief window before peer-unavailable errored.
    if (peerId === this.localPeerId) {
      console.warn('[PeerJS] Skipping self-dial in connectToPeer');
      return;
    }
    try {
      const conn = this.peer.connect(peerId, { reliable: true });
      this.acceptDataConnection(conn);
    } catch (err) {
      console.warn('[PeerJS] connect threw for', peerId, err);
    }
    this.openRealtimeToPeer(peerId);
  }

  private openRealtimeToPeer(peerId: string): void {
    if (!this.peer) return;
    if (peerId === this.localPeerId) return;
    if (this.realtimeConns.has(peerId)) return;
    try {
      const conn = this.peer.connect(peerId, { reliable: false, metadata: { kind: 'realtime' } });
      this.acceptRealtimeConnection(conn);
    } catch (err) {
      console.warn('[PeerJS] realtime connect threw for', peerId, err);
    }
  }

  private acceptRealtimeConnection(conn: DataConnection): void {
    if (this.mode === 'offline') {
      conn.close();
      return;
    }
    if (this.bannedPeers.has(conn.peer)) {
      conn.close();
      return;
    }
    this.realtimeConns.set(conn.peer, conn);

    const onConnOpen = () => {
      this.lastSeenPeers.set(conn.peer, Date.now());
      const pending = this.pendingRealtimeEnvelopes.get(conn.peer);
      if (pending && pending.length > 0) {
        for (const env of pending) {
          try { conn.send(env); } catch (err) {
            console.warn('[PeerJS] realtime flush failed for', conn.peer, err);
          }
        }
        this.pendingRealtimeEnvelopes.delete(conn.peer);
      }
    };

    if (conn.open) {
      onConnOpen();
    } else {
      conn.on('open', onConnOpen);
    }

    conn.on('data', (raw) => {
      this.handleEnvelopeFrom(conn.peer, raw);
    });

    conn.on('close', () => {
      this.realtimeConns.delete(conn.peer);
    });

    conn.on('error', (err) => {
      console.warn('[PeerJS] RealtimeDataConnection error:', conn.peer, err);
      this.realtimeConns.delete(conn.peer);
    });
  }

  private sendRealtimeEnvelopeTo(conn: DataConnection, env: Envelope): void {
    if (conn.open) {
      try {
        conn.send(env);
      } catch (err) {
        console.warn('[PeerJS] realtime send failed for', conn.peer, err);
      }
      return;
    }
    let queue = this.pendingRealtimeEnvelopes.get(conn.peer);
    if (!queue) {
      queue = [];
      this.pendingRealtimeEnvelopes.set(conn.peer, queue);
    }
    if (queue.length >= SEND_TO_MAX_QUEUED) {
      queue.shift();
    }
    queue.push(env);
  }

  // ===========================================================================
  // Asset binary channel (minimal fallback for oversized fileData)
  // ===========================================================================
  /**
   * Accept an inbound raw-binary DataConnection opened by a peer that
   * wants to pull (or push) oversized asset chunks. We store it in
   * `assetBinaryConns` and route every message to the binary framing
   * parser. The channel uses `serialization: 'binary'` so the bytes
   * arrive as ArrayBuffers, not JSON-wrapped strings.
   */
  private acceptAssetBinaryConnection(conn: DataConnection): void {
    if (this.mode === 'offline') {
      conn.close();
      return;
    }
    if (this.bannedPeers.has(conn.peer)) {
      conn.close();
      return;
    }
    const existing = this.assetBinaryConns.get(conn.peer);
    if (existing) {
      if (existing.open) {
        // We already have an open channel for this peer; keep it and
        // discard the duplicate inbound conn.
        conn.close();
        return;
      }
      // Stale connecting/closed conn: tear it down before replacing.
      try { existing.removeAllListeners(); existing.close(); } catch { /* noop */ }
    }
    this.assetBinaryConns.set(conn.peer, conn);

    const onConnOpen = () => {
      this.lastSeenPeers.set(conn.peer, Date.now());
    };

    if (conn.open) {
      onConnOpen();
    } else {
      conn.on('open', onConnOpen);
    }

    conn.on('data', (raw) => {
      this.handleAssetBinaryMessage(conn, raw);
    });

    conn.on('close', () => {
      if (this.assetBinaryConns.get(conn.peer) === conn) {
        this.assetBinaryConns.delete(conn.peer);
      }
    });

    conn.on('error', (err) => {
      console.warn('[PeerJS] asset-binary conn error:', conn.peer, err);
      if (this.assetBinaryConns.get(conn.peer) === conn) {
        this.assetBinaryConns.delete(conn.peer);
      }
    });
  }

  /**
   * Open (or reuse) a raw-binary DataConnection to a peer for oversized
   * asset chunk transfer. The conn is tagged with `kind: 'asset-binary'`
   * so the remote side routes it here instead of into the JSON envelope
   * parser.
   */
  private openAssetBinaryChannel(peerId: string): DataConnection {
    if (!this.peer) throw new Error('NetworkService peer not initialized');
    if (peerId === this.localPeerId) throw new Error('Cannot open asset-binary channel to self');
    if (this.bannedPeers.has(peerId)) throw new Error('Cannot open asset-binary channel to a banned peer');
    const existing = this.assetBinaryConns.get(peerId);
    if (existing) {
      if (existing.open) return existing;
      // Stale closed conn: tear it down and create a fresh one.
      try { existing.removeAllListeners(); existing.close(); } catch { /* noop */ }
      this.assetBinaryConns.delete(peerId);
    }
    const conn = this.peer.connect(peerId, {
      reliable: true,
      serialization: 'binary',
      metadata: { kind: 'asset-binary' }
    });
    this.assetBinaryConns.set(peerId, conn);
    conn.on('open', () => {
      this.lastSeenPeers.set(peerId, Date.now());
      const pending = this.pendingAssetBinaryRequests.get(peerId);
      if (pending && pending.length > 0) {
        for (const req of pending) {
          try { conn.send(req); } catch (err) {
            console.warn('[PeerJS] asset-binary pending request send failed for', peerId, err);
          }
        }
        this.pendingAssetBinaryRequests.delete(peerId);
      }
    });
    conn.on('close', () => {
      if (this.assetBinaryConns.get(peerId) === conn) {
        this.assetBinaryConns.delete(peerId);
      }
    });
    conn.on('error', (err) => {
      console.warn('[PeerJS] asset-binary outbound conn error:', peerId, err);
      if (this.assetBinaryConns.get(peerId) === conn) {
        this.assetBinaryConns.delete(peerId);
      }
    });
    conn.on('data', (raw) => { this.handleAssetBinaryMessage(conn, raw); });
    return conn;
  }

  /**
   * Parse a raw asset-binary message. String payloads carry JSON control
   * messages (`p2preq`); binary payloads carry a chunked data header
   * followed by raw bytes. Fires `onP2PChunkDataCallbacks` on the
   * receiving side.
   *
   * PeerJS's `serialization: 'binary'` channel can deliver the bytes in
   * several forms depending on the browser / RTCDataChannel binaryType:
   *   - ArrayBuffer (most desktop browsers)
   *   - Blob (some Chromium builds when binaryType is 'blob')
   *   - Uint8Array / other TypedArray / DataView wrappers
   * We normalize all of those to an ArrayBuffer before decoding so the
   * framing parser always sees the same shape.
   */
  private handleAssetBinaryMessage(conn: DataConnection, raw: unknown): void {
    if (typeof raw === 'string') {
      try {
        const msg = JSON.parse(raw) as { type: string; id: string; start: number; end: number };
        if (msg.type === 'p2preq') {
          this.handleAssetBinaryRequest(conn, msg);
        }
      } catch (err) {
        console.warn('[PeerJS] asset-binary control parse error from', conn.peer, err);
      }
      return;
    }
    // Blob payloads must be converted asynchronously. All other binary
    // shapes are normalized synchronously to an ArrayBuffer.
    if (raw instanceof Blob) {
      blobToArrayBuffer(raw).then((buf) => {
        if (buf) this.processAssetBinaryChunk(conn, buf);
      }).catch((err) => {
        console.warn('[PeerJS] asset-binary Blob read error from', conn.peer, err);
      });
      return;
    }
    const buf = normalizeBinaryPayload(raw);
    if (!buf) {
      console.warn('[PeerJS] unexpected asset-binary message type from', conn.peer, typeof raw);
      return;
    }
    this.processAssetBinaryChunk(conn, buf);
  }

  private processAssetBinaryChunk(conn: DataConnection, buf: ArrayBuffer): void {
    try {
      const chunk = decodeAssetBinaryChunk(buf);
      for (const cb of this.onP2PChunkDataCallbacks) cb(chunk);
    } catch (err) {
      console.warn('[PeerJS] asset-binary chunk decode error from', conn.peer, err);
    }
  }

  /**
   * Host-side handler for a chunk request received over the asset-binary
   * channel. Reads the requested slice from `hostedAssets` and sends it
   * back as a raw binary message on the same DataConnection so the reply
   * cannot be routed to a stale or overwritten conn.
   */
  private handleAssetBinaryRequest(conn: DataConnection, req: { id: string; start: number; end: number }): void {
    if (this.bannedPeers.has(conn.peer)) return;
    const buffer = this.hostedAssets.get(req.id);
    if (!buffer) return;
    // Clamp the chunk size so a single reply never exceeds the
    // WebRTC message comfort zone, even if a peer asks for the
    // whole file at once.
    let end = Math.min(req.end, req.start + MAX_ASSET_BINARY_CHUNK_BYTES);
    end = Math.min(end, buffer.byteLength);
    const chunkLength = end - req.start;
    if (chunkLength <= 0 || req.start < 0) {
      console.warn('[PeerJS] invalid asset-binary request range from', conn.peer, req);
      return;
    }
    const encoded = encodeAssetBinaryChunk(req.id, req.start, end, buffer, req.start, chunkLength);
    if (conn.open) {
      conn.send(encoded);
    }
  }

  private callPeerForAudio(peerId: string): void {
    if (!this.peer || !this.localAudioStream) return;
    if (peerId === this.localPeerId) return;
    if (this.bannedPeers.has(peerId)) return;
    // Close any stale call so device switches and re-mutes actually
    // renegotiate with a fresh MediaConnection. Without this the
    // early return below would leave peers using an old/stopped track.
    const existing = this.mediaConns.get(peerId);
    if (existing) {
      try { existing.removeAllListeners(); existing.close(); } catch { /* noop */ }
      this.mediaConns.delete(peerId);
    }
    try {
      const call = this.peer.call(peerId, this.localAudioStream);
      if (!call) return;
      this.mediaConns.set(peerId, call);
      call.on('stream', (remoteStream) => {
        if (!this.isDeafened) {
          for (const cb of this.onStreamCallbacks) cb(remoteStream, peerId);
        }
      });
      call.on('close', () => this.mediaConns.delete(peerId));
      call.on('error', () => this.mediaConns.delete(peerId));
    } catch (err) {
      console.warn('[PeerJS] call threw for', peerId, err);
    }
  }

  private acceptDataConnection(conn: DataConnection): void {
    if (this.mode === 'offline') {
      conn.close();
      return;
    }
    if (this.bannedPeers.has(conn.peer)) {
      // Don't actually accept the conn — we still attach a one-shot data
      // event so we can deliver a ban envelope before close.
      conn.on('open', () => {
        try {
          conn.send(this.buildEnvelope('mod', {
            action: 'ban',
            targetPeerId: conn.peer,
            fromPeerId: this.localPeerId,
            reason: 'You are banned from this session.'
          } satisfies ModerationActionPayload));
        } catch { /* noop */ }
        setTimeout(() => { try { conn.close(); } catch { /* noop */ } }, 50);
      });
      return;
    }

    this.dataConns.set(conn.peer, conn);

    const onConnOpen = () => {
      this.peers.add(conn.peer);
      this.lastSeenPeers.set(conn.peer, Date.now());
      this.evaluateHost();

      const pending = this.pendingEnvelopes.get(conn.peer);
      if (pending && pending.length > 0) {
        for (const env of pending) {
          try { conn.send(env); } catch (err) {
            console.warn('[PeerJS] flush failed for', conn.peer, err);
          }
        }
        this.pendingEnvelopes.delete(conn.peer);
      }

      this.sendEnvelopeTo(conn, this.buildEnvelope('hs', {
        peerId: this.localPeerId,
        userName: this.localUserName,
        role: this.localRole
      }));

      // Request initial scene sync when connecting to the host
      if (!this.isHost || conn.peer === `${this.roomId}-host` || conn.peer === this.hostId) {
        this.hostId = conn.peer;
        this.sendEnvelopeTo(conn, this.buildEnvelope('syncreq', { from: this.localPeerId }));
      } else if (this.isHost) {
        const existingPeers = Array.from(this.dataConns.keys()).filter((id) => id !== conn.peer);
        if (existingPeers.length > 0) {
          this.sendEnvelopeTo(conn, this.buildEnvelope('peerlist', { peers: existingPeers }));
        }
      }

      if (this.localAudioStream && !this.isMuted) {
        this.callPeerForAudio(conn.peer);
      }

      for (const cb of this.onPeerJoinCallbacks) cb(conn.peer);
      this.notifySystemChat(`User joined the room`);
    };

    if (conn.open) {
      onConnOpen();
    } else {
      conn.on('open', onConnOpen);
    }

    conn.on('data', (raw) => {
      this.handleEnvelopeFrom(conn.peer, raw);
    });

    conn.on('close', () => {
      this.removePeer(conn.peer);
    });

    conn.on('error', (err) => {
      console.warn('[PeerJS] DataConnection error:', conn.peer, err);
      this.removePeer(conn.peer);
    });
  }

  public removePeer(peerId: string): void {
    if (!this.peers.has(peerId) && !this.dataConns.has(peerId)) return;
    console.log('[NetworkService] Removing disconnected peer:', peerId);

    const dataConn = this.dataConns.get(peerId);
    if (dataConn) {
      try { dataConn.removeAllListeners(); dataConn.close(); } catch { /* noop */ }
    }
    const mediaConn = this.mediaConns.get(peerId);
    if (mediaConn) {
      try { mediaConn.removeAllListeners(); mediaConn.close(); } catch { /* noop */ }
    }
    const binaryConn = this.binaryConns.get(peerId);
    if (binaryConn) {
      try { binaryConn.removeAllListeners(); binaryConn.close(); } catch { /* noop */ }
    }
    const assetBinaryConn = this.assetBinaryConns.get(peerId);
    if (assetBinaryConn) {
      try { assetBinaryConn.removeAllListeners(); assetBinaryConn.close(); } catch { /* noop */ }
    }
    const realtimeConn = this.realtimeConns.get(peerId);
    if (realtimeConn) {
      try { realtimeConn.removeAllListeners(); realtimeConn.close(); } catch { /* noop */ }
    }

    this.dataConns.delete(peerId);
    this.realtimeConns.delete(peerId);
    this.mediaConns.delete(peerId);
    this.binaryConns.delete(peerId);
    this.assetBinaryConns.delete(peerId);
    this.pendingAssetBinaryRequests.delete(peerId);
    this.pendingEnvelopes.delete(peerId);
    this.pendingRealtimeEnvelopes.delete(peerId);
    this.peers.delete(peerId);
    this.peerRoles.delete(peerId);
    this.peerNames.delete(peerId);
    this.lastSeenPeers.delete(peerId);

    this.evaluateHost();
    for (const cb of this.onPeerLeaveCallbacks) cb(peerId);
    this.notifySystemChat(`User left the room`);
  }

  private acceptMediaCall(call: MediaConnection): void {
    if (this.bannedPeers.has(call.peer)) {
      try { call.close(); } catch { /* noop */ }
      return;
    }

    const md = (call as unknown as { metadata?: { kind?: string; assetId?: string } }).metadata;
    if (md && md.kind === 'vid-live-stream' && md.assetId) {
      try { call.answer(); } catch { /* noop */ }
      call.on('stream', (remoteStream) => {
        for (const cb of this.onVideoLiveStreamCallbacks) {
          cb(md.assetId!, remoteStream, call.peer);
        }
      });
      return;
    }

    if (this.localAudioStream) {
      call.answer(this.localAudioStream);
    } else {
      // We don't have a mic yet; defer answering so the caller gets
      // our audio once the local stream is available.
      this.pendingMediaCalls.add(call);
      call.on('close', () => this.pendingMediaCalls.delete(call));
      call.on('error', () => this.pendingMediaCalls.delete(call));
      return;
    }
    this.mediaConns.set(call.peer, call);

    call.on('stream', (remoteStream) => {
      if (this.isDeafened) return;
      for (const cb of this.onStreamCallbacks) cb(remoteStream, call.peer);
    });
    call.on('close', () => this.mediaConns.delete(call.peer));
    call.on('error', () => this.mediaConns.delete(call.peer));
  }

  private answerPendingMediaCalls(): void {
    for (const call of this.pendingMediaCalls) {
      this.pendingMediaCalls.delete(call);
      this.acceptMediaCall(call);
    }
  }

  // ===========================================================================
  // Envelope routing
  // ===========================================================================
  private buildEnvelope(type: EnvelopeType, payload: unknown): Envelope {
    // AssetSpawnData.fileData is an ArrayBuffer; JSON.stringify can't
    // serialize that natively, so base64-encode on the way out.
    let prepared: unknown = payload;
    if (type === 'spawn' && payload && typeof payload === 'object') {
      const pd = payload as AssetSpawnData;
      if (pd.fileData instanceof ArrayBuffer) {
        if (pd.fileData.byteLength > MAX_INLINED_FILE_BYTES) {
          // Store the buffer so peers can request it later
          this.hostedAssets.set(pd.id, pd.fileData);
          prepared = {
            ...pd,
            fileData: undefined,
            fileDataOversized: true,
            p2pTransferHint: { id: pd.id, size: pd.fileData.byteLength },
            senderPeerId: this.localPeerId
          };
        } else {
          prepared = { ...pd, fileData: arrayBufferToBase64(pd.fileData) };
        }
      }
    } else if (type === 'syncresp' && payload && typeof payload === 'object') {
      // Sync snapshots carry an array of assets, each potentially with
      // its own ArrayBuffer fileData. The original code only base64-
      // encoded 'spawn' payloads — so late-joining guests received
      // stripped fileData on syncresp and silently failed to
      // reconstruct existing assets. Map over the array and encode
      // each asset's fileData independently so the snapshot round-trips
      // cleanly through the chunked-transfer path. Also applies the
      // same per-asset size cap as the 'spawn' branch so a host with a
      // giant asset in the scene doesn't ship a multi-MB snapshot
      // to the late-joining guest.
      const pd = payload as SceneStateSnapshot;
      prepared = {
        ...pd,
        assets: pd.assets.map((a) => {
          if (a.fileData instanceof ArrayBuffer) {
            if (a.fileData.byteLength > MAX_INLINED_FILE_BYTES) {
              this.hostedAssets.set(a.id, a.fileData);
              return {
                ...a,
                fileData: undefined,
                fileDataOversized: true,
                p2pTransferHint: { id: a.id, size: a.fileData.byteLength },
                senderPeerId: this.localPeerId
              };
            }
            return { ...a, fileData: arrayBufferToBase64(a.fileData) };
          }
          return a;
        })
      };
    }
    return { type, payload: prepared };
  }

  private parseEnvelope(raw: unknown): Envelope | null {
    // Guard null/non-object first — the `in` operator throws on null, and
    // a future caller passing a string-encoded envelope would otherwise
    // sneak past the original `'type' in raw` check.
    if (!raw || typeof raw !== 'object') return null;
    const env = raw as Envelope;
    if (typeof env.type !== 'string') return null;
    if (env.type === 'spawn' && env.payload && typeof env.payload === 'object') {
      const pd = env.payload as Partial<AssetSpawnData> & { fileData?: unknown };
      if (typeof pd.fileData === 'string') {
        pd.fileData = base64ToArrayBuffer(pd.fileData);
      }
    } else if (env.type === 'syncresp' && env.payload && typeof env.payload === 'object') {
      // Mirror of buildEnvelope's syncresp branch: decode each asset's
      // fileData back to ArrayBuffer so App.tsx's importFile sees the
      // same shape the host used. Without this, late-joining guests
      // would receive stripped fileData and silently fail to
      // reconstruct existing assets.
      const pd = env.payload as Partial<SceneStateSnapshot> & { assets?: Array<Partial<AssetSpawnData> & { fileData?: unknown }> };
      if (Array.isArray(pd.assets)) {
        for (const a of pd.assets) {
          if (a && typeof a.fileData === 'string') {
            a.fileData = base64ToArrayBuffer(a.fileData);
          }
        }
      }
    }
    return env;
  }

  private handleEnvelopeFrom(fromPeerId: string, raw: unknown): void {
    // Intercept chunk envelopes BEFORE the normal parse path. Large
    // spawn / syncresp payloads (base64 GLB fileData) easily exceed
    // WebRTC's single-message comfort zone on resource-constrained
    // clients — Quest's browser crashes on >~1MB JSON envelopes.
    // sendEnvelopeTo splits oversized JSON into 64KB chunks tagged with
    // {id, i, total}. We reassemble here keyed by (fromPeerId, id) and
    // re-enter the normal route with the reconstructed JSON. Duplicate
    // chunks (same i) are dropped so a retransmitted fragment doesn't
    // bump count past total and falsely signal "done".
    if (raw && typeof raw === 'object' && (raw as Envelope).type === 'chunk') {
      const pd = (raw as Envelope).payload as { id?: string; i?: number; total?: number; data?: string };
      if (typeof pd?.id === 'string' && typeof pd.i === 'number' && typeof pd.total === 'number' && typeof pd.data === 'string') {
        const key = `${fromPeerId}-${pd.id}`;
        let entry = this.chunkedMessages.get(key);
        if (!entry) {
          entry = { chunks: new Array(pd.total).fill(undefined as string | undefined), count: 0, total: pd.total };
          this.chunkedMessages.set(key, entry);
        }
        if (entry.chunks[pd.i] === undefined) {
          entry.chunks[pd.i] = pd.data;
          entry.count++;
        }
        if (entry.count === entry.total) {
          this.chunkedMessages.delete(key);
          const fullJson = entry.chunks.join('');
          try {
            const parsed = JSON.parse(fullJson);
            this.handleEnvelopeFrom(fromPeerId, parsed);
          } catch (err) {
            console.warn('[PeerJS] Failed to reassemble chunked envelope from', fromPeerId, err);
          }
        }
      }
      return;
    }

    const env = this.parseEnvelope(raw);
    if (!env) {
      console.warn('[PeerJS] Ignoring invalid envelope from', fromPeerId, raw);
      return;
    }
    this.lastSeenPeers.set(fromPeerId, Date.now());

    switch (env.type) {
      case 'leave':
        this.removePeer(fromPeerId);
        break;
      case 'ping':
        // Lightweight heartbeat ping; lastSeenPeers already updated above
        break;
      case 'mod': {
        const modPayload = env.payload as ModerationActionPayload;
        if (modPayload.action === 'silence') this.mutedPeers.add(modPayload.targetPeerId);
        else if (modPayload.action === 'unsilence') this.mutedPeers.delete(modPayload.targetPeerId);
        else if (modPayload.action === 'ban') this.bannedPeers.add(modPayload.targetPeerId);
        for (const cb of this.onModerationCallbacks) cb(modPayload);
        break;
      }
      case 'trans':
        for (const cb of this.onTransformCallbacks) cb(env.payload as TransformUpdate);
        break;
      case 'mat':
        for (const cb of this.onMaterialCallbacks) cb(env.payload as MaterialUpdate);
        break;
      case 'inspector':
        for (const cb of this.onInspectorUpdateCallbacks) cb(env.payload as InspectorUpdateData);
        break;
      case 'av': {
        const av = env.payload as AvatarTransform;
        av.peerId = fromPeerId;
        for (const cb of this.onAvatarCallbacks) cb(av);
        break;
      }
      case 'spawn': {
        const data = env.payload as AssetSpawnData;
        data.senderPeerId = fromPeerId;
        for (const cb of this.onSpawnCallbacks) cb(data);
        break;
      }
      case 'rem': {
        const removedId = env.payload as string;
        // Drop any hosted oversized asset buffer for the removed id so
        // we don't leak large ArrayBuffers after the asset is gone.
        this.hostedAssets.delete(removedId);
        for (const cb of this.onRemoveCallbacks) cb(removedId);
        break;
      }
      case 'chat':
        for (const cb of this.onChatCallbacks) cb(env.payload as ChatMessage);
        break;
      case 'syncreq':
        if (this.isHost) {
          for (const cb of this.onSyncReqCallbacks) cb(fromPeerId);
        }
        break;
      case 'syncresp': {
        const snapshot = env.payload as SceneStateSnapshot;
        if (snapshot && snapshot.assets) {
          for (const asset of snapshot.assets) {
            asset.senderPeerId = fromPeerId;
          }
        }
        for (const cb of this.onSyncRespCallbacks) cb(snapshot);
        break;
      }
      case 'role': {
        const data = env.payload as RoleUpdatePayload;
        this.peerRoles.set(data.targetPeerId, data.newRole);
        if (data.targetPeerId === this.localPeerId) {
          this.localRole = data.newRole;
          this.notifySystemChat(`Your permission role was updated to: ${data.newRole.toUpperCase()}`);
        }
        for (const cb of this.onRoleCallbacks) cb(data);
        break;
      }
      case 'hs': {
        const data = env.payload as { peerId?: string; userName?: string; role?: UserRole };
        const id = data.peerId || fromPeerId;
        this.peerNames.set(id, data.userName || 'Traveler');
        if (data.role) this.peerRoles.set(id, data.role);
        break;
      }
      case 'peerlist': {
        const data = env.payload as { peers?: string[] };
        if (Array.isArray(data?.peers)) {
          for (const peerId of data.peers) {
            if (peerId && peerId !== this.localPeerId && !this.dataConns.has(peerId)) {
              this.connectToPeer(peerId);
            }
          }
        }
        break;
      }
      case 'pending':
        // Host announcing an in-flight import. Receivers draw a
        // placeholder until either 'spawn' (with the same id) lands
        // or 'pendingcancel' does.
        for (const cb of this.onPendingSpawnCallbacks) cb(env.payload as PendingSpawnData);
        break;
      case 'pendingcancel':
        // Host's import rejected. Receivers dispose their placeholder
        // for the matching id.
        for (const cb of this.onPendingCancelCallbacks) cb(env.payload as string);
        break;
      case 'vidstate':
        // Video playback update. Routes through onVideoStateCallbacks
        // so App.tsx can apply it via AssetManager.applyVideoState.
        // No local-source guard here — the sender's peer id is known
        // to the receiving App.tsx layer (via the conn's peer), so
        // echo-suppression happens on landing in the App.tsx callback.
        for (const cb of this.onVideoStateCallbacks) cb(env.payload as VideoStateData);
        break;
      case 'panelstate':
        // Shared panel visibility update. Routes through
        // onPanelStateCallbacks so App.tsx can mirror the panel-open
        // state and (for inspector) re-target its selectedAsset to
        // match the originator's targetAssetId. Echoes from a peer's
        // OWN broadcast are unchecked here — the App.tsx receive
        // handler drops events whose originatorPeerId matches its
        // own localPeerId (defensive against re-entry).
        for (const cb of this.onPanelStateCallbacks) cb(env.payload as PanelStateData);
        break;
    }
  }

  private sendEnvelopeTo(conn: DataConnection, env: Envelope): void {
    // PeerJS's DataConnection.send() is gated strictly on conn.open.
    // Pre-open behaviour is to console.error "Connection is not open.
    // You should listen for the 'open' event before sending messages."
    // AND emit 'error' on the connection — which is exactly what the
    // user saw spamming the console in the host flow. We hit this in
    // two cases: (a) a guest's connection lands in dataConns via
    // acceptDataConnection() in the brief gap between the broker's
    // 'connection' event and ICE/DTLS completing, or (b) post-becomeHost
    // re-registration where attemptDialHostOrClaim runs against an
    // outbound conn that hasn't reached `open` yet. Buffering here
    // keeps broadcast loops free to fire every frame; the flush happens
    // once the conn actually opens (see acceptDataConnection's
    // conn.on('open') body).
    if (conn.open) {
      try {
        // Serialize the envelope ourselves so we can measure its size
        // and split it into 64KB chunks when it exceeds WebRTC's
        // single-message comfort zone. PeerJS's conn.send() internally
        // JSON.stringifies too, but by then we've already lost the
        // chance to chunk. The 64KB threshold is conservative — Quest
        // browser crashes on >~1MB single envelopes, but 64KB keeps
        // each chunk well under any reasonable SCTP/DCEP ceiling and
        // the per-chunk setTimeout(4) yields to the WebRTC process
        // layer so the DataChannel's bufferedAmount can drain.
        const jsonStr = JSON.stringify(env);
        if (jsonStr.length > 64 * 1024) {
          this.sendChunked(conn, jsonStr);
        } else {
          conn.send(env);
        }
      } catch (err) {
        console.warn('[PeerJS] send failed for', conn.peer, err);
      }
      return;
    }
    let queue = this.pendingEnvelopes.get(conn.peer);
    if (!queue) {
      queue = [];
      this.pendingEnvelopes.set(conn.peer, queue);
    }
    // Cap per-peer buffer to keep one wedged connection from blowing up
    // RAM. A 60 Hz avatar broadcast over a half-open conn would otherwise
    // push ~3600 envs in a single minute (and far more if multi-KB
    // spawns are involved). Oldest-dropped so a flood of late envelopes
    // doesn't shadow critical early ones entirely.
    if (queue.length >= SEND_TO_MAX_QUEUED) {
      console.warn(`[PeerJS] pre-open queue at capacity (${queue.length}) for ${conn.peer} — dropping oldest`);
      queue.shift();
    }
    queue.push(env);
  }

  /**
   * Split a JSON string into 64KB chunks and send them as 'chunk'
   * envelopes, yielding 4ms between each so the WebRTC DataChannel's
   * bufferedAmount can drain. Without the yield, a 1MB payload split
   * into 16 chunks fires all 16 conn.send() calls synchronously, the
   * SCTP send buffer fills, and PeerJS's underlying RTCDataChannel
   * throws — which on Quest's browser manifests as a tab crash. The
   * 4ms is empirically enough to let the browser process layer flush
   * between sends; 0ms still triggers the buffer overflow on Quest.
   * Chunks are tagged with a random 7-char id so the receiver can
   * reassemble them keyed by (fromPeerId, id) even if multiple
   * chunked messages are interleaved on the same connection.
   */
  private sendChunked(conn: DataConnection, jsonStr: string): void {
    const CHUNK_SIZE = 64 * 1024;
    const msgId = Math.random().toString(36).substring(2, 9);
    const total = Math.ceil(jsonStr.length / CHUNK_SIZE);
    let i = 0;
    const sendNext = (): void => {
      if (i >= total || !conn.open) return;
      // Send chunks in a burst as long as bufferedAmount stays below threshold
      while (i < total && conn.open) {
        const dc = (conn as any).dataChannel as RTCDataChannel | undefined;
        if (dc && dc.bufferedAmount > 1024 * 1024) {
          // Send buffer is filling up; yield to let WebRTC flush
          setTimeout(sendNext, 1);
          return;
        }
        const chunkStr = jsonStr.substring(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, jsonStr.length));
        try {
          conn.send({ type: 'chunk', payload: { id: msgId, i, total, data: chunkStr } });
        } catch (err) {
          console.warn('[PeerJS] chunked send failed at', i, 'of', total, 'for', conn.peer, err);
          setTimeout(sendNext, 5);
          return;
        }
        i++;
        if (!dc) {
          if (i < total) setTimeout(sendNext, 1);
          return;
        }
      }
    };
    sendNext();
  }

  private isRealtimeEnvelope(env: Envelope): boolean {
    return NetworkService.REALTIME_TYPES.has(env.type);
  }

  private broadcastEnvelope(env: Envelope, targetPeerId?: string): void {
    if (this.isRealtimeEnvelope(env)) {
      this.broadcastRealtimeEnvelope(env, targetPeerId);
      return;
    }
    if (!targetPeerId) {
      for (const conn of this.dataConns.values()) {
        this.sendEnvelopeTo(conn, env);
      }
    } else {
      const conn = this.dataConns.get(targetPeerId);
      if (conn) this.sendEnvelopeTo(conn, env);
    }
  }

  private broadcastRealtimeEnvelope(env: Envelope, targetPeerId?: string): void {
    if (!targetPeerId) {
      for (const [peerId, reliableConn] of this.dataConns) {
        const realtimeConn = this.realtimeConns.get(peerId);
        if (realtimeConn) {
          this.sendRealtimeEnvelopeTo(realtimeConn, env);
        } else {
          this.sendEnvelopeTo(reliableConn, env);
        }
      }
    } else {
      const realtimeConn = this.realtimeConns.get(targetPeerId);
      if (realtimeConn) {
        this.sendRealtimeEnvelopeTo(realtimeConn, env);
      } else {
        const reliableConn = this.dataConns.get(targetPeerId);
        if (reliableConn) this.sendEnvelopeTo(reliableConn, env);
      }
    }
  }

  // ===========================================================================
  // Host / role bookkeeping
  // ===========================================================================
  private evaluateHost(): void {
    // Same rule as the previous Trystero version: lowest alphabetical peer
    // id wins. Includes our own id. Fall back to self when we're alone.
    const roomHostId = `${this.roomId}-host`;
    const allIds = [this.localPeerId, ...Array.from(this.peers)];
    let newHostId = this.localPeerId;
    if (allIds.includes(roomHostId)) {
      newHostId = roomHostId;
    } else {
      allIds.sort();
      newHostId = allIds[0] ?? this.localPeerId;
    }
    const oldIsHost = this.isHost;

    this.hostId = newHostId;
    this.isHost = (newHostId === this.localPeerId);

    if (this.isHost !== oldIsHost) {
      for (const cb of this.onHostChangeCallbacks) cb(this.hostId, this.isHost);
      if (this.isHost) {
        this.notifySystemChat(`Host migrated. You are now the authoritative Host.`);
        if (this.mode === 'online' && this.roomId && this.localPeerId !== `${this.roomId}-host`) {
          this.becomeHost(this.roomId);
        }
      }
    }
  }

  public notifySystemChat(text: string): void {
    // Dedupe identical system-chat text within a 3-second window so a
    // tight network loop (e.g. unavailable-id → guest → host-dial
    // timeout → becomeHost firing repeatedly) doesn't spam the chat
    // log with the same line. Different text is always allowed through
    // so a legitimate sequence like "host granted" → "guest joined"
    // still appears as two separate messages. Reset to 0 on
    // `disconnect()` so a fresh room's first system message isn't
    // blocked by a stale dedupe hit from a previous session.
    const now = Date.now();
    if (
      text === this.lastSystemChatText &&
      now - this.lastSystemChatTime < NetworkService.SYSTEM_CHAT_DEDUPE_MS
    ) {
      return;
    }
    this.lastSystemChatText = text;
    this.lastSystemChatTime = now;

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

  // ===========================================================================
  // Public Broadcast API (preserved verbatim from the Trystero version)
  // ===========================================================================
  public broadcastTransform(update: TransformUpdate): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('trans', update));
  }

  public broadcastMaterialUpdate(update: MaterialUpdate): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('mat', update));
  }

  /**
   * Broadcast a generic inspector update (active, persistent, name,
   * light config, component attach/detach, mesh enabled, hierarchy
   * actions, etc.) to all connected peers.
   */
  public broadcastInspectorUpdate(update: InspectorUpdateData): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('inspector', { ...update, senderPeerId: this.localPeerId }));
  }

  public broadcastAssetUpdate(asset: LoadedAsset): void {
    if (this.mode === 'offline') return;
    const obj = asset.object3d;
    obj.updateWorldMatrix(true, false);
    let pos = [obj.position.x, obj.position.y, obj.position.z] as [number, number, number];
    let rot = [obj.rotation.x, obj.rotation.y, obj.rotation.z] as [number, number, number];
    let scl = [obj.scale.x, obj.scale.y, obj.scale.z] as [number, number, number];
    const refParent = this.worldRoot ?? (obj.parent && obj.parent !== this.worldRoot ? obj.parent : null);
    if (refParent) {
      refParent.updateWorldMatrix(true, false);
      const parentInv = refParent.matrixWorld.clone().invert();
      const localMat = parentInv.multiply(obj.matrixWorld);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      localMat.decompose(p, q, s);
      const e = new THREE.Euler().setFromQuaternion(q, obj.rotation.order);
      pos = [p.x, p.y, p.z];
      rot = [e.x, e.y, e.z];
      scl = [s.x, s.y, s.z];
    }
    const isPersistent = (obj.userData as Record<string, unknown>)?.isPersistent as boolean | undefined;
    this.broadcastEnvelope(this.buildEnvelope('trans', {
      assetId: asset.id,
      position: pos,
      rotation: rot,
      scale: scl,
      isCollidable: asset.isCollidable,
      isPersistent
    }));
  }

  public broadcastAvatar(update: AvatarTransform): void {
    if (this.mode === 'offline') return;
    const toSend = { ...update, peerId: this.localPeerId };
    this.broadcastEnvelope(this.buildEnvelope('av', toSend));
  }

  public broadcastSpawn(data: AssetSpawnData): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('spawn', data));
  }

  /**
   * Broadcast an in-flight 'pending' import announcement. Peers
   * render a placeholder at `data.position` until the matching
   * 'spawn' (with the same `id`) lands OR 'pendingcancel' is sent
   * on import failure. The host also draws its own local
   * placeholder immediately for instant user feedback during the
   * (potentially slow) async import.
   */
  public broadcastPendingSpawn(data: PendingSpawnData): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('pending', data));
  }

  /**
   * Cancel a previously broadcast 'pending' announcement. Sent
   * when the host's import rejected / threw / returned null, so
   * peers don't keep their placeholder mesh installed indefinitely.
   */
  public broadcastPendingCancel(id: string): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('pendingcancel', id));
  }

  /**
   * Broadcast a video playback state update. Carries ONLY the
   * shared-with-peers fields (playing, currentTime, globalVolume);
   * local-only fields (localVolume, volumeMode, muted) are filtered
   * out so we don't waste envelope bytes and don't accidentally
   * force one user's UI choices onto another (e.g. don't clobber
   * their mute toggle). Callers are expected to gate the
   * `globalVolume` field themselves — App.tsx only sends it when
   * the local user is in 'global' volume mode.
   */
  public broadcastVideoState(data: VideoStateData): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('vidstate', data));
  }

  /**
   * Broadcast a shared-panel visibility update (inspector / import
   * dialog). Wraps `panelstate` envelope. The originator fields
   * (peerId, userName, role) live on the payload so peers can
   * render "X is inspecting…" headers without a separate 'hs'
   * round-trip. Use `targetAssetId` for the inspector panel —
   * import has no asset target.
   *
   * Caller is responsible for NOT broadcasting a 'close' action
   * unless they are the originator of the open. App.tsx tracks
   * whether the panel was opened locally or received, and only
   * the originator path calls this with action='close'.
   */
  public broadcastPanelState(data: PanelStateData): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('panelstate', data));
  }

  /**
   * Subscribe to video-state updates from peers. The callback fires
   * for every vidstate envelope — including ones we sent ourselves,
   * so callers should compare `conn.peer` against `net.localPeerId`
   * (or just apply unconditionally and rely on AssetManager's
   * `applyVideoState` no-op-on-equal-value behavior). Returning the
   * cleanup function means subscribers can drop the listener in
   * the same useEffect cleanup that registered it, avoiding
   * duplicate listeners on a React StrictMode double-mount.
   */
  public onVideoState(cb: (data: VideoStateData) => void): () => void {
    this.onVideoStateCallbacks.add(cb);
    return () => this.onVideoStateCallbacks.delete(cb);
  }

  /**
   * Subscribe to shared-panel state updates from peers. Fires for
   * every 'panelstate' envelope including ones the local peer
   * sent itself; the App.tsx receive handler drops echoes whose
   * originatorPeerId matches localPeerId.
   */
  public onPanelState(cb: (data: PanelStateData) => void): () => void {
    this.onPanelStateCallbacks.add(cb);
    return () => this.onPanelStateCallbacks.delete(cb);
  }

  /**
   * Phase 3A: open a SECOND PeerJS DataConnection to a peer for binary
   * streaming (e.g. large video bytes). Returns the DataConnection
   * live (does not await 'open' — callers can attach handlers first,
   * then drop into begin-send once `open` fires).
   *
   * Mirrors the existing `connectToPeer` pattern but with the
   * `{ reliable: true }` flag and a `{ label }` so the peer's
   * acceptDataConnection can route by channel. Future expansion may
   * use the label to disambiguate at the broker level.
   */
  public openBinaryChannel(peerId: string): DataConnection {
    if (!this.peer) throw new Error('NetworkService peer not initialized');
    if (peerId === this.localPeerId) throw new Error('Cannot open channel to self');
    // `serialization: 'binary'` keeps PeerJS from wrapping each
    // `conn.send(ArrayBuffer)` in a JSON envelope. Without it the receiver
    // receives {data: '<base64 string>'} and handleEnvelopeFrom rejects
    // every chunk as an invalid envelope before VideoStreamingService's
    // listener can de-multiplex. The accompanying `metadata.kind`
    // discriminator is what bindPeerHandlers' `peer.on('connection')`
    // branch uses to route the INBOUND half of this conn to
    // `onBinaryChannelOpen` instead of `acceptDataConnection` (which
    // would JSON-fail on raw video bytes). We do NOT call
    // acceptDataConnection from here — that handler installs an
    // `on('data') => handleEnvelopeFrom` listener which would log
    // spurious "invalid envelope" warnings for every chunk. Instead
    // the conn lives only in `binaryConns` so the host can send
    // bytes via `dc.send(ArrayBuffer)` directly and disconnect()'
    // can close it on teardown.
    const conn = this.peer.connect(peerId, {
      reliable: true,
      serialization: 'binary',
      metadata: { kind: 'vid-binary' }
    });
    this.binaryConns.set(conn.peer, conn);
    conn.on('close', () => { this.binaryConns.delete(conn.peer); });
    conn.on('error', (err) => {
      console.warn('[Net] binary outbound conn error:', conn.peer, err);
      this.binaryConns.delete(conn.peer);
    });
    return conn;
  }

  /**
   * Phase 3A: register a one-shot callback fired when an inbound
   * `vid-binary` DataConnection from `peerId` reaches the 'open'
   * state (or synchronously if one is already open from a previous
   * host dial). Used by VideoStreamingService.attachReceiver to
   * attach its `handleIncomingBinary` listener to the host's
   * outbound conn — without this the receiver would have to dial
   * a SECOND binary conn back to the host (a 2nd RTCDataChannel
   * pair that the host's `beginStreamingToPeer` would never pump),
   * leading to "importer sees it locally, peer sees nothing"
   * because outbound conn on host and outbound conn on receiver
   * are SEPARATE underlying RTCDataChannels despite both sides
   * looking like "binary channels to the same peer".
   *
   * Returns an unsubscribe function so a duplicate-import path
   * (e.g. registerOnAssetAdded re-firing for a sync-snapshot hit)
   * can cancel a stale listener without leaving a dangling Set
   * entry that fires on the NEXT video import by the same host
   * (which would race against the current asset's MediaSource).
   */
  public onBinaryChannelOpen(peerId: string, cb: (dc: DataConnection) => void): () => void {
    const existing = this.binaryConns.get(peerId);
    if (existing) {
      if (existing.open) {
        // Late registration: connection is already sitting open.
        try { cb(existing); } catch (err) { console.warn('[Net] late binary listener threw:', err); }
        return () => {};
      } else {
        // Existing connection is mid-handshake; listen for its 'open' event.
        const onOpen = () => {
          try { cb(existing); } catch (err) { console.warn('[Net] binary listener threw:', err); }
        };
        existing.on('open', onOpen);
        return () => existing.off('open', onOpen);
      }
    }
    if (!this.inboundBinaryListeners.has(peerId)) {
      this.inboundBinaryListeners.set(peerId, new Set());
    }
    const set = this.inboundBinaryListeners.get(peerId)!;
    set.add(cb);
    return () => { set.delete(cb); };
  }

  public broadcastRemove(id: string): void {
    if (this.mode === 'offline') return;
    // Free the oversized asset buffer we were hosting for P2P chunk
    // transfer. The receiver no longer needs it once the asset is gone.
    this.hostedAssets.delete(id);
    this.broadcastEnvelope(this.buildEnvelope('rem', id));
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
      this.broadcastEnvelope(this.buildEnvelope('chat', msg));
    }
    for (const cb of this.onChatCallbacks) cb(msg);
    return msg;
  }

  public sendSceneSnapshot(targetPeerId: string, assets: AssetSpawnData[]): void {
    if (!this.isHost || this.mode === 'offline') return;
    const snapshot: SceneStateSnapshot = { assets, hostId: this.hostId };
    this.broadcastEnvelope(this.buildEnvelope('syncresp', snapshot), targetPeerId);
  }

  // ===========================================================================
  // Voice Chat
  // ===========================================================================
  public async enableVoiceChat(): Promise<boolean> {
    try {
      if (!this.localAudioStream) {
        this.localAudioStream = await navigator.mediaDevices.getUserMedia({
          // Force mono capture so the Web Audio PannerNode can spatialize
          // the microphone stream correctly. Stereo input streams are not
          // panned by the PannerNode and would sound "inside the head" or
          // flat regardless of the peer's 3D position.
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
      }
      this.isMuted = false;
      this.localAudioStream.getAudioTracks().forEach((t) => { t.enabled = true; });

      // We can't addStream() like Trystero did — instead fan out a
      // peer.call() to every currently-connected peer. New peers joining
      // later will be called by acceptDataConnection → open → call.
      for (const peerId of this.peers) this.callPeerForAudio(peerId);
      // Answer any inbound calls that arrived before the mic was ready.
      this.answerPendingMediaCalls();
      return true;
    } catch (err) {
      console.warn('Microphone access denied or unavailable:', err);
      return false;
    }
  }

  public async toggleMute(): Promise<boolean> {
    if (!this.localAudioStream) {
      const ok = await this.enableVoiceChat();
      if (!ok) return this.isMuted;
      this.isMuted = false;
      return this.isMuted;
    }
    this.isMuted = !this.isMuted;
    if (this.localAudioStream) {
      this.localAudioStream.getAudioTracks().forEach((t) => { t.enabled = !this.isMuted; });
    }
    // Re-establish outbound calls when unmuting so peers that joined
    // while we were muted (or before we got a mic) still receive audio.
    if (!this.isMuted) {
      for (const peerId of this.peers) this.callPeerForAudio(peerId);
    }
    return this.isMuted;
  }

  public async switchAudioInputDevice(deviceId: string): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      if (this.localAudioStream) {
        this.localAudioStream.getAudioTracks().forEach(t => t.stop());
      }
      this.localAudioStream = stream;
      stream.getAudioTracks().forEach(t => { t.enabled = !this.isMuted; });
      // Tear down old calls so the new stream is actually used.
      for (const call of this.mediaConns.values()) {
        try { call.removeAllListeners(); call.close(); } catch { /* noop */ }
      }
      this.mediaConns.clear();
      for (const peerId of this.peers) this.callPeerForAudio(peerId);
      return true;
    } catch (err) {
      console.warn('Failed to switch audio device:', err);
      return false;
    }
  }

  public callMediaStream(peerId: string, stream: MediaStream, metadata?: Record<string, unknown>): import('peerjs').MediaConnection | null {
    if (!this.peer || this.bannedPeers.has(peerId)) return null;
    try {
      return this.peer.call(peerId, stream, { metadata });
    } catch {
      return null;
    }
  }

  public toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    return this.isDeafened;
  }

  // ===========================================================================
  // Disconnect / teardown
  // ===========================================================================
  public async disconnect(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.localPeerId && this.peers.size > 0) {
      try {
        this.broadcastEnvelope(this.buildEnvelope('leave', this.localPeerId));
      } catch { /* noop */ }
    }
    // Cancel any pending host-dial timer FIRST so it can't fire into a
    // destroyed peer and re-create one after we've torn down.
    if (this.hostDialTimer) {
      clearTimeout(this.hostDialTimer);
      this.hostDialTimer = null;
    }

    // Drop our media connections BEFORE we destroy the peer so callers
    // get a clean 'close' event rather than an abrupt drop.
    for (const call of this.mediaConns.values()) {
      try { call.removeAllListeners(); call.close(); } catch { /* noop */ }
    }
    this.mediaConns.clear();
    this.pendingMediaCalls.clear();

    // Same for data connections.
    for (const conn of this.dataConns.values()) {
      try { conn.removeAllListeners(); conn.close(); } catch { /* noop */ }
    }
    this.dataConns.clear();

    // Same for realtime connections.
    for (const conn of this.realtimeConns.values()) {
      try { conn.removeAllListeners(); conn.close(); } catch { /* noop */ }
    }
    this.realtimeConns.clear();
    this.pendingRealtimeEnvelopes.clear();

    // Phase 3A: tear down binary channels (Phase 3A video streams).
    // Distinct from dataConns because they're not routed through
    // handleEnvelopeFrom and don't need the JSON buffer-flush window.
    for (const conn of this.binaryConns.values()) {
      try { conn.removeAllListeners(); conn.close(); } catch { /* noop */ }
    }
    this.binaryConns.clear();
    // Phase 3B: tear down asset-binary channels.
    for (const conn of this.assetBinaryConns.values()) {
      try { conn.removeAllListeners(); conn.close(); } catch { /* noop */ }
    }
    this.assetBinaryConns.clear();
    this.pendingAssetBinaryRequests.clear();
    // Pending one-shot listeners we're never going to satisfy (the
    // peer is gone). Clear so a fresh session doesn't accidentally
    // fire on the very first video of the new room against a peer
    // whose peerId collides with a stale one from the previous room.
    this.inboundBinaryListeners.clear();

    // Drop any in-flight reassembly / transfer state so a fresh
    // session can't be polluted by stale chunks from the previous room.
    this.hostedAssets.clear();
    this.chunkedMessages.clear();
    this.pendingEnvelopes.clear();

    if (this.peer && !this.peer.destroyed) {
      // Peer.destroy() unregisters from the broker and tears down
      // listeners synchronously, so no Promise wrapper is needed here.
      // Kept the async signature on disconnect() so callers can `await`
      // if they want to chain a follow-up action after teardown.
      this.peer.destroy();
      this.peer = null;
    }

    this.onRoleCallbacks.clear();
    this.onModerationCallbacks.clear();
    this.onP2PChunkDataCallbacks.clear();
    this.onPendingSpawnCallbacks.clear();
    this.peers.clear();
    this.peerRoles.clear();
    this.peerNames.clear();
    this.mode = 'offline';
    this.roomId = null;
    this.isHost = true;
    this.hostId = this.localPeerId;
    // Reset the becomeHost cooldown and system-chat dedupe so a fresh
    // room always gets its first "You are the host of …" / "Host id
    // was taken …" message instead of being silently swallowed by a
    // stale throttle hit from a previous session. Without this, a user
    // who hits a host-race in room A and then joins room B within the
    // cooldown window would see no host-grant message at all.
    this.lastBecomeHostTime = 0;
    this.lastSystemChatText = '';
    this.lastSystemChatTime = 0;
  }

  // ===========================================================================
  // Public event registration (preserved verbatim)
  // ===========================================================================
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
  public onVideoLiveStream(cb: (assetId: string, stream: MediaStream, peerId: string) => void): () => void {
    this.onVideoLiveStreamCallbacks.add(cb);
    return () => this.onVideoLiveStreamCallbacks.delete(cb);
  }
  public onMaterialUpdate(cb: (update: MaterialUpdate) => void): () => void {
    this.onMaterialCallbacks.add(cb);
    return () => this.onMaterialCallbacks.delete(cb);
  }
  public onInspectorUpdate(cb: (data: InspectorUpdateData) => void): () => void {
    this.onInspectorUpdateCallbacks.add(cb);
    return () => this.onInspectorUpdateCallbacks.delete(cb);
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
    this.onModerationCallbacks.add(cb);
    return () => this.onModerationCallbacks.delete(cb);
  }
  public onPendingSpawn(cb: (data: PendingSpawnData) => void): () => void {
    this.onPendingSpawnCallbacks.add(cb);
    return () => this.onPendingSpawnCallbacks.delete(cb);
  }
  public onPendingCancel(cb: (id: string) => void): () => void {
    this.onPendingCancelCallbacks.add(cb);
    return () => this.onPendingCancelCallbacks.delete(cb);
  }

  public broadcastRoleUpdate(targetPeerId: string, newRole: UserRole): void {
    this.peerRoles.set(targetPeerId, newRole);
    if (targetPeerId === this.localPeerId) {
      this.localRole = newRole;
    }
    if (this.mode !== 'offline') {
      this.broadcastEnvelope(this.buildEnvelope('role', {
        targetPeerId,
        newRole,
        fromPeerId: this.localPeerId
      }));
    }
  }

  public broadcastModeration(action: 'kick' | 'ban' | 'silence' | 'unsilence' | 'respawn', targetPeerId: string, reason?: string): void {
    if (action === 'silence') this.mutedPeers.add(targetPeerId);
    else if (action === 'unsilence') this.mutedPeers.delete(targetPeerId);
    else if (action === 'ban') this.bannedPeers.add(targetPeerId);
    if (this.mode !== 'offline') {
      this.broadcastEnvelope(this.buildEnvelope('mod', {
        action, targetPeerId, fromPeerId: this.localPeerId, reason
      }));
    }
  }
}

// =============================================================================
// AssetSpawnData.fileData helpers
// =============================================================================
//
// Trystero's run-time knows how to ferry ArrayBuffers without us touching
// them. PeerJS DataConnections only serialize JSON natively, so any binary
// payload has to round-trip through base64. The bandwidth overhead is fine
// for the file-size diameter of an asset binary in this app (most assets
// are < 4 MB and we only ship them once per peer join).

/**
 * Maximum envelopes to buffer per Peer while a DataConnection is in
 * `connecting` state. Caps RAM usage against any single peer that
 * wedges mid-handshake; combined with the pre-open FIFO drop-oldest
 * behaviour in `sendEnvelopeTo`, this gives a bounded, observable
 * degrade-mode before PeerJS gives up on the conn. Set high enough to
 * absorb a 60 Hz avatar broadcast over a multi-second ICE gap (60 Hz *
 * 5 s = 300 leaves plenty of headroom for occasional large spawn
 * envelopes) but low enough that a pathological conn can't blow past
 * a few MB per peer.
 */
const SEND_TO_MAX_QUEUED = 500;

/**
 * Maximum file size (in original bytes) that buildEnvelope will
 * base64-encode into a 'spawn' or 'syncresp' envelope. Files larger
 * than this are stripped from the broadcast and tagged with
 * `fileDataOversized: true` so receivers can render a "Too Large"
 * placeholder instead of trying to base64-decode a string the
 * Quest browser can't allocate.
 *
 * 15 MB is the safe ceiling for V8 on mobile pointer-compressed
 * builds (the Quest browser's renderer process). The base64
 * expansion adds ~33% overhead, so a 15 MB binary becomes ~20 MB
 * of JSON, but the chunked-envelope path also inflates as it
 * allocates ~64 KB string slices per chunk. Empirically, a 50 MB
 * binary on Quest triggers a tab OOM within ~30 seconds of the
 * first acceptance because each chunk's `conn.send()` enters
 * `pendingEnvelopes` then `JSON.stringify` allocates a transient
 * full envelope copy plus the per-chunk `substring()` copies —
 * ~5× the source bytes resident at peak. 15 MB keeps that peak
 * under ~75 MB even for a worst-case multi-asset sync snapshot.
 *
 * Notes:
 *   - This cap affects ONLY the broadcast side. Local imports
 *     never go through here — AssetManager keeps the bytes in
 *     memory (Phase 2 work makes video bytes stay as Blob refs,
 *     irrelevant to this constant).
 *   - Anything above this cap is sent as metadata-only with a
 *     `streamingHint` flag. The receiver then opens a binary
 *     DataChannel via VideoStreamingTransport to pull the bytes
 *     incrementally (no broad cast JSON, no JS heap spike).
 *   - GLB, OBJ, FBX are typically < 2 MB after compression, so
 *     15 MB gives plenty of headroom for uncompressed assets too.
 */
const MAX_INLINED_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
//
// Trystero's run-time knows how to ferry ArrayBuffers without us touching
// them. PeerJS DataConnections only serialize JSON natively, so any binary
// payload has to round-trip through base64. The bandwidth overhead is fine
// for the file-size diameter of an asset binary in this app (most assets
// are < 4 MB and we only ship them once per peer join).
/**
 * Base64-encode an ArrayBuffer using 24 KB chunks. Two constraints drive
 * the chunk size:
 *
 *   1. Multiples-of-3 ONLY. `btoa` adds `=` padding at the end of any
 *      input whose byte length isn't divisible by 3. If we btoa each
 *      chunk separately and then concatenate, an internal `==` lands in
 *      the middle of the result — `atob` on the receive side terminates
 *      at the first `=`, silently dropping everything past chunk 1's
 *      padding. 24 576 = 0x6000 is divisible by 3 (8 192 groups × 3
 *      bytes), so every full chunk produces a clean b64 segment with no
 *      padding. Only the last (possibly smaller) chunk ends with `=`,
 *      which is the correct, parseable position.
 *   2. Stay under iOS Safari's `apply` arg-count limit. Safari kicks in
 *      around 33 K elements pushed to the call stack frame; 24 K is well
 *      under that ceiling on every browser we ship to, so we can use
 *      `String.fromCharCode.apply(null, Array.from(view))` for the chunk
 *      → Latin-1 string conversion and stay on the fast path.
 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x6000; // 24 KB per btoa invocation (multiple of 3)
  let b64 = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const view = bytes.subarray(i, i + CHUNK);
    const binary = String.fromCharCode.apply(
      null,
      Array.from(view) as unknown as number[]
    );
    b64 += btoa(binary);
  }
  return b64;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// =============================================================================
// Asset-binary chunk framing
// =============================================================================
//
// Oversized assets are transferred over a dedicated raw-binary
// DataConnection. Each chunk is prefixed with a small fixed header:
//   - 4 bytes magic ('NEXA' as little-endian uint32)
//   - 4 bytes assetId length
//   - 4 bytes start offset
//   - 4 bytes end offset
//   - assetId UTF-8 bytes
//   - raw chunk bytes
// This avoids base64 expansion and JSON.stringify overhead, which is
// what crashes Quest on large fileData payloads.

const ASSET_BINARY_MAGIC = 0x4E455841; // 'NEXA'
// Maximum bytes the host will return in a single asset-binary chunk.
// Keeps each WebRTC message well under the 64 KB JSON chunk ceiling
// and avoids a single reply from bloating the SCTP send buffer.
const MAX_ASSET_BINARY_CHUNK_BYTES = 256 * 1024;

function encodeAssetBinaryChunk(
  id: string,
  start: number,
  end: number,
  source: ArrayBuffer,
  sourceOffset: number,
  sourceLength: number
): ArrayBuffer {
  const idBytes = new TextEncoder().encode(id);
  const headerSize = 16 + idBytes.length;
  const total = headerSize + sourceLength;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  let offset = 0;
  view.setUint32(offset, ASSET_BINARY_MAGIC, true); offset += 4;
  view.setUint32(offset, idBytes.length, true); offset += 4;
  view.setUint32(offset, start, true); offset += 4;
  view.setUint32(offset, end, true); offset += 4;
  const u8 = new Uint8Array(buf);
  u8.set(idBytes, offset);
  offset += idBytes.length;
  u8.set(new Uint8Array(source, sourceOffset, sourceLength), offset);
  return buf;
}

function decodeAssetBinaryChunk(buf: ArrayBuffer): P2PChunkData {
  const view = new DataView(buf);
  let offset = 0;
  const magic = view.getUint32(offset, true); offset += 4;
  if (magic !== ASSET_BINARY_MAGIC) {
    throw new Error(`Invalid asset-binary magic: 0x${magic.toString(16)}`);
  }
  const idLen = view.getUint32(offset, true); offset += 4;
  const start = view.getUint32(offset, true); offset += 4;
  const end = view.getUint32(offset, true); offset += 4;
  if (offset + idLen > buf.byteLength) {
    throw new Error('Asset-binary header claims id length beyond buffer');
  }
  const idBytes = new Uint8Array(buf, offset, idLen);
  const id = new TextDecoder().decode(idBytes);
  offset += idLen;
  const data = buf.slice(offset);
  return { id, start, end, data };
}

/**
 * Normalize a raw binary payload from PeerJS into a usable ArrayBuffer.
 * PeerJS's `serialization: 'binary'` DataConnection can deliver bytes as
 * ArrayBuffer, Blob, Uint8Array, or other TypedArray/DataView wrappers
 * depending on the browser's RTCDataChannel binaryType. This helper
 * converts all of those into a plain ArrayBuffer so the asset-binary
 * framing parser only has to deal with one shape.
 */
function normalizeBinaryPayload(raw: unknown): ArrayBuffer | null {
  if (raw instanceof ArrayBuffer) return raw;
  if (ArrayBuffer.isView(raw)) {
    // TypedArrays and DataViews both implement ArrayBuffer.isView.
    // Slice the underlying buffer to get a standalone ArrayBuffer.
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  }
  return null;
}

/**
 * Convert a Blob to an ArrayBuffer. Uses the native `blob.arrayBuffer()`
 * when available, falling back to FileReader for older browsers (e.g.
 * Safari < 14). Returns null if the read fails so callers can log and
 * continue rather than throwing.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer | null> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().catch(() => null);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(result);
      } else {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(blob);
  });
}
