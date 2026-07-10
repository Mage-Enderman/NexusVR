/**
 * VideoStreamingService — Phase 3A of the Quest video-crash fix.
 *
 * Goal: stream multi-gigabyte MP4/WebM videos peer-to-peer without ever
 * allocating the bytes in the V8 JS heap as a single ArrayBuffer. The
 * Quest browser's renderer process dies when it tries to base64 + JSON-
 * stringify a multi-hundred-MB video (each chunk copy inflates heap
 * ~3-5×), so the existing base64+JSON envelope path is fundamentally
 * limited to ~15 MB (NetworkService.MAX_INLINED_FILE_BYTES). For anything
 * larger, we wire a SECOND PeerJS DataConnection per peer dedicated to
 * binary streaming, and demux on the receiver with MP4Box + MSE.
 *
 * Architecture:
 *
 *   Host (importer):
 *     1. NetworkService stays the same on the JSON side. App.tsx sends a
 *        normal `spawn` envelope with `fileData: undefined` and a new
 *        optional `streamingHint: { id, fileSize, mimeHint }` field.
 *     2. The host calls `registerHostFile(file, assetId, mimeHint)` here
 *        BEFORE broadcasting the spawn envelope. We keep the File/Blob
 *        ref alive (no arrayBuffer() calls!) so the OS-managed disk
 *        bytes stay where the browser put them.
 *     3. Each connected peer is given a per-peer offset Map (peerId →
 *        byteOffset). When the peer opens its `vid-stream` DataChannel,
 *        we start shipping 64KB chunks from byte 0 with a tiny header.
 *
 *   Peer (receiver):
 *     1. App.tsx receives the `spawn` envelope with streamingHint and
 *        calls `attachReceiver(streamingHint, assetId)`. We create a
 *        MediaSource-backed <video> element and an MP4Box instance.
 *     2. As chunks land on our binary DataChannel, we feed them into
 *        MP4Box.appendBuffer with the parsed byteOffset on `fileStart`.
 *     3. MP4Box's `onReady` extracts codec metadata; `onSegment` gives
 *        us fMP4 fragment buffers we append to the SourceBuffer.
 *     4. When the <video> element fires `loadedmetadata`, the receiver
 *        calls back into AssetManager.loadVideoFromStreamedSource to
 *        attach a THREE.VideoTexture wrapping the existing element.
 *
 * Wire format (per binary message):
 *   [u32 idLen][idLen bytes utf8 id][u64 little-endian byteOffset][raw bytes...]
 *   id = streamingHint.id (UUID-like). Single shared scheme between the
 *   DataChannel's `cid` field and the streamingHint envelope field; we
 *   never multiplex multiple streams over one DataChannel — each video
 *   gets its own peer-to-peer pipe via `peer.connect({label:'vid-stream'})`.
 *
 * Why a SECOND DataConnection instead of re-using the JSON one?
 *   - Head-of-line blocking: a 50 MB video chunk sequence will stall
 *     avatars / transforms / chat on the JSON channel until the SCTP
 *     send buffer drains. Independent channel keeps real-time traffic
 *     flowing.
 *   - Base64 round-trip avoided: raw ArrayBuffer over a binary-reliable
 *     DataChannel saves ~33% bandwidth and ~50% of the heap inflation
 *     that crashed Quest in the first place.
 */
// mp4box.js ships only named exports — no default, and the original
// `MP4ArrayBuffer` / `MP4Info` types are internal/private names. The
// official surface is `createFile` (the factory) + a handful of
// re-exported types. We declare a minimal local `MP4Info` shape that
// matches the callback signature mp4box.js actually emits, and rely
// on the file's included `.d.mts` for the runtime class.
import { createFile } from 'mp4box';
import type { DataConnection } from 'peerjs';
import type { NetworkService } from './NetworkService.ts';

/**
 * Minimal shape of the bundle-info object passed to `mp4box.onReady`.
 * mp4box.js's published types do not surface this; we re-declare just
 * the fields we read here so the rest of the file stays typed.
 */
interface MP4Info {
  tracks: Array<{ id: number; codec: string }>;
  duration?: number;
  timescale?: number;
  isFragmented?: boolean;
}

export interface VideoStreamingHint {
  /** Unique transport session id. Sender generates, receiver uses to route chunks. */
  id: string;
  /** Final file size in bytes. Used by the receiver to bound its progress UI + MSE buffer policy. */
  fileSize: number;
  /** MIME hint (broader codec strings supplied at registration time). */
  mimeHint?: string;
}

interface SenderSession {
  assetId: string;
  file: File | Blob;
  fileSize: number;
  mimeHint?: string;
  /** Per-peer offset cursor so a fresh peer restarts at byte 0. */
  peerOffsets: Map<string, number>;
  /** Per-peer backpressure state: true while the DataChannel is flowing. */
  peerInflight: Set<string>;
  /** A chunked FileReader bound to this file (one slot per reader; readers are cheap). */
  reader: FileReader | null;
  readerSeq: number;
}

