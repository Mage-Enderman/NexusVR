/**
 * CompressionService — fflate-based compression for network payloads.
 * Inspired by BasisVR's LZ4/Deflate compression across data channels.
 *
 * Usage:
 *   const compressed = CompressionService.compress(jsonString);
 *   const decompressed = CompressionService.decompress(compressed);
 *
 * Compression is applied to spawn envelopes, scene snapshots, and other
 * large payloads that exceed a size threshold. Realtime transform/avatar
 * updates are NOT compressed (latency-sensitive, small payloads).
 */

import { strToU8, strFromU8, compressSync, decompressSync } from 'fflate';

/** Minimum payload size (bytes) before compression kicks in. */
const COMPRESS_THRESHOLD = 2048;

/** Compression level (0-9). 6 is a good balance of speed vs ratio. */
const LEVEL = 6;

export class CompressionService {
  private static bytesSentCompressed = 0;
  private static bytesSentUncompressed = 0;
  private static bytesReceivedCompressed = 0;
  private static bytesReceivedUncompressed = 0;
  private static compressionsPerformed = 0;
  private static decompressionsPerformed = 0;

  /**
   * Compress a JSON string if it exceeds the threshold.
   * Returns { data, compressed } where data is either the original string
   * or a Uint8Array of the compressed bytes, and compressed indicates which.
   */
  static compress(jsonStr: string): { data: string | Uint8Array; compressed: boolean } {
    const originalSize = jsonStr.length * 2; // rough UTF-16 byte estimate
    if (originalSize < COMPRESS_THRESHOLD) {
      this.bytesSentUncompressed += originalSize;
      return { data: jsonStr, compressed: false };
    }

    try {
      const input = strToU8(jsonStr);
      const compressed = compressSync(input, { level: LEVEL });
      const ratio = compressed.length / input.length;

      // Only use compression if it actually saves space (>10% reduction)
      if (ratio > 0.9) {
        this.bytesSentUncompressed += originalSize;
        return { data: jsonStr, compressed: false };
      }

      this.bytesSentCompressed += compressed.length;
      this.bytesSentUncompressed += originalSize;
      this.compressionsPerformed++;
      return { data: compressed, compressed: true };
    } catch (err) {
      console.warn('[CompressionService] compress failed:', err);
      this.bytesSentUncompressed += originalSize;
      return { data: jsonStr, compressed: false };
    }
  }

  /**
   * Decompress a payload that was compressed by compress().
   * If `compressed` flag is false, returns the original string as-is.
   */
  static decompress(data: string | Uint8Array, compressed: boolean): string {
    if (!compressed) {
      if (typeof data === 'string') {
        this.bytesReceivedUncompressed += data.length * 2;
        return data;
      }
      // Shouldn't happen, but handle gracefully
      return strFromU8(data as Uint8Array);
    }

    try {
      const input = data instanceof Uint8Array ? data : strToU8(data as string);
      const decompressed = decompressSync(input);
      const result = strFromU8(decompressed);
      this.bytesReceivedCompressed += input.length;
      this.bytesReceivedUncompressed += result.length * 2;
      this.decompressionsPerformed++;
      return result;
    } catch (err) {
      console.warn('[CompressionService] decompress failed:', err);
      if (typeof data === 'string') return data;
      return strFromU8(data as Uint8Array);
    }
  }

  /** Get compression statistics. */
  static getStats() {
    return {
      bytesSentCompressed: this.bytesSentCompressed,
      bytesSentUncompressed: this.bytesSentUncompressed,
      bytesReceivedCompressed: this.bytesReceivedCompressed,
      bytesReceivedUncompressed: this.bytesReceivedUncompressed,
      compressionsPerformed: this.compressionsPerformed,
      decompressionsPerformed: this.decompressionsPerformed,
      compressionRatio: this.bytesSentUncompressed > 0
        ? (1 - this.bytesSentCompressed / this.bytesSentUncompressed) * 100
        : 0,
    };
  }

  /** Reset statistics (e.g. on reconnect). */
  static resetStats(): void {
    this.bytesSentCompressed = 0;
    this.bytesSentUncompressed = 0;
    this.bytesReceivedCompressed = 0;
    this.bytesReceivedUncompressed = 0;
    this.compressionsPerformed = 0;
    this.decompressionsPerformed = 0;
  }
}
