import { Peer, type DataConnection } from 'peerjs';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
];

export type TunnelStatus = 'idle' | 'listening' | 'connected' | 'transferring' | 'error';

export interface DeviceInfo {
  name: string;
  isMobile: boolean;
  platform: string;
}

export interface TunnelTransferMeta {
  transferId: string;
  name: string;
  size: number;
  type: string;
  totalChunks: number;
}

const CHUNK_SIZE = 48 * 1024; // 48KB chunks — safe for all mobile WebRTC implementations

export function normalizePairCode(rawCode: string): string {
  return rawCode.replace(/^PAIR[-_]?/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().trim();
}

export function generatePairCode(): string {
  // 4 characters without easily confused glyphs (0, O, 1, I, L)
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export class CompanionTunnelService {
  private static instance: CompanionTunnelService | null = null;

  public static getInstance(): CompanionTunnelService {
    if (!CompanionTunnelService.instance) {
      CompanionTunnelService.instance = new CompanionTunnelService();
    }
    return CompanionTunnelService.instance;
  }

  // Active state
  public role: 'host' | 'companion' | null = null;
  public status: TunnelStatus = 'idle';
  public pairCode: string = '';
  public companionDevice: DeviceInfo | null = null;

  private peer: Peer | null = null;
  private activeConn: DataConnection | null = null;

  // Transfer reassembly buffers
  private inFlightTransferMeta: TunnelTransferMeta | null = null;
  private receivedChunks: Map<number, ArrayBuffer> = new Map();

  // Callbacks
  private onStatusChangeCallbacks: Set<(status: TunnelStatus, device?: DeviceInfo | null) => void> = new Set();
  private onFileReceivedCallbacks: Set<(file: File) => void> = new Set();
  private onUrlReceivedCallbacks: Set<(url: string) => void> = new Set();
  private onProgressCallbacks: Set<(progress: number, fileName: string) => void> = new Set();

  public onStatusChange(cb: (status: TunnelStatus, device?: DeviceInfo | null) => void): () => void {
    this.onStatusChangeCallbacks.add(cb);
    return () => this.onStatusChangeCallbacks.delete(cb);
  }

  public onFileReceived(cb: (file: File) => void): () => void {
    this.onFileReceivedCallbacks.add(cb);
    return () => this.onFileReceivedCallbacks.delete(cb);
  }

  public onUrlReceived(cb: (url: string) => void): () => void {
    this.onUrlReceivedCallbacks.add(cb);
    return () => this.onUrlReceivedCallbacks.delete(cb);
  }

  public onProgress(cb: (progress: number, fileName: string) => void): () => void {
    this.onProgressCallbacks.add(cb);
    return () => this.onProgressCallbacks.delete(cb);
  }

  private setStatus(status: TunnelStatus, device?: DeviceInfo | null) {
    this.status = status;
    if (device !== undefined) this.companionDevice = device;
    for (const cb of this.onStatusChangeCallbacks) {
      try { cb(status, this.companionDevice); } catch (e) { console.warn('[Tunnel] callback error:', e); }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HOST MODE (Main VR / Desktop PC)
  // ──────────────────────────────────────────────────────────────────────────

  public async startHost(code?: string): Promise<string> {
    if (this.peer && !this.peer.destroyed) {
      if (this.role === 'host' && this.pairCode) {
        return this.pairCode;
      }
      this.disconnect();
    }

    this.role = 'host';
    const cleanCode = code ? normalizePairCode(code) : generatePairCode();
    this.pairCode = cleanCode;
    const peerId = `nexus-tunnel-${cleanCode}`;

    return new Promise<string>((resolve, reject) => {
      try {
        this.peer = new Peer(peerId, {
          debug: 1,
          config: { iceServers: ICE_SERVERS }
        });

        this.peer.on('open', () => {
          this.setStatus('listening', null);
          resolve(this.pairCode);
        });

        this.peer.on('connection', (conn) => {
          this.handleHostIncomingConnection(conn);
        });

        this.peer.on('error', (err: any) => {
          console.warn('[Tunnel Host] Peer error:', err);
          if (err.type === 'unavailable-id') {
            // ID already taken, roll a new code and try once more
            const nextCode = generatePairCode();
            this.startHost(nextCode).then(resolve).catch(reject);
            return;
          }
          this.setStatus('error');
          reject(err);
        });
      } catch (err) {
        this.setStatus('error');
        reject(err);
      }
    });
  }

  private handleHostIncomingConnection(conn: DataConnection): void {
    if (this.activeConn && this.activeConn.open) {
      try { this.activeConn.close(); } catch { /* noop */ }
    }
    this.activeConn = conn;

    conn.on('open', () => {
      // Send handshake
      conn.send({
        type: 'tunnel-hello',
        name: 'NexusVR Host',
        isMobile: false,
        platform: navigator.platform || 'Desktop'
      });
    });

    conn.on('data', (data: any) => {
      this.handleIncomingData(data, conn);
    });

    conn.on('close', () => {
      if (this.activeConn === conn) {
        this.activeConn = null;
        this.companionDevice = null;
        this.setStatus('listening', null);
      }
    });

    conn.on('error', (err) => {
      console.warn('[Tunnel Host] Conn error:', err);
      if (this.activeConn === conn) {
        this.activeConn = null;
        this.companionDevice = null;
        this.setStatus('listening', null);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // COMPANION MODE (Mobile / Laptop Feeder)
  // ──────────────────────────────────────────────────────────────────────────

  public async connectAsCompanion(rawCode: string): Promise<void> {
    const cleanCode = normalizePairCode(rawCode);
    if (!cleanCode) throw new Error('Invalid pair code');

    this.disconnect();
    this.role = 'companion';
    this.pairCode = cleanCode;

    const hostPeerId = `nexus-tunnel-${cleanCode}`;
    const myId = `nx-comp-${Math.random().toString(36).substring(2, 9)}`;

    return new Promise<void>((resolve, reject) => {
      try {
        this.peer = new Peer(myId, {
          debug: 1,
          config: { iceServers: ICE_SERVERS }
        });

        const timeout = setTimeout(() => {
          reject(new Error('Connection timed out. Ensure the VR headset or PC is on the Pair screen.'));
        }, 15000);

        this.peer.on('open', () => {
          if (!this.peer) return;
          const conn = this.peer.connect(hostPeerId, { reliable: true });
          this.activeConn = conn;

          conn.on('open', () => {
            clearTimeout(timeout);
            // Send our device identity to host
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            const devInfo: DeviceInfo = {
              name: isMobile ? 'Mobile Device' : 'Companion Laptop',
              isMobile,
              platform: navigator.platform || (isMobile ? 'Mobile' : 'Desktop')
            };

            conn.send({
              type: 'tunnel-hello',
              ...devInfo
            });

            this.setStatus('connected', { name: 'NexusVR Host', isMobile: false, platform: 'VR / PC' });
            resolve();
          });

          conn.on('data', (data: any) => {
            this.handleIncomingData(data, conn);
          });

          conn.on('close', () => {
            this.setStatus('idle', null);
          });

          conn.on('error', (err) => {
            clearTimeout(timeout);
            this.setStatus('error');
            reject(err);
          });
        });

        this.peer.on('error', (err: any) => {
          clearTimeout(timeout);
          this.setStatus('error');
          reject(err);
        });
      } catch (err) {
        this.setStatus('error');
        reject(err);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DATA TRANSMISSION PROTOCOL
  // ──────────────────────────────────────────────────────────────────────────

  public async sendFile(file: File, onProgress?: (pct: number) => void): Promise<void> {
    if (!this.activeConn || !this.activeConn.open) {
      throw new Error('Not connected to primary device');
    }

    const transferId = `xfer-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const buffer = await file.arrayBuffer();
    const totalBytes = buffer.byteLength;
    const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);

    const meta: TunnelTransferMeta = {
      transferId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      totalChunks
    };

    // Step 1: Send metadata header
    this.activeConn.send({ type: 'transfer-start', meta });

    // Step 2: Send binary slices with flow control
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      const slice = buffer.slice(start, end);

      this.activeConn.send({
        type: 'transfer-chunk',
        transferId,
        index: i,
        data: slice
      });

      const pct = Math.round(((i + 1) / totalChunks) * 100);
      onProgress?.(pct);

      // Backpressure guard
      const dc = (this.activeConn as any).dataChannel as RTCDataChannel | undefined;
      if (dc && dc.bufferedAmount > 256 * 1024) {
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    }

    // Step 3: Send completion
    this.activeConn.send({ type: 'transfer-end', transferId });
    onProgress?.(100);
  }

  public sendUrl(url: string): void {
    if (!this.activeConn || !this.activeConn.open) {
      throw new Error('Not connected to primary device');
    }
    this.activeConn.send({ type: 'transfer-url', url });
  }

  private handleIncomingData(data: any, _conn: DataConnection): void {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'tunnel-hello') {
      const dev: DeviceInfo = {
        name: data.name || 'External Device',
        isMobile: !!data.isMobile,
        platform: data.platform || 'Unknown'
      };
      this.setStatus('connected', dev);
      return;
    }

    if (data.type === 'transfer-url') {
      if (typeof data.url === 'string' && data.url.trim()) {
        for (const cb of this.onUrlReceivedCallbacks) {
          try { cb(data.url.trim()); } catch (e) { console.warn('[Tunnel] URL callback error:', e); }
        }
      }
      return;
    }

    if (data.type === 'transfer-start') {
      this.inFlightTransferMeta = data.meta;
      this.receivedChunks.clear();
      this.setStatus('transferring');
      for (const cb of this.onProgressCallbacks) {
        cb(0, data.meta.name);
      }
      return;
    }

    if (data.type === 'transfer-chunk') {
      if (!this.inFlightTransferMeta || this.inFlightTransferMeta.transferId !== data.transferId) return;

      this.receivedChunks.set(data.index, data.data);
      const pct = Math.round((this.receivedChunks.size / this.inFlightTransferMeta.totalChunks) * 100);
      for (const cb of this.onProgressCallbacks) {
        cb(pct, this.inFlightTransferMeta.name);
      }
      return;
    }

    if (data.type === 'transfer-end') {
      if (!this.inFlightTransferMeta || this.inFlightTransferMeta.transferId !== data.transferId) return;

      const meta = this.inFlightTransferMeta;
      const chunks: ArrayBuffer[] = [];
      for (let i = 0; i < meta.totalChunks; i++) {
        const chunk = this.receivedChunks.get(i);
        if (chunk) chunks.push(chunk);
      }

      this.receivedChunks.clear();
      this.inFlightTransferMeta = null;
      this.setStatus('connected');

      const blob = new Blob(chunks, { type: meta.type });
      const reconstructedFile = new File([blob], meta.name, { type: meta.type });

      for (const cb of this.onFileReceivedCallbacks) {
        try { cb(reconstructedFile); } catch (e) { console.warn('[Tunnel] File callback error:', e); }
      }
    }
  }

  public disconnect(): void {
    if (this.activeConn) {
      try { this.activeConn.close(); } catch { /* noop */ }
      this.activeConn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch { /* noop */ }
      this.peer = null;
    }
    this.role = null;
    this.pairCode = '';
    this.companionDevice = null;
    this.inFlightTransferMeta = null;
    this.receivedChunks.clear();
    this.setStatus('idle', null);
  }
}