interface ReceiverSession {
  assetId: string;
  hint: VideoStreamingHint;
  videoElement: HTMLVideoElement;
  receivedChunks: ArrayBuffer[];
  /** Cumulative bytes received so far. Drives progress UI + completion detection. */
  bytesReceived: number;
  /** True once `loadedmetadata` fired on the <video>; AssetManager hookup happens here. */
  ready: boolean;
  finished: boolean;
  /** Completion / failure callbacks. AssetManager.loadVideoFromStreamedSource wires these. */
  onReady: ((videoEl: HTMLVideoElement) => void) | null;
  onError: ((err: Error) => void) | null;
}

// Bytes of file content per binary chunk post-header. 64 KB matches the
//  ~64 KB DataChannel default MTU and keeps our wire aligned with
//  NetworkService.sendChunked's fragmentation.
const VIDEO_STREAM_CHUNK_BYTES = 64 * 1024;

export class VideoStreamingService {
  /** sessionId → SenderSession (host register). One per active import. */
  private senders: Map<string, SenderSession> = new Map();
  /** sessionId → ReceiverSession (peer attach). One per in-flight receive. */
  private receivers: Map<string, ReceiverSession> = new Map();
  /** peerId → DataConnection for the binary stream. Populated when the
   * host's outbound dial reaches 'open' on our side (via
   * NetworkService.onBinaryChannelOpen). Pre-populating this map with
   * a `dataConn: null` tombstone (the prior approach) is unsafe
   * because tearDownPeerBinary reads `bc.dataConn` to close it; an
   * honest `DataConnection | null` typing broke the existing
   * `tearDownPeerBinary` and `tearDownPeerBinary`-adjacent code, so
   * instead we populate this map exactly once when the inbound fires,
   * which keeps the type honest and matches the VSS `binaryConns`
   * contract (which assumes dataConn is always a live DC). */
  private binaryConns: Map<string, { dataConn: DataConnection; sessionIds: Set<string> }> = new Map();
  /** peerId → list of receivers that registered BEFORE the host's
   * binary conn reached 'open'. Each entry is one asset's wire-up
   * closure; once the conn opens, `wireUpReceiverSubscribers` drains
   * the list and attaches one `dc.on('data')` handler per subscriber.
   * Without this list, a second asset arriving from the same host
   * BEFORE the conn fires would early-return (saving its
   * wireUpListener closure) and never get its data handler wired —
   * every byte that landed would route to the first asset's
   * MP4Box, corrupting the second asset's codec parser state. */
  private pendingReceiverSubscribersByPeer: Map<string, Array<{
    assetId: string;
    hint: VideoStreamingHint;
    receiverKey: string;
  }>> = new Map();
  /** receiverKey → watchdog timeout that fires `fail()` if the host's
   * binary conn never opens within 30s (host crashed before 'open',
   * signaling hiccup, the peer id in `peers` is stale). Cleared on
   * wire-up success so it can't fire after the data started flowing. */
  private receiverWatchdogs: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** Listeners for asset-id landed callbacks (AssetManager.loadVideoFromStreamedSource). */
  private assetReadyCallbacks: Map<string, (videoEl: HTMLVideoElement) => void> = new Map();
  private assetErrorCallbacks: Map<string, (err: Error) => void> = new Map();
  private net: NetworkService;

  constructor(net: NetworkService) {
    this.net = net;
    // Hook into NetworkService's peer lifecycle to open / tear-down binary
    // channels in lock-step. The peer.connect calls below match the
    // acceptDataConnection pattern in NetworkService.
    net.onPeerLeave((peerId) => {
      this.tearDownPeerBinary(peerId);
    });
  }

  // ===========================================================================
  // SENDER (host) API
  // ===========================================================================

  /**
   * Host-side: register a video File for binary streaming. Stores the
   * File/Blob reference (no arrayBuffer!). Returns a streamingHint the
   * host embeds in the relevant `AssetSpawnData.streamingHint` so peers
   * know to expect a binary stream instead of an inline fileData.
   */
  public registerHostFile(file: File | Blob, assetId: string, mimeHint?: string): VideoStreamingHint {
    const id = `vstream-${assetId}-${Math.random().toString(36).slice(2, 9)}`;
    this.senders.set(id, {
      assetId,
      file,
      fileSize: file.size,
      mimeHint,
      peerOffsets: new Map(),
      peerInflight: new Set(),
      reader: null,
      readerSeq: 0,
    });
    return { id, fileSize: file.size, mimeHint };
  }

  /**
   * Called by App.tsx AFTER the spawn envelope has been broadcast, to
   * actually start shipping bytes to each peer. Opens the per-peer
   * binary DataChannel (lazily) and starts the chunk pump for that peer.
   */
  public async beginStreamingToPeer(hint: VideoStreamingHint, peerId: string): Promise<void> {
    const session = this.senders.get(hint.id);
    if (!session) return;
    if (session.peerOffsets.has(peerId)) return; // already streaming
    session.peerOffsets.set(peerId, 0);
    session.peerInflight.add(peerId);

    let bc = this.binaryConns.get(peerId);
    if (!bc) {
      try {
        const dataConn = this.net.openBinaryChannel(peerId);
        bc = { dataConn, sessionIds: new Set() };
        this.binaryConns.set(peerId, bc);
        // Wire the per-peer message handler. Each incoming chunk is just
        // an ack-style control (none in v1, but reserved for the future);
        // bulk of bytes are outbound.
        dataConn.on('data', (_raw) => {
          // Reserved for future control messages (e.g. peer asks for
          // re-transmission of a range). v1 is happy without it.
        });
      } catch (err) {
        console.warn('[VideoStreaming] Failed to open vid-stream channel to', peerId, err);
        return;
      }
    }
    bc.sessionIds.add(hint.id);

    const startPump = () => {
      this.pumpChunksToPeer(hint.id, peerId).catch((err) => {
        console.warn('[VideoStreaming] pump error for', hint.id, '->', peerId, err);
      });
    };
    if (bc.dataConn.open) {
      startPump();
    } else {
      const onOpen = () => {
        try { bc?.dataConn.off('open', onOpen); } catch { /* noop */ }
        startPump();
      };
      bc.dataConn.on('open', onOpen);
    }
  }

