/**
 * ChannelRegistry — channel-based message dispatch for NetworkService.
 * Inspired by BasisVR's BasisNetworkEvents with ~30+ predefined channels
 * and a plugin channel system for third-party extensions.
 *
 * Every message type maps to a numeric channel. The receiver looks up
 * the channel handler and dispatches without a large switch statement.
 * Third-party code can register additional channels via the plugin API.
 */

type ChannelHandler = (fromPeerId: string, payload: unknown, deliveryReliable: boolean) => void;

/**
 * Predefined channel IDs. Matches BasisVR's BasisNetworkCommons pattern
 * of numbered constants for each message type.
 */
export const Channel = Object.freeze({
  Transform: 1,
  Avatar: 2,
  AvatarVRM: 3,
  Spawn: 4,
  Remove: 5,
  Chat: 6,
  SyncRequest: 7,
  SyncResponse: 8,
  Role: 10,
  Moderation: 11,
  Handshake: 20,
  PeerList: 21,
  Leave: 22,
  Ping: 23,
  Pending: 30,
  PendingCancel: 31,
  Chunk: 32,
  VideoState: 40,
  AudioState: 41,
  PanelState: 50,
  Material: 60,
  Inspector: 61,
  P2PRequest: 70,
  P2PChunk: 71,
  OwnershipRequest: 80,
  OwnershipTransfer: 81,
  OwnershipRemove: 82,
  Identity: 90,
  PermissionSnapshot: 91,
  GlobalLock: 92,
  VolumeState: 100,
  TalkMode: 101,
  PluginStart: 200,
} as const);

/**
 * Maps envelope type strings to channel IDs.
 * This is the bridge between the existing string-based system
 * and the new numeric channel system.
 */
const TYPE_TO_CHANNEL: Record<string, number> = {
  'trans': Channel.Transform,
  'av': Channel.Avatar,
  'av_vrm': Channel.AvatarVRM,
  'spawn': Channel.Spawn,
  'rem': Channel.Remove,
  'chat': Channel.Chat,
  'syncreq': Channel.SyncRequest,
  'syncresp': Channel.SyncResponse,
  'role': Channel.Role,
  'mod': Channel.Moderation,
  'hs': Channel.Handshake,
  'peerlist': Channel.PeerList,
  'leave': Channel.Leave,
  'ping': Channel.Ping,
  'pending': Channel.Pending,
  'pendingcancel': Channel.PendingCancel,
  'chunk': Channel.Chunk,
  'vidstate': Channel.VideoState,
  'audiostate': Channel.AudioState,
  'panelstate': Channel.PanelState,
  'mat': Channel.Material,
  'inspector': Channel.Inspector,
  'p2preq': Channel.P2PRequest,
  'p2pchunk': Channel.P2PChunk,
};

/**
 * Reverse map: channel ID to type string (for serialization).
 */
const CHANNEL_TO_TYPE: Record<number, string> = {};
for (const [type, channel] of Object.entries(TYPE_TO_CHANNEL)) {
  CHANNEL_TO_TYPE[channel] = type;
}

/**
 * ChannelRegistry — central message dispatch.
 */
export class ChannelRegistry {
  private static handlers: Map<number, Set<ChannelHandler>> = new Map();
  private static pluginHandlers: Map<number, Set<ChannelHandler>> = new Map();
  private static nextPluginChannel = Channel.PluginStart;

  /**
   * Register a handler for a predefined channel.
   * Returns an unsubscribe function.
   */
  static on(channel: number, handler: ChannelHandler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /**
   * Register a handler for a plugin channel (auto-assigned ID).
   * Returns the channel ID and an unsubscribe function.
   */
  static registerPlugin(_name: string, handler: ChannelHandler): { channelId: number; unsubscribe: () => void } {
    const channelId = this.nextPluginChannel++;
    let set = this.pluginHandlers.get(channelId);
    if (!set) {
      set = new Set();
      this.pluginHandlers.set(channelId, set);
    }
    set.add(handler);
    return {
      channelId,
      unsubscribe: () => set!.delete(handler),
    };
  }

  /**
   * Dispatch a message to all registered handlers for its channel.
   * Called by NetworkService after parsing the envelope.
   */
  static dispatch(type: string, fromPeerId: string, payload: unknown, deliveryReliable: boolean = true): void {
    const channel = TYPE_TO_CHANNEL[type];
    if (channel !== undefined) {
      const handlers = this.handlers.get(channel);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(fromPeerId, payload, deliveryReliable);
          } catch (err) {
            console.warn(`[ChannelRegistry] handler threw for channel ${channel} (${type}) from ${fromPeerId}:`, err);
          }
        }
      }
    }
  }

  /**
   * Dispatch a message on a specific numeric channel (for plugins).
   */
  static dispatchOnChannel(channelId: number, fromPeerId: string, payload: unknown, deliveryReliable: boolean = true): void {
    const handlers = this.pluginHandlers.get(channelId);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(fromPeerId, payload, deliveryReliable);
        } catch (err) {
          console.warn(`[ChannelRegistry] plugin handler threw for channel ${channelId} from ${fromPeerId}:`, err);
        }
      }
    }
  }

  /**
   * Resolve a type string to its channel ID.
   */
  static getChannel(type: string): number | undefined {
    return TYPE_TO_CHANNEL[type];
  }

  /**
   * Resolve a channel ID to its type string.
   */
  static getType(channel: number): string | undefined {
    return CHANNEL_TO_TYPE[channel];
  }

  /**
   * Check if a channel is a realtime (high-frequency) channel.
   * These should use unreliable delivery.
   */
  static isRealtime(channel: number): boolean {
    return channel === Channel.Transform || channel === Channel.Avatar || channel === Channel.Ping;
  }

  /**
   * Clear all handlers (on disconnect).
   */
  static reset(): void {
    this.handlers.clear();
    this.pluginHandlers.clear();
    this.nextPluginChannel = Channel.PluginStart;
  }
}
