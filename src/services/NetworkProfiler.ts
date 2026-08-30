/**
 * NetworkProfiler — per-envelope-type byte counters and frame rate tracking.
 * Inspired by BasisVR's BasisNetworkProfiler with 20+ counter categories.
 *
 * Usage:
 *   NetworkProfiler.recordSend('spawn', jsonSize);
 *   NetworkProfiler.recordReceive('av', jsonSize);
 *   const stats = NetworkProfiler.getStats();
 */

type EnvelopeCategory =
  | 'trans' | 'av' | 'spawn' | 'rem' | 'chat'
  | 'syncreq' | 'syncresp' | 'role' | 'mod' | 'hs' | 'peerlist'
  | 'pending' | 'pendingcancel' | 'chunk' | 'vidstate' | 'audiostate'
  | 'panelstate' | 'mat' | 'p2preq' | 'p2pchunk' | 'inspector'
  | 'leave' | 'ping' | 'av_vrm'
  | 'other';

interface CategoryStats {
  sendBytes: number;
  recvBytes: number;
  sendCount: number;
  recvCount: number;
}

export class NetworkProfiler {
  private static categories: Map<EnvelopeCategory, CategoryStats> = new Map();
  private static totalSendBytes = 0;
  private static totalRecvBytes = 0;
  private static totalSendCount = 0;
  private static totalRecvCount = 0;

  // Frame rate tracking
  private static frameTimes: number[] = [];
  private static lastFrameTime = 0;
  private static fps = 0;

  // Per-second throughput tracking
  private static sendBytesThisSecond = 0;
  private static recvBytesThisSecond = 0;
  private static sendBytesPerSecond = 0;
  private static recvBytesPerSecond = 0;
  private static lastThroughputCheck = 0;

  private static ensureCategory(cat: EnvelopeCategory): CategoryStats {
    let stats = this.categories.get(cat);
    if (!stats) {
      stats = { sendBytes: 0, recvBytes: 0, sendCount: 0, recvCount: 0 };
      this.categories.set(cat, stats);
    }
    return stats;
  }

  /** Record an outbound envelope. */
  static recordSend(type: string, bytes: number): void {
    const cat = this.categorize(type);
    const stats = this.ensureCategory(cat);
    stats.sendBytes += bytes;
    stats.sendCount++;
    this.totalSendBytes += bytes;
    this.totalSendCount++;
    this.sendBytesThisSecond += bytes;
  }

  /** Record an inbound envelope. */
  static recordReceive(type: string, bytes: number): void {
    const cat = this.categorize(type);
    const stats = this.ensureCategory(cat);
    stats.recvBytes += bytes;
    stats.recvCount++;
    this.totalRecvBytes += bytes;
    this.totalRecvCount++;
    this.recvBytesThisSecond += bytes;
  }

  /** Call once per frame to track FPS and throughput. */
  static tick(): void {
    const now = performance.now();

    // FPS tracking
    if (this.lastFrameTime > 0) {
      const delta = now - this.lastFrameTime;
      this.frameTimes.push(delta);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
      if (this.frameTimes.length > 0) {
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        this.fps = Math.round(1000 / avg);
      }
    }
    this.lastFrameTime = now;

    // Throughput tracking (every second)
    if (now - this.lastThroughputCheck >= 1000) {
      this.sendBytesPerSecond = this.sendBytesThisSecond;
      this.recvBytesPerSecond = this.recvBytesThisSecond;
      this.sendBytesThisSecond = 0;
      this.recvBytesThisSecond = 0;
      this.lastThroughputCheck = now;
    }
  }

  private static categorize(type: string): EnvelopeCategory {
    const valid: EnvelopeCategory[] = [
      'trans', 'av', 'spawn', 'rem', 'chat', 'syncreq', 'syncresp',
      'role', 'mod', 'hs', 'peerlist', 'pending', 'pendingcancel',
      'chunk', 'vidstate', 'audiostate', 'panelstate', 'mat', 'p2preq',
      'p2pchunk', 'inspector', 'leave', 'ping', 'av_vrm'
    ];
    if (valid.includes(type as EnvelopeCategory)) return type as EnvelopeCategory;
    return 'other';
  }

  /** Get full profiling snapshot. */
  static getStats() {
    const perCategory: Record<string, CategoryStats> = {};
    for (const [cat, stats] of this.categories) {
      perCategory[cat] = { ...stats };
    }

    return {
      fps: this.fps,
      totalSendBytes: this.totalSendBytes,
      totalRecvBytes: this.totalRecvBytes,
      totalSendCount: this.totalSendCount,
      totalRecvCount: this.totalRecvCount,
      sendBytesPerSecond: this.sendBytesPerSecond,
      recvBytesPerSecond: this.recvBytesPerSecond,
      perCategory,
    };
  }

  /** Format bytes as human-readable string. */
  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /** Reset all counters (e.g. on reconnect). */
  static reset(): void {
    this.categories.clear();
    this.totalSendBytes = 0;
    this.totalRecvBytes = 0;
    this.totalSendCount = 0;
    this.totalRecvCount = 0;
    this.sendBytesThisSecond = 0;
    this.recvBytesThisSecond = 0;
    this.sendBytesPerSecond = 0;
    this.recvBytesPerSecond = 0;
    this.frameTimes = [];
  }
}