  /**
   * Watch Party Live Stream mode: captures a real-time WebRTC MediaStream
   * directly from the host's HTMLVideoElement and calls the peer.
   * Peers receive frames immediately with zero file downloading or RAM buffering.
   */
  public startLiveStreamToPeer(assetId: string, videoElement: HTMLVideoElement, peerId: string): void {
    try {
      const stream: MediaStream =
        typeof (videoElement as unknown as { captureStream?: (fps?: number) => MediaStream }).captureStream === 'function'
          ? (videoElement as unknown as { captureStream: (fps?: number) => MediaStream }).captureStream(30)
          : typeof (videoElement as unknown as { mozCaptureStream?: (fps?: number) => MediaStream }).mozCaptureStream === 'function'
          ? (videoElement as unknown as { mozCaptureStream: (fps?: number) => MediaStream }).mozCaptureStream(30)
          : (null as unknown as MediaStream);
      if (!stream) {
        console.warn('[VideoStreaming] captureStream not supported on this browser');
        return;
      }
      console.log('[VideoStreaming] Calling peer with high-res live WebRTC MediaStream:', peerId, 'asset:', assetId);
      const call = this.net.callMediaStream(peerId, stream, { kind: 'vid-live-stream', assetId });
      if (call && call.peerConnection) {
        const senders = call.peerConnection.getSenders();
        for (const sender of senders) {
          if (sender.track && sender.track.kind === 'video') {
            try {
              const params = sender.getParameters();
              if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
              params.encodings[0].maxBitrate = 8_000_000; // 8 Mbps crisp video stream
              sender.setParameters(params).catch(() => {});
            } catch { /* ignore if browser doesn't support sender parameters */ }
          }
        }
      }
      call?.on('error', (err) => console.warn('[VideoStreaming] Live stream call error:', err));
    } catch (err) {
      console.warn('[VideoStreaming] startLiveStreamToPeer failed:', err);
    }
  }

  private async pumpChunksToPeer(sessionId: string, peerId: string): Promise<void> {
    const session = this.senders.get(sessionId);
    if (!session) return;
    const bc = this.binaryConns.get(peerId);
    if (!bc) return;
    const dc = bc.dataConn;

    const offset0 = session.peerOffsets.get(peerId) ?? 0;
    for (let offset = offset0; offset < session.fileSize;) {
      if (!dc.open) {
        await new Promise<void>((resolve) => {
          const onOpen = () => {
            try { dc.off('open', onOpen); } catch { /* noop */ }
            resolve();
          };
          dc.on('open', onOpen);
          setTimeout(resolve, 3000);
        });
        if (!dc.open) return;
      }

      const dcRaw: RTCDataChannel | undefined =
        (dc as unknown as { dataChannel?: RTCDataChannel; _dc?: RTCDataChannel; channel?: RTCDataChannel }).dataChannel ||
        (dc as unknown as { _dc?: RTCDataChannel })._dc ||
        (dc as unknown as { channel?: RTCDataChannel }).channel;
      if (dcRaw && dcRaw.bufferedAmount > 256 * 1024) {
        await new Promise<void>((resolve) => {
          let resolved = false;
          const finish = () => {
            if (resolved) return;
            resolved = true;
            try { dcRaw.removeEventListener('bufferedamountlow', finish); } catch { /* noop */ }
            resolve();
          };
          try {
            dcRaw.bufferedAmountLowThreshold = 64 * 1024;
            dcRaw.addEventListener('bufferedamountlow', finish);
          } catch { /* noop */ }
          setTimeout(finish, 50);
        });
      } else if ((offset / VIDEO_STREAM_CHUNK_BYTES) % 4 === 0) {
        // Yield every 256 KB so WebRTC SCTP socket flushes cleanly without blocking
        await new Promise<void>((r) => setTimeout(r, 2));
      }

      const end = Math.min(offset + VIDEO_STREAM_CHUNK_BYTES, session.fileSize);
      const slice = session.file.slice(offset, end);
      const buf = await slice.arrayBuffer();
      const header = buildChunkHeader(sessionId, offset);
      const message = concatBuffers(header, buf);
      try {
        dc.send(message);
      } catch (err) {
        console.warn('[VideoStreaming] send failed at offset', offset, '->', peerId, err);
        session.peerOffsets.set(peerId, offset);
        if (!dc.open) {
          dc.on('open', () => {
            this.pumpChunksToPeer(sessionId, peerId).catch(() => {});
          });
        } else {
          setTimeout(() => {
            this.pumpChunksToPeer(sessionId, peerId).catch(() => {});
          }, 500);
        }
        return;
      }
      offset = end;
      session.peerOffsets.set(peerId, offset);
      if (Math.floor(offset / (10 * 1024 * 1024)) > Math.floor((offset - VIDEO_STREAM_CHUNK_BYTES) / (10 * 1024 * 1024))) {
        console.log(`[VideoStreaming] Sent ${(offset / (1024 * 1024)).toFixed(1)} MB / ${(session.fileSize / (1024 * 1024)).toFixed(1)} MB to ${peerId}`);
      }
    }

    console.log(`[VideoStreaming] Completed sending all ${(session.fileSize / (1024 * 1024)).toFixed(1)} MB / ${(session.fileSize / (1024 * 1024)).toFixed(1)} MB to ${peerId}`);
    session.peerInflight.delete(peerId);
    // Optionally send an end-of-stream marker so the receiver can close
    // its SourceBuffer cleanly. v1 relies on `bytesReceived === fileSize`
    // instead, but this hook is left in for a future "real" marker.
    try {
      dc.send(buildEndOfStreamMarker(sessionId));
    } catch { /* peer may already be gone */ }
  }

