/**
 * NetworkStatsOverlay — visual debug panel showing network stats.
 * Toggleable with Ctrl+Shift+N hotkey.
 *
 * Shows:
 * - FPS
 * - Send/recv bytes per second
 * - Avatar encode/suppress stats
 * - Compression ratio
 * - Connected peers
 */

import React, { useEffect, useState, useCallback } from 'react';
import { NetworkProfiler } from '../services/NetworkProfiler.ts';
import { CompressionService } from '../services/CompressionService.ts';
import { AvatarCodecStats } from '../services/AvatarCodec.ts';

interface Props {
  visible: boolean;
  onToggle: () => void;
  peerCount: number;
  isHost: boolean;
}

export const NetworkStatsOverlay: React.FC<Props> = ({ visible, onToggle, peerCount, isHost }) => {
  const [stats, setStats] = useState(() => NetworkProfiler.getStats());
  const [avatarStats, setAvatarStats] = useState(() => AvatarCodecStats.getStats());
  const [compressionStats, setCompressionStats] = useState(() => CompressionService.getStats());

  // Poll stats every 500ms
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      NetworkProfiler.tick();
      setStats(NetworkProfiler.getStats());
      setAvatarStats(AvatarCodecStats.getStats());
      setCompressionStats(CompressionService.getStats());
    }, 500);
    return () => clearInterval(interval);
  }, [visible]);

  // Hotkey: Ctrl+Shift+N
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggle]);

  if (!visible) return null;

  const formatBytes = NetworkProfiler.formatBytes;
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div style={{
      position: 'fixed',
      top: 8,
      right: 8,
      zIndex: 10000,
      background: 'rgba(0, 0, 0, 0.85)',
      color: '#00ff88',
      fontFamily: 'monospace',
      fontSize: 11,
      padding: '10px 14px',
      borderRadius: 6,
      minWidth: 280,
      pointerEvents: 'auto',
      boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
      border: '1px solid rgba(0, 255, 136, 0.2)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#00ffaa', fontWeight: 'bold', fontSize: 12 }}>
          📊 Network Stats
        </span>
        <span style={{ color: '#666', fontSize: 10 }}>
          Ctrl+Shift+N to toggle
        </span>
      </div>

      {/* FPS + Connection */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 4 }}>
        <span>FPS: <b style={{ color: stats.fps > 50 ? '#00ff88' : stats.fps > 30 ? '#ffaa00' : '#ff4444' }}>{stats.fps}</b></span>
        <span>Peers: <b style={{ color: '#88aaff' }}>{peerCount}</b></span>
        <span style={{ color: isHost ? '#ffaa00' : '#888' }}>
          {isHost ? '👑 HOST' : '👤 GUEST'}
        </span>
      </div>

      {/* Throughput */}
      <div style={{ borderTop: '1px solid rgba(0,255,136,0.15)', paddingTop: 4, marginTop: 4 }}>
        <div style={{ color: '#aaa', marginBottom: 2 }}>Throughput</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <span>↑ {formatBytes(stats.sendBytesPerSecond)}/s</span>
          <span>↓ {formatBytes(stats.recvBytesPerSecond)}/s</span>
        </div>
        <div style={{ display: 'flex', gap: 16, color: '#888' }}>
          <span>Total ↑ {formatBytes(stats.totalSendBytes)}</span>
          <span>Total ↓ {formatBytes(stats.totalRecvBytes)}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, color: '#888' }}>
          <span>Msgs ↑ {fmt(stats.totalSendCount)}</span>
          <span>Msgs ↓ {fmt(stats.totalRecvCount)}</span>
        </div>
      </div>

      {/* Avatar Stats */}
      <div style={{ borderTop: '1px solid rgba(0,255,136,0.15)', paddingTop: 4, marginTop: 4 }}>
        <div style={{ color: '#aaa', marginBottom: 2 }}>Avatar Codec</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <span>Encoded: <b>{fmt(avatarStats.framesEncoded)}</b></span>
          <span>Suppressed: <b style={{ color: '#ffaa00' }}>{fmt(avatarStats.framesSuppressed)}</b></span>
        </div>
        <div>
          Suppression rate: <b style={{ color: '#00ffaa' }}>{avatarStats.suppressionRate}</b>
        </div>
        <div style={{ color: '#888' }}>
          Bytes: {formatBytes(avatarStats.bytesEncoded)} encoded / {formatBytes(avatarStats.bytesDecoded)} decoded
        </div>
      </div>

      {/* Compression Stats */}
      <div style={{ borderTop: '1px solid rgba(0,255,136,0.15)', paddingTop: 4, marginTop: 4 }}>
        <div style={{ color: '#aaa', marginBottom: 2 }}>Compression</div>
        <div>
          Ratio: <b style={{ color: compressionStats.compressionRatio > 10 ? '#00ffaa' : '#888' }}>
            {compressionStats.compressionRatio.toFixed(1)}%
          </b>
          <span style={{ color: '#888', marginLeft: 8 }}>
            ({fmt(compressionStats.compressionsPerformed)} ops)
          </span>
        </div>
      </div>

      {/* Top Envelope Types by Volume */}
      {Object.keys(stats.perCategory).length > 0 && (
        <div style={{ borderTop: '1px solid rgba(0,255,136,0.15)', paddingTop: 4, marginTop: 4 }}>
          <div style={{ color: '#aaa', marginBottom: 2 }}>Top Channels</div>
          {Object.entries(stats.perCategory)
            .sort(([, a], [, b]) => (b.sendBytes + b.recvBytes) - (a.sendBytes + a.recvBytes))
            .slice(0, 5)
            .map(([cat, s]) => (
              <div key={cat} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#88aaff' }}>{cat}</span>
                <span>↑{formatBytes(s.sendBytes)} ↓{formatBytes(s.recvBytes)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
