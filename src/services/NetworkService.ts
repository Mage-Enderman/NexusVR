import Peer, { type DataConnection, type MediaConnection } from 'peerjs';
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
  | 'syncreq' | 'syncresp' | 'role' | 'mod' | 'hs'
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
  | 'pending' | 'pendingcancel' | 'chunk' | 'vidstate' | 'panelstate';

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
  public localUserName = 'Traveler';
  public peers: Set<string> = new Set();
  public hostId: string;
  public isHost = true;
  public isCompanion = false;

  public localRole: UserRole = 'admin';
  public peerRoles: Map<string, UserRole> = new Map();
  public peerNames: Map<string, string> = new Map();
  public bannedPeers: Set<string> = new Set();
  public mutedPeers: Set<string> = new Set();

  // PeerJS internals
  private peer: Peer | null = null;
  private readonly dataConns: Map<string, DataConnection> = new Map();
  private readonly mediaConns: Map<string, MediaConnection> = new Map();
  // Outgoing envelopes that arrived while a DataConnection hadn't yet
  // reached its `open` state. We cannot call conn.send() pre-open —
  // PeerJS's internal guard consoles an "ERROR: Connection is not open.
  // You should listen for the 'open' event before sending messages."
  // AND emits 'error' on the conn. Buffet on the way in, drain once
  // open fires, drop on close so envelopes to dead peers never leak.
  private readonly pendingEnvelopes: Map<string, Envelope[]> = new Map();
  // Reassembly buffer for chunked envelopes keyed by `${fromPeerId}-${id}`.
  // Each entry holds the in-order string fragments and a count of how many
  // have arrived; when count === total we JSON.parse the concatenation
  // and re-enter handleEnvelopeFrom with the reconstructed payload. Dropped
  // on successful reassembly so a long-lived session doesn't accumulate
  // stale buffers for every chunked message ever sent.
  private readonly chunkedMessages: Map<string, { chunks: Array<string | undefined>; count: number; total: number }> = new Map();
  private hostDialTimer: ReturnType<typeof setTimeout> | null = null;
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
  private onSyncReqCallbacks: Set<(fromPeerId: string) => void> = new Set();
  private onSyncRespCallbacks: Set<(snapshot: SceneStateSnapshot) => void> = new Set();
  private onRoleCallbacks: Set<(data: RoleUpdatePayload) => void> = new Set();
  private onModCallbacks: Set<(data: ModerationActionPayload) => void> = new Set();
  private onPendingSpawnCallbacks: Set<(data: PendingSpawnData) => void> = new Set();
  private onPendingCancelCallbacks: Set<(id: string) => void> = new Set();
  private onVideoStateCallbacks: Set<(data: VideoStateData) => void> = new Set();
  private onPanelStateCallbacks: Set<(data: PanelStateData) => void> = new Set();

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
      } else if (this.mode === 'paired' && this.roomId) {
        this.connectToPeer(this.roomId);
      }
    });

    this.peer.on('connection', (conn) => {
      this.acceptDataConnection(conn);
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
        this.acceptDataConnection(conn);
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
    this.mediaConns.clear();
    this.localPeerId = `${roomId}-host`;
    this.hostId = this.localPeerId;
    this.isHost = true;
    this.peer = new Peer(this.localPeerId, {
      debug: 1,
      config: { iceServers: NetworkService.ICE_SERVERS }
    });
    this.bindPeerHandlers();
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
  }

  private callPeerForAudio(peerId: string): void {
    if (!this.peer || !this.localAudioStream) return;
    if (this.mediaConns.has(peerId)) return;
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

    conn.on('open', () => {
      this.peers.add(conn.peer);
      this.evaluateHost();

      // Drain envelopes queued while we were mid-handshake. FIFO order
      // matters — an early 'spawn' (e.g. host's scene primitives) needs
      // to land on the guest BEFORE a later 'trans' (which would
      // otherwise reference an asset id the guest hasn't seen yet). Try/
      // catch per-env so a mid-flush error doesn't drop the rest of the
      // queue (PeerJS doesn't have a clean atomic-send semantics here).
      const pending = this.pendingEnvelopes.get(conn.peer);
      if (pending && pending.length > 0) {
        for (const env of pending) {
          try { conn.send(env); } catch (err) {
            console.warn('[PeerJS] flush failed for', conn.peer, err);
          }
        }
        this.pendingEnvelopes.delete(conn.peer);
      }

      // Outgoing: tell the new peer who we are.
      this.sendEnvelopeTo(conn, this.buildEnvelope('hs', {
        peerId: this.localPeerId,
        userName: this.localUserName,
        role: this.localRole
      }));

      // If they're the host and we're not, request initial scene sync.
      if (!this.isHost && conn.peer === this.hostId) {
        this.sendEnvelopeTo(conn, this.buildEnvelope('syncreq', { from: this.localPeerId }));
      }

      // If we have an active audio stream and aren't muted, call them so
      // they get our mic too.
      if (this.localAudioStream && !this.isMuted) {
        this.callPeerForAudio(conn.peer);
      }

      for (const cb of this.onPeerJoinCallbacks) cb(conn.peer);
      this.notifySystemChat(`User joined the room`);
    });

    conn.on('data', (raw) => {
      this.handleEnvelopeFrom(conn.peer, raw);
    });

    conn.on('close', () => {
      this.dataConns.delete(conn.peer);
      this.mediaConns.delete(conn.peer);
      // Drop any buffered envelopes — peer is gone, no point forcing them
      // into a dead conn in a future (hypothetical) re-open.
      this.pendingEnvelopes.delete(conn.peer);
      this.peers.delete(conn.peer);
      this.peerRoles.delete(conn.peer);
      this.peerNames.delete(conn.peer);
      this.evaluateHost();
      for (const cb of this.onPeerLeaveCallbacks) cb(conn.peer);
      this.notifySystemChat(`User left the room`);
    });

    conn.on('error', (err) => {
      console.warn('[PeerJS] DataConnection error:', conn.peer, err);
      // PeerJS occasionally emits `'error'` without a paired `'close'`
      // (browser tab sleep, ICE failure mid-handshake, broker hiccup).
      // Drop any buffered envelopes so a flood of broadcasts doesn't
      // quietly inflate `pendingEnvelopes` against a connection that
      // will never deliver. The eventual `'close'` (if it fires) is
      // idempotent — `Map.delete` on an absent key is a safe no-op.
      this.pendingEnvelopes.delete(conn.peer);
    });
  }

  private acceptMediaCall(call: MediaConnection): void {
    // Banned peers can still ring us if they discover our peer id out of
    // band — their DataConnection was closed on accept, but `peer.call` is
    // an independent path. Drop the call immediately so their microphone
    // stream never reaches our `onStreamCallbacks`.
    if (this.bannedPeers.has(call.peer)) {
      try { call.close(); } catch { /* noop */ }
      return;
    }

    // We always answer (with our local stream if any, else with no stream).
    // The remote's microphone stream is delivered via the 'stream' event;
    // whether they ACTUALLY get audio depends on `localAudioStream` (our
    // mic) being present at the moment we answer.
    if (this.localAudioStream) {
      call.answer(this.localAudioStream);
    } else {
      // sendAnswer(false) → no media sent back. Without an active mic we
      // still attach the 'stream' listener so we DON'T waste the call.
      try { call.answer(); } catch { /* noop */ }
    }
    this.mediaConns.set(call.peer, call);

    call.on('stream', (remoteStream) => {
      if (this.isDeafened) return;
      for (const cb of this.onStreamCallbacks) cb(remoteStream, call.peer);
    });
    call.on('close', () => this.mediaConns.delete(call.peer));
    call.on('error', () => this.mediaConns.delete(call.peer));
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
          // Strip the binary and flag the envelope so receivers render
          // a "Too Large" placeholder instead of crashing on the
          // 100MB+ base64 round-trip the Quest browser can't allocate.
          // The host already has the asset locally; the size cap only
          // affects the broadcast side.
          prepared = { ...pd, fileData: undefined, fileDataOversized: true };
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
              return { ...a, fileData: undefined, fileDataOversized: true };
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
    switch (env.type) {
      case 'trans':
        for (const cb of this.onTransformCallbacks) cb(env.payload as TransformUpdate);
        break;
      case 'av':
        for (const cb of this.onAvatarCallbacks) cb(env.payload as AvatarTransform);
        break;
      case 'spawn':
        for (const cb of this.onSpawnCallbacks) cb(env.payload as AssetSpawnData);
        break;
      case 'rem':
        for (const cb of this.onRemoveCallbacks) cb(env.payload as string);
        break;
      case 'chat':
        for (const cb of this.onChatCallbacks) cb(env.payload as ChatMessage);
        break;
      case 'syncreq':
        if (this.isHost) {
          for (const cb of this.onSyncReqCallbacks) cb(fromPeerId);
        }
        break;
      case 'syncresp':
        for (const cb of this.onSyncRespCallbacks) cb(env.payload as SceneStateSnapshot);
        break;
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
      case 'mod': {
        const data = env.payload as ModerationActionPayload;
        if (data.action === 'silence') this.mutedPeers.add(data.targetPeerId);
        else if (data.action === 'unsilence') this.mutedPeers.delete(data.targetPeerId);
        else if (data.action === 'ban') this.bannedPeers.add(data.targetPeerId);
        for (const cb of this.onModCallbacks) cb(data);
        break;
      }
      case 'hs': {
        const data = env.payload as { peerId?: string; userName?: string; role?: UserRole };
        const id = data.peerId || fromPeerId;
        this.peerNames.set(id, data.userName || 'Traveler');
        if (data.role) this.peerRoles.set(id, data.role);
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
      const chunkStr = jsonStr.substring(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, jsonStr.length));
      try {
        conn.send({ type: 'chunk', payload: { id: msgId, i, total, data: chunkStr } });
      } catch (err) {
        console.warn('[PeerJS] chunked send failed at', i, 'of', total, 'for', conn.peer, err);
        return;
      }
      i++;
      if (i < total) setTimeout(sendNext, 4);
    };
    sendNext();
  }

  private broadcastEnvelope(env: Envelope, targetPeerId?: string): void {
    if (!targetPeerId) {
      for (const conn of this.dataConns.values()) {
        this.sendEnvelopeTo(conn, env);
      }
    } else {
      const conn = this.dataConns.get(targetPeerId);
      if (conn) this.sendEnvelopeTo(conn, env);
    }
  }

  // ===========================================================================
  // Host / role bookkeeping
  // ===========================================================================
  private evaluateHost(): void {
    // Same rule as the previous Trystero version: lowest alphabetical peer
    // id wins. Includes our own id. Fall back to self when we're alone.
    const allIds = [this.localPeerId, ...Array.from(this.peers)].sort();
    const newHostId = allIds[0] ?? this.localPeerId;
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

  public broadcastAssetUpdate(asset: LoadedAsset): void {
    if (this.mode === 'offline') return;
    const obj = asset.object3d;
    // Sourced from userData (matches SceneInspector checkbox writer) so
    // toggling "Persistent" in the inspector immediately reaches peers
    // through the same 'trans' envelope that position/rotation/scale do.
    const isPersistent = (obj.userData as Record<string, unknown>)?.isPersistent as boolean | undefined;
    this.broadcastEnvelope(this.buildEnvelope('trans', {
      assetId: asset.id,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      isCollidable: asset.isCollidable,
      isPersistent
    }));
  }

  public broadcastAvatar(update: AvatarTransform): void {
    if (this.mode === 'offline') return;
    this.broadcastEnvelope(this.buildEnvelope('av', update));
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

  public broadcastRemove(id: string): void {
    if (this.mode === 'offline') return;
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
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
      }
      this.isMuted = false;
      this.localAudioStream.getAudioTracks().forEach((t) => { t.enabled = true; });

      // We can't addStream() like Trystero did — instead fan out a
      // peer.call() to every currently-connected peer. New peers joining
      // later will be called by acceptDataConnection → open → call.
      for (const peerId of this.peers) this.callPeerForAudio(peerId);
      return true;
    } catch (err) {
      console.warn('Microphone access denied or unavailable:', err);
      return false;
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.localAudioStream) {
      this.localAudioStream.getAudioTracks().forEach((t) => { t.enabled = !this.isMuted; });
    }
    return this.isMuted;
  }

  public toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    return this.isDeafened;
  }

  // ===========================================================================
  // Disconnect / teardown
  // ===========================================================================
  public async disconnect(): Promise<void> {
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

    // Same for data connections.
    for (const conn of this.dataConns.values()) {
      try { conn.removeAllListeners(); conn.close(); } catch { /* noop */ }
    }
    this.dataConns.clear();

    if (this.peer && !this.peer.destroyed) {
      // Peer.destroy() unregisters from the broker and tears down
      // listeners synchronously, so no Promise wrapper is needed here.
      // Kept the async signature on disconnect() so callers can `await`
      // if they want to chain a follow-up action after teardown.
      this.peer.destroy();
      this.peer = null;
    }

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
 * Quest browser can't allocate. 5 MB is conservative — the base64
 * expansion adds ~33% overhead so a 5 MB binary becomes ~6.7 MB
 * of JSON, comfortably under any single-message SCTP ceiling.
 * Above ~10 MB JSON, the Quest browser's WebRTC data-channel path
 * can OOM the tab. Most reasonable 3D assets in this app are
 * < 2 MB after compression; 5 MB gives a comfortable headroom for
 * uncompressed glTF / FBX while still protecting the constrained
 * client.
 */
const MAX_INLINED_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
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