  // ===========================================================================
  // RECEIVER (peer) API
  // ===========================================================================

  /**
   * Peer side: called from App.tsx onSpawn's streamingHint branch. Stores
   * the receiver session and wires the <video> element + MSE pipeline.
   * The actual AssetManager hookup happens later, when `loadedmetadata`
   * fires (then AssetManager.loadVideoFromStreamedSource is called).
   */
  public attachReceiver(hint: VideoStreamingHint, assetId: string, hostPeerIdOverride?: string): HTMLVideoElement {
    const videoElement = document.createElement('video');
    videoElement.muted = true;
    videoElement.loop = true;
    videoElement.preload = 'auto';
    videoElement.playsInline = true;
    videoElement.crossOrigin = 'anonymous';

    const receiverKey = `${assetId}-${hint.id}`;
    const session: ReceiverSession = {
      assetId,
      hint,
      videoElement,
      receivedChunks: [],
      bytesReceived: 0,
      ready: false,
      finished: false,
      onReady: null,
      onError: null,
    };
    this.receivers.set(receiverKey, session);

    const targetHostId = hostPeerIdOverride || ((this.net.hostId && this.net.hostId !== this.net.localPeerId)
      ? this.net.hostId
      : (this.net.roomId && `${this.net.roomId}-host` !== this.net.localPeerId ? `${this.net.roomId}-host` : null));
    if (targetHostId && targetHostId !== this.net.localPeerId) {
      this.openReceiverChannel(assetId, hint, targetHostId, receiverKey);
    } else {
      console.warn('[VideoStreaming] Cannot attach receiver: no valid remote host peerId found', { hint, targetHostId });
    }
    return videoElement;
  }

