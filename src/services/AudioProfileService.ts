/**
 * AudioProfileService — per-peer volume controls and talk modes.
 * Inspired by BasisVR's BasisTalkModeManager and per-player volume system.
 *
 * Features:
 * - Per-peer volume (0.0 - 1.0)
 * - Per-peer mute (personal block list)
 * - Talk modes: proximity, whisper, shout
 * - Volume persistence in localStorage
 */

export type TalkMode = 'proximity' | 'whisper' | 'shout';

interface PeerAudioProfile {
  volume: number;
  muted: boolean;
  talkMode: TalkMode;
  isSpeaking: boolean;
  lastVoiceTimestamp: number;
}

const STORAGE_KEY = 'nexus_audio_profiles';
const DEFAULT_VOLUME = 1.0;

export class AudioProfileService {
  private static profiles: Map<string, PeerAudioProfile> = new Map();
  private static localTalkMode: TalkMode = 'proximity';
  private static localMuted = false;
  private static localDeafened = false;

  /** Initialize: load persisted profiles. */
  static init(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, PeerAudioProfile>;
        for (const [peerId, profile] of Object.entries(parsed)) {
          this.profiles.set(peerId, profile);
        }
      }
    } catch { /* localStorage unavailable */ }
  }

  // ─── Per-Peer Volume ──────────────────────────────────────────────────

  /** Get volume for a specific peer (0.0 - 1.0). */
  static getVolume(peerId: string): number {
    return this.profiles.get(peerId)?.volume ?? DEFAULT_VOLUME;
  }

  /** Set volume for a specific peer. */
  static setVolume(peerId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    const profile = this.getOrCreate(peerId);
    profile.volume = clamped;
    this.persist();
  }

  /** Mute a specific peer (personal block list). */
  static mutePeer(peerId: string): void {
    const profile = this.getOrCreate(peerId);
    profile.muted = true;
    this.persist();
  }

  /** Unmute a specific peer. */
  static unmutePeer(peerId: string): void {
    const profile = this.getOrCreate(peerId);
    profile.muted = false;
    this.persist();
  }

  /** Check if a peer is muted. */
  static isPeerMuted(peerId: string): boolean {
    return this.profiles.get(peerId)?.muted ?? false;
  }

  /** Get the effective volume for a peer (considers local deafened + peer mute). */
  static getEffectiveVolume(peerId: string): number {
    if (this.localDeafened) return 0;
    if (this.isPeerMuted(peerId)) return 0;
    return this.getVolume(peerId);
  }

  // ─── Talk Modes ───────────────────────────────────────────────────────

  /** Get the local player's talk mode. */
  static getLocalTalkMode(): TalkMode {
    return this.localTalkMode;
  }

  /** Set the local player's talk mode. */
  static setLocalTalkMode(mode: TalkMode): void {
    this.localTalkMode = mode;
  }

  /** Check if the local player can shout (admin permission required). */
  static canLocalShout(): boolean {
    // This would check IdentityService.hasNode('basis.moderation.shout')
    // For now, only proximity and whisper are available to all users
    return false;
  }

  // ─── Local Mute/Deafen ────────────────────────────────────────────────

  /** Mute local microphone. */
  static muteLocal(): void {
    this.localMuted = true;
  }

  /** Unmute local microphone. */
  static unmuteLocal(): void {
    this.localMuted = false;
  }

  /** Check if local microphone is muted. */
  static isLocalMuted(): boolean {
    return this.localMuted;
  }

  /** Deafen local player (mute all incoming audio). */
  static deafenLocal(): void {
    this.localDeafened = true;
  }

  /** Undeafen local player. */
  static undeafenLocal(): void {
    this.localDeafened = false;
  }

  /** Check if local player is deafened. */
  static isLocalDeafened(): boolean {
    return this.localDeafened;
  }

  // ─── Speaking Detection ───────────────────────────────────────────────

  /** Mark a peer as speaking (called from voice activity detection). */
  static setPeerSpeaking(peerId: string, speaking: boolean): void {
    const profile = this.getOrCreate(peerId);
    profile.isSpeaking = speaking;
    if (speaking) profile.lastVoiceTimestamp = Date.now();
  }

  /** Check if a peer is currently speaking. */
  static isPeerSpeaking(peerId: string): boolean {
    const profile = this.profiles.get(peerId);
    if (!profile) return false;
    // Consider speaking stopped if no voice activity for 500ms
    return profile.isSpeaking && (Date.now() - profile.lastVoiceTimestamp < 500);
  }

  // ─── Serialization ────────────────────────────────────────────────────

  /** Get volume state for a peer (for sending to peers). */
  static getStateForPeer(peerId: string): {
    volume: number;
    muted: boolean;
    talkMode: TalkMode;
  } {
    const profile = this.profiles.get(peerId);
    return {
      volume: profile?.volume ?? DEFAULT_VOLUME,
      muted: profile?.muted ?? false,
      talkMode: profile?.talkMode ?? 'proximity',
    };
  }

  /** Get all profiles (for scene sync). */
  static getAllProfiles(): Map<string, PeerAudioProfile> {
    return new Map(this.profiles);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private static getOrCreate(peerId: string): PeerAudioProfile {
    let profile = this.profiles.get(peerId);
    if (!profile) {
      profile = {
        volume: DEFAULT_VOLUME,
        muted: false,
        talkMode: 'proximity',
        isSpeaking: false,
        lastVoiceTimestamp: 0,
      };
      this.profiles.set(peerId, profile);
    }
    return profile;
  }

  private static persist(): void {
    try {
      const obj: Record<string, PeerAudioProfile> = {};
      for (const [k, v] of this.profiles) obj[k] = v;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch { /* localStorage unavailable */ }
  }

  /** Reset everything (on disconnect). */
  static reset(): void {
    this.profiles.clear();
    this.localTalkMode = 'proximity';
    this.localMuted = false;
    this.localDeafened = false;
  }
}