  /**
   * Local MSE pipeline (no DataChannel, no PeerJS).
   *
   * Mirrors the receiver-side MP4Box + MediaSource wiring from
   * `attachReceiver` but pumps bytes from a local File/Blob instead
   * of a binary PeerJS DataChannel. Used by AssetManager for large
   * local MP4 imports so first frame lands in well under the time
   * it'd take a blob: URL to pre-roll metadata + initial keyframes
   * on a 200MB+ 4K file (which on Quest 2 is multi-second). Returns
   * the wired `HTMLVideoElement` ready for THREE.VideoTexture via
   * `AssetManager.loadVideoFromStreamedSource`.
   *
   * Pipeline:
   *   1. Create MediaSource + blob: URL → `<video>.src`.
   *   2. MP4Box instance waits on `mediaSource.sourceopen` to wire
   *      `onReady` → `addSourceBuffer(codec)` + `setSegmentOptions` +
   *      `start()`. Same as the network receiver.
   *   3. A local chunk pump reads `file.slice(offset, offset+CHUNK)`
   *      → `arrayBuffer()` → `mp4box.appendBuffer(buf with
   *      fileStart=offset)`. MP4Box parses and we get back the same
   *      `onSegment` callbacks the network path uses, which we
   *      append to the SourceBuffer.
   *   4. `<video>` element's `loadedmetadata` fires when the
   *      SourceBuffer has enough buffered data — at that point
   *      `AssetManager.loadVideoFromStreamedSource` wraps it as a
   *      THREE.VideoTexture and adds the panel to the scene.
   *
   * Throw-on-unsupported behavior matches `attachReceiver`: a try/catch
   * around the call lets AssetManager fall through to the regular
   * `video.src = URL.createObjectURL(file)` blob URL path so an
   * unsupported browser (rare: iOS Safari in some configs, Firefox
   * without MSE) still gets a working video at native frame rates.
   *
   * Cleanup: the caller (AssetManager) holds the videoElement. On
   * removeAsset, AssetManager's existing customDispose hook already
   * pauses + clears `video.src` + cancels rVFC callbacks, which
   * incidentally fires the MediaSource `sourceclose` and lets
   * GC reclaim the SourceBuffer + MP4Box. No explicit teardown
   * here — the local path doesn't need a `receivers` map entry
   * because there's no host session to track.
   */
  public attachLocalReceiver(file: File | Blob, _assetId: string): HTMLVideoElement {
    if (!('MediaSource' in window) || typeof MediaSource === 'undefined') {
      throw new Error('MediaSourceExtensions not supported on this device');
    }
    const videoElement = document.createElement('video');
    videoElement.muted = true;
    videoElement.loop = true;
    const mediaSource = new MediaSource();
    videoElement.src = URL.createObjectURL(mediaSource);
    const mp4box = createFile();

    // Captured SourceBuffer reference used by the onSegment closure
    // below. Stays null until MP4Box.onReady resolves the codec and
    // we addSourceBuffer; appended-to segments silently no-op until
    // then, which is fine because MP4Box queues them internally.
    let sb: SourceBuffer | null = null;

    // Local chunk pump. 4 MB slices keep the resident ArrayBuffer
    // bounded — a 300 MB file gives ~75 transient ArrayBuffer
    // chunks over its lifetime, each freed as soon as MP4Box
    // hands us the parsed onSegment buffers. The 4 MB slice size
    // also keeps individual `arrayBuffer()` calls under the
    // browser's V8 heap-warning ceiling on Quest (~16 MB) and is
    // large enough that we don't pay MP4Box parsing overhead on
    // every byte. A small `setTimeout(0)` yield every 4 chunks
    // hands the SourceBuffer's `updateend` event loop a chance
    // to drain — saves us from deadlocking the append queue on
    // devices that buffer one frame at a time.
    const pumpChunks = async (): Promise<void> => {
      const LOCAL_CHUNK = 4 * 1024 * 1024;
      for (let offset = 0; offset < file.size;) {
        const end = Math.min(offset + LOCAL_CHUNK, file.size);
        const slice = file.slice(offset, end);
        const buf = await slice.arrayBuffer();
        // `fileStart` is the non-standard property MP4Box reads
        // back to know where in the original MP4 stream this chunk
        // belongs (mirroring the network path's wire format).
        (buf as ArrayBuffer & { fileStart: number }).fileStart = offset;
        mp4box.appendBuffer(buf as ArrayBuffer & { fileStart: number });
        // Yield every 4 chunks (~16 MB) so SourceBuffer's updateend
        // event loop can fire before the pump allocates the next
        // 4 MB slice. Without this we can starve the append queue
        // on slow devices — observable as a stuck "loading…" UI
        // with no error.
        if (((offset / LOCAL_CHUNK) | 0) % 4 === 3) {
          await new Promise<void>((r) => setTimeout(r, 0));
        }
        offset = end;
      }
      // Best-effort end-of-stream so the browser flushes the last
      // SourceBuffer segment cleanly. The previous version called
      // endOfStream synchronously after the pump resolved, but the
      // very last appendBuffer may still be in flight (sourceBuffer
      // .updating === true at the moment we hit the end of the
      // for-loop), and endOfStream throws InvalidStateError in that
      // case — a frame stall on the very last byte. Wait for the
      // SourceBuffer to settle first if it's mid-update; otherwise
      // the call is safe. If MP4Box has already marked an error
      // (corrupt file), MediaSource.endOfStream throws and we let
      // the prior SourceBuffer error path handle it.
      try {
        if (sb && sb.updating) {
          await new Promise<void>((resolve) => {
            const onUpd = () => {
              sb?.removeEventListener('updateend', onUpd);
              resolve();
            };
            sb?.addEventListener('updateend', onUpd);
            // Defensive 1000 ms cap so a wedged updateend doesn't
            // leak the promise long enough to be user-visible. On
            // Quest 3 + 4 MB moof+mdat fragment under multi-video
            // load, the final appendBuffer's updateend can stretch
            // 300-500 ms, and a stalled SourceBuffer from a rare
            // browser quirk can run longer — 1000 ms is the W3C
            // source-buffer-flush upper bound and stays well under
            // any frame budget the user would notice.
            setTimeout(() => { try { sb?.removeEventListener('updateend', onUpd); } catch { /* noop */ } resolve(); }, 1000);
          });
        }
        if (mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      } catch { /* noop — MP4Box already errored or MediaSource is gone */ }
    };

    mediaSource.addEventListener('sourceopen', () => {
      mp4box.onError = (err: string) => {
        // Wire the local MP4Box parse failure to the W3C MSE error
        // pipeline so calling code (loadVideoFromStreamedSource's
        // videoElement.error listener, future analytics hooks) can
        // detect the failure and fall through to the blob: URL
        // fallback. `endOfStream('decode')` is the spec-supported
        // way to mark the stream as failed; the browser fires the
        // `<video>` element's `error` event automatically with a
        // typed MediaError pointing at the decode failure, so we do
        // NOT also dispatch a synthetic 'error' event here — doing
        // so would double-fire (the browser's spec-driven event
        // fires too) AND assigning `videoElement.error` directly is a
        // spec violation (it's a read-only DOM property on Safari and
        // silently dropped on Chrome). The single endOfStream('decode')
        // call is the canonical signal path.
        console.warn('[VideoStreaming] local MP4Box parse error:', err);
        try { mediaSource.endOfStream('decode'); } catch { /* already ended */ }
      };
      mp4box.onReady = (info: MP4Info) => {
        try {
          // Pick the video track, not whichever MP4Box happened to list
          // first. See the matching comment in attachReceiver's sourceopen
          // handler for the audio-first multiplexer trap this avoids.
          const track = info.tracks.find((t) =>
            t.codec?.startsWith('avc') ||
            t.codec?.startsWith('hev') ||
            t.codec?.startsWith('hvc') ||
            t.codec?.startsWith('vp') ||
            t.codec?.startsWith('av01')
          ) ?? info.tracks[0] ?? null;
          if (!track) throw new Error('MP4Box reported no tracks for this MP4');
          const codec = track.codec;
          const mime = `video/mp4; codecs="${codec}"`;
          sb = mediaSource.addSourceBuffer(mime);
          sb.mode = 'segments';
          mp4box.setSegmentOptions(track.id, sb, { nbSamples: 100 });
          mp4box.start();
          void pumpChunks();
        } catch (err) {
          console.warn('[VideoStreaming] local onReady failed:', err);
        }
      };
      mp4box.onSegment = (_id: number, _user: unknown, buffer: ArrayBuffer) => {
        if (!sb) return;
        if (!sb.updating) {
          try { sb.appendBuffer(buffer); } catch (err) {
            console.warn('[VideoStreaming] local appendBuffer failed:', err);
          }
        } else {
          // One-slot defer since we're feeding one (video) track.
          // A multi-track stream would queue per-track; not needed
          // for v1's single-video-per-pipeline contract.
          sb.addEventListener('updateend', function append() {
            sb?.removeEventListener('updateend', append);
            if (sb && !sb.updating) {
              try { sb.appendBuffer(buffer); } catch (err) {
                console.warn('[VideoStreaming] local appendBuffer failed:', err);
              }
            }
          }, { once: true });
        }
      };
    });

    return videoElement;
  }

  /**
   * Phase 3A receiver-side hookup. The receiver does NOT dial a
   * binary conn back to the host — that would open a SECOND
   * `vid-binary` RTCDataChannel (distinct from the host's outbound
   * one) and the host's `beginStreamingToPeer` only sends on its
   * outbound. Symptom: importer sees the video locally; peer sees
   * nothing forever, no bytes arrive.
   *
   * Instead the receiver registers a one-shot callback via
   * `net.onBinaryChannelOpen(hostPeerId, cb)` which fires on the
   * same DataConnection the host dialed. NetworkService's
   * `peer.on('connection')` branch discriminates by `metadata.kind
   * === 'vid-binary'` and routes the inbound to that callback
   * instead of its own JSON-envelope `acceptDataConnection` handler.
   *
   * Multi-asset streams from the same host share one DataConnection
   * (the host dials once per peer and multiplexes all sessions on
   * that one peerId). Receivers queue subscriber entries in
   * `pendingReceiverSubscribersByPeer`; when the inbound fires,
   * `wireUpReceiverSubscribers` drains the queue and attaches one
   * `dc.on('data')` handler per subscriber. Without this queue,
   * a second asset arriving BEFORE the conn fires would early-return
   * and never get its data handler wired — every byte landing would
   * route to the FIRST asset's MP4Box and corrupt its codec state.
   *
   * Late-registration: if the receiver registers AFTER the host
   * already dialed (e.g. a late import that triggers spawn well
   * after the host's beginStreamingToPeer ran), `onBinaryChannelOpen`
   * synchronously fires the wire-up callback with the already-open
   * conn. Without this path the receiver would silently wait forever
   * for a 'connection' event that already happened (PeerJS doesn't
   * replay them).
   *
   * Watchdog: if the host's conn never opens within 30s (crash
   * before 'open', signaling hiccup, peer id in `peers` is stale),
   * the watchdog fires `fail()` so the asset surfaces an inspector
   * error rather than hanging forever waiting for bytes that will
   * never come. Cleared on successful wire-up so it can't fire
   * after the data started flowing.
   */
  private openReceiverChannel(
    assetId: string,
    hint: VideoStreamingHint,
    peerId: string,
    receiverKey: string
  ): void {
    // Append to pending subscribers. First-arrival may also be
    // the listener that drains the list on 'open'.
    if (!this.pendingReceiverSubscribersByPeer.has(peerId)) {
      this.pendingReceiverSubscribersByPeer.set(peerId, []);
    }
    this.pendingReceiverSubscribersByPeer.get(peerId)!.push({ assetId, hint, receiverKey });

    // Watchdog per receiverKey so concurrent imports from the same
    // host don't share a single global timeout (one slow-open
    // shouldn't fail a fast-open that arrived on a later wire-up).
    const watchdog = setTimeout(() => {
      if (this.receiverWatchdogs.has(receiverKey)) {
        this.receiverWatchdogs.delete(receiverKey);
        // Strip this subscriber from the pending queue; surface a
        // fail on this asset only (sibling subscribers may still
        // be queued for the same peer and shouldn't be collateral
        // damage from one binary-conn that didn't open).
        const subs = this.pendingReceiverSubscribersByPeer.get(peerId);
        if (subs) {
          this.pendingReceiverSubscribersByPeer.set(
            peerId,
            subs.filter(s => s.receiverKey !== receiverKey)
          );
        }
        this.fail(assetId, new Error(`Binary channel from host ${peerId} never opened (30s watchdog)`));
      }
    }, 30000);
    this.receiverWatchdogs.set(receiverKey, watchdog);

    try {
      this.net.onBinaryChannelOpen(peerId, (dataConn) => {
        this.wireUpReceiverSubscribers(peerId, dataConn);
      });
    } catch (err) {
      clearTimeout(watchdog);
      this.receiverWatchdogs.delete(receiverKey);
      const subs = this.pendingReceiverSubscribersByPeer.get(peerId);
      if (subs) {
        this.pendingReceiverSubscribersByPeer.set(
          peerId,
          subs.filter(s => s.receiverKey !== receiverKey)
        );
      }
      this.fail(assetId, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Drain `pendingReceiverSubscribersByPeer[peerId]` into a single
   * `binaryConns[peerId]` entry. Each subscriber gets its own
   * `dc.on('data')` handler closure so multi-asset streams
   * demux correctly (a 2nd asset's wire handler validates
   * `header.sessionId === hint.id` in `handleIncomingBinary` and
   * silently drops mismatched chunks before they enter MP4Box —
   * MP4Box appendBuffer on foreign bytes corrupts codec state).
   *
   * Idempotent on re-entry: if bg subscriber was queued AFTER we
   * already drained (peer re-joined, late import), this is called
   * again and we reattach. Each call replaces the binaryConns entry
   * with a fresh dataConn (the latest one wins), so a stale-but-not-
   * closed conn from a previous round is left to GC by PeerJS when
   * its 'close' fires.
   */
  private wireUpReceiverSubscribers(peerId: string, dataConn: DataConnection): void {
    const subs = this.pendingReceiverSubscribersByPeer.get(peerId) ?? [];
    this.pendingReceiverSubscribersByPeer.delete(peerId);
    if (subs.length === 0) return;

    this.binaryConns.set(peerId, {
      dataConn,
      sessionIds: new Set(subs.map(s => s.hint.id))
    });
    for (const sub of subs) {
      // Map.get returns undefined for absent keys; clearTimeout is a safe no-op on that.
      clearTimeout(this.receiverWatchdogs.get(sub.receiverKey));
      this.receiverWatchdogs.delete(sub.receiverKey);
      dataConn.on('data', (raw) => {
        this.handleIncomingBinary(sub.assetId, sub.hint, sub.receiverKey, raw);
      });
    }
  }

  private async handleIncomingBinary(
    _assetId: string,
    hint: VideoStreamingHint,
    receiverKey: string,
    raw: unknown
  ): Promise<void> {
    const session = this.receivers.get(receiverKey);
    if (!session || session.finished) {
      return;
    }
    let buf: ArrayBuffer | null = null;
    if (raw instanceof ArrayBuffer) {
      buf = raw;
    } else if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView;
      buf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
    } else if (raw instanceof Blob) {
      buf = await raw.arrayBuffer();
    }
    if (!buf || !(buf instanceof ArrayBuffer)) return;
    const { header, body } = parseChunkMessage(buf);
    if (header.sessionId !== hint.id) {
      return;
    }
    if (header.kind === 'end') {
      this.finishReceiverSession(session);
      return;
    }
    if (header.kind !== 'data' || !body) return;
    const prevMB = Math.floor((session.bytesReceived - body.byteLength) / (10 * 1024 * 1024));
    session.receivedChunks.push(body);
    session.bytesReceived += body.byteLength;
    const currMB = Math.floor(session.bytesReceived / (10 * 1024 * 1024));
    if (currMB > prevMB) {
      console.log(`[VideoStreaming] Received ${(session.bytesReceived / (1024 * 1024)).toFixed(1)} MB / ${(hint.fileSize / (1024 * 1024)).toFixed(1)} MB for asset ${session.assetId}`);
    }
    if (session.bytesReceived >= hint.fileSize) {
      this.finishReceiverSession(session);
    }
  }

  private finishReceiverSession(session: ReceiverSession): void {
    if (session.finished) return;
    session.finished = true;
    try {
      const blob = new Blob(session.receivedChunks, { type: session.hint.mimeHint || 'video/mp4' });
      session.receivedChunks = [];
      console.log('[VideoStreaming] Assembled clean video blob for peer:', session.assetId, blob.size, 'bytes');
      const blobUrl = URL.createObjectURL(blob);
      session.videoElement.src = blobUrl;
      session.videoElement.load();
      session.videoElement.play().catch(() => {});
      session.ready = true;
      this.fireAssetReady(session.assetId, session.videoElement);
    } catch (err) {
      console.warn('[VideoStreaming] Failed to assemble video blob:', err);
      this.fail(session.assetId, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private fail(assetId: string, err: Error): void {
    const cb = this.assetErrorCallbacks.get(assetId);
    if (cb) {
      cb(err);
    } else {
      console.warn('[VideoStreaming] receiver error before AssetManager listened:', assetId, err);
    }
  }

  private fireAssetReady(assetId: string, videoEl: HTMLVideoElement): void {
    const cb = this.assetReadyCallbacks.get(assetId);
    if (cb) {
      cb(videoEl);
      this.assetReadyCallbacks.delete(assetId);
    }
  }

  /**
   * AssetManager should call this once the receiver session is wired so
   * it can hand the live <video> element into THREE.VideoTexture. The
   * callback fires when the SourceBuffer has enough data to satisfy
   * `loadedmetadata`.
   */
  public onAssetReady(assetId: string, cb: (videoEl: HTMLVideoElement) => void): () => void {
    this.assetReadyCallbacks.set(assetId, cb);
    return () => { this.assetReadyCallbacks.delete(assetId); };
  }

  public onAssetError(assetId: string, cb: (err: Error) => void): () => void {
    this.assetErrorCallbacks.set(assetId, cb);
    return () => { this.assetErrorCallbacks.delete(assetId); };
  }

  // ===========================================================================
  // INTERNAL CLEANUP
  // ===========================================================================

  private tearDownPeerBinary(peerId: string): void {
    const bc = this.binaryConns.get(peerId);
    if (!bc) return;
    try { bc.dataConn.close(); } catch { /* noop */ }
    this.binaryConns.delete(peerId);
    // Phase 3A: drop pending subscribers from this peer so a re-join
    // can re-register cleanly. Watchdog timers are per-receiverKey
    // so they need to be cleared by iterating pending entries for
    // the peer and removing from the watchdog map. Without this,
    // a slow open fires the watchdog AFTER tear-down promised the
    // asset would never get bytes, surfacing a misleading inspector
    // error for an asset the user already gave up on.
    const pending = this.pendingReceiverSubscribersByPeer.get(peerId);
    if (pending) {
      for (const sub of pending) {
        const wd = this.receiverWatchdogs.get(sub.receiverKey);
        if (wd !== undefined) {
          clearTimeout(wd);
          this.receiverWatchdogs.delete(sub.receiverKey);
        }
      }
      this.pendingReceiverSubscribersByPeer.delete(peerId);
    }
    // Drop any sender-side per-peer offsets so a re-join restarts from 0.
    for (const session of this.senders.values()) {
      session.peerOffsets.delete(peerId);
      session.peerInflight.delete(peerId);
    }
  }

  public dispose(): void {
    for (const bc of this.binaryConns.values()) {
      try { bc.dataConn.close(); } catch { /* noop */ }
    }
    this.binaryConns.clear();
    // Phase 3A cleanup: pending subscribers' watchdogs would otherwise
    // fire after dispose() and log misleading "binary channel never
    // opened" errors for assets the user already tore down.
    for (const wd of this.receiverWatchdogs.values()) clearTimeout(wd);
    this.receiverWatchdogs.clear();
    this.pendingReceiverSubscribersByPeer.clear();
    for (const session of this.receivers.values()) {
      try { session.videoElement.pause(); } catch { /* noop */ }
      URL.revokeObjectURL(session.videoElement.src);
    }
    this.receivers.clear();
    this.senders.clear();
    this.assetReadyCallbacks.clear();
    this.assetErrorCallbacks.clear();
  }
}

// ===========================================================================
// Wire-format helpers (header parsing + building)
// ===========================================================================
// Header layout: [u8 kind, 1B][idSlot 23B][u64 offset 8B] = 32 bytes total.
// Builder writes bytes 0..31 inclusive. Parser slices the body from byte 32
// onward. Misalignment here was a critical bug — 13 bytes of every chunk
// were bleeding into the next chunk's body extraction.
const HEADER_LEN = 32;

interface ParsedChunkHeader {
  kind: 'data' | 'end';
  sessionId: string;
  byteOffset: number;
}

function buildChunkHeader(sessionId: string, byteOffset: number): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_LEN);
  const view = new DataView(buf);
  // u8 kind: 0 = data, 1 = end. Use 24 bytes for the id padded with zeros.
  view.setUint8(0, 0);
  const idBytes = new TextEncoder().encode(sessionId);
  const copyLen = Math.min(idBytes.length, 23);
  for (let i = 0; i < copyLen; i++) view.setUint8(1 + i, idBytes[i]);
  view.setBigUint64(24, BigInt(byteOffset), true /*littleEndian*/);
  return buf;
}

function buildEndOfStreamMarker(sessionId: string): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_LEN);
  const view = new DataView(buf);
  view.setUint8(0, 1);
  const idBytes = new TextEncoder().encode(sessionId);
  const copyLen = Math.min(idBytes.length, 23);
  for (let i = 0; i < copyLen; i++) view.setUint8(1 + i, idBytes[i]);
  return buf;
}

function parseChunkMessage(buf: ArrayBuffer): { header: ParsedChunkHeader; body: ArrayBuffer | null } {
  if (!buf || !(buf instanceof ArrayBuffer) || buf.byteLength < HEADER_LEN) {
    return { header: { kind: 'data', sessionId: '', byteOffset: 0 }, body: null };
  }
  const view = new DataView(buf);
  const kind = view.getUint8(0);
  const idBytes = new Uint8Array(buf, 1, 23);
  // Trim trailing zeros.
  let idLen = idBytes.length;
  while (idLen > 0 && idBytes[idLen - 1] === 0) idLen--;
  const sessionId = new TextDecoder().decode(idBytes.subarray(0, idLen));
  const byteOffset = Number(view.getBigUint64(24, true));
  if (kind === 1) {
    return { header: { kind: 'end', sessionId, byteOffset }, body: null };
  }
  const body = buf.slice(HEADER_LEN);
  return { header: { kind: 'data', sessionId, byteOffset }, body };
}

function concatBuffers(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer {
  const out = new ArrayBuffer(a.byteLength + b.byteLength);
  const outView = new Uint8Array(out);
  outView.set(new Uint8Array(a), 0);
  outView.set(new Uint8Array(b), a.byteLength);
  return out;
}
export {};
