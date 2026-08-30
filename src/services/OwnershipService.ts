/**
 * OwnershipService — object ownership tracking for multiplayer props.
 * Inspired by BasisVR's BasisNetworkOwnership with async request/response,
 * local validation, and transfer messages.
 *
 * Key features:
 * - Every networked object has an owner (peer ID)
 * - Ownership can be requested, transferred, or released
 * - Fast local validation without round-trip
 * - Ownership transfer messages sent to all peers
 */

export interface OwnershipEntry {
  /** Network ID of the owned object. */
  objectId: string;
  /** Peer ID of the current owner. */
  ownerId: string;
  /** Timestamp when ownership was last transferred. */
  lastTransferTime: number;
}

export type OwnershipCallback = (
  objectId: string,
  newOwnerId: string,
  isLocalOwner: boolean,
) => void;

/**
 * OwnershipService — manages who owns what in the shared scene.
 */
export class OwnershipService {
  // objectId → ownerId
  private static ownershipMap: Map<string, string> = new Map();
  // Pending ownership requests awaiting server/peer confirmation
  private static pendingRequests: Map<string, {
    resolve: (result: OwnershipResult) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  // Callbacks
  private static onTransferCallbacks: Set<OwnershipCallback> = new Set();
  // Local peer ID
  private static localPeerId: string = '';

  /** Initialize with the local peer ID. */
  static init(localPeerId: string): void {
    this.localPeerId = localPeerId;
  }

  // ─── Ownership Queries ──────────────────────────────────────────────────

  /**
   * Fast local validation: is the local peer the owner of this object?
   */
  static isLocalOwner(objectId: string): boolean {
    const owner = this.ownershipMap.get(objectId);
    return owner === this.localPeerId;
  }

  /**
   * Get the owner of an object.
   */
  static getOwner(objectId: string): string | null {
    return this.ownershipMap.get(objectId) ?? null;
  }

  /**
   * Get all objects owned by a specific peer.
   */
  static getObjectsOwnedBy(peerId: string): string[] {
    const result: string[] = [];
    for (const [objectId, ownerId] of this.ownershipMap) {
      if (ownerId === peerId) result.push(objectId);
    }
    return result;
  }

  /**
   * Get all objects owned by the local peer.
   */
  static getLocallyOwned(): string[] {
    return this.getObjectsOwnedBy(this.localPeerId);
  }

  // ─── Ownership Transfers ────────────────────────────────────────────────

  /**
   * Take ownership of an object (local claim).
   * Returns immediately with the new owner.
   */
  static takeOwnership(objectId: string): OwnershipResult {
    const prev = this.ownershipMap.get(objectId);
    this.ownershipMap.set(objectId, this.localPeerId);
    this.notifyTransfer(objectId, this.localPeerId, true);
    return { success: true, ownerId: this.localPeerId, previousOwnerId: prev ?? null };
  }

  /**
   * Release ownership of an object (no owner → anyone can take).
   */
  static releaseOwnership(objectId: string): void {
    this.ownershipMap.delete(objectId);
  }

  /**
   * Request ownership from the current owner (async with timeout).
   * Returns a promise that resolves when the transfer is confirmed or times out.
   */
  static requestOwnership(objectId: string, timeoutMs = 5000): Promise<OwnershipResult> {
    return new Promise((resolve) => {
      // If no one owns it, we can take it immediately
      if (!this.ownershipMap.has(objectId)) {
        const result = this.takeOwnership(objectId);
        resolve(result);
        return;
      }

      // If we already own it, resolve immediately
      if (this.isLocalOwner(objectId)) {
        resolve({ success: true, ownerId: this.localPeerId, previousOwnerId: this.localPeerId });
        return;
      }

      // Cancel any existing pending request for this object
      const existing = this.pendingRequests.get(objectId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve({ success: false, ownerId: this.getOwner(objectId) ?? '', previousOwnerId: null });
      }

      // Create new pending request with timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(objectId);
        resolve({ success: false, ownerId: this.getOwner(objectId) ?? '', previousOwnerId: null });
      }, timeoutMs);

      this.pendingRequests.set(objectId, { resolve, timer });
    });
  }

  // ─── Incoming Transfers ─────────────────────────────────────────────────

  /**
   * Handle an incoming ownership transfer from a peer.
   */
  static handleTransfer(objectId: string, newOwnerId: string): void {
    const prev = this.ownershipMap.get(objectId);
    this.ownershipMap.set(objectId, newOwnerId);

    // Resolve any pending request if this matches
    const pending = this.pendingRequests.get(objectId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(objectId);
      const isLocal = newOwnerId === this.localPeerId;
      pending.resolve({ success: isLocal, ownerId: newOwnerId, previousOwnerId: prev ?? null });
    }

    this.notifyTransfer(objectId, newOwnerId, newOwnerId === this.localPeerId);
  }

  /**
   * Handle an ownership removal (object becomes unowned).
   */
  static handleRemoval(objectId: string): void {
    this.ownershipMap.delete(objectId);
  }

  // ─── Callbacks ──────────────────────────────────────────────────────────

  /** Register a callback for ownership transfers. */
  static onTransfer(cb: OwnershipCallback): () => void {
    this.onTransferCallbacks.add(cb);
    return () => this.onTransferCallbacks.delete(cb);
  }

  private static notifyTransfer(objectId: string, newOwnerId: string, isLocalOwner: boolean): void {
    for (const cb of this.onTransferCallbacks) {
      try { cb(objectId, newOwnerId, isLocalOwner); } catch (e) { console.warn('[OwnershipService] callback error:', e); }
    }
  }

  // ─── Serialization ──────────────────────────────────────────────────────

  /**
   * Get the full ownership state for scene sync (late joiners).
   */
  static getState(): Map<string, string> {
    return new Map(this.ownershipMap);
  }

  /**
   * Set the full ownership state (from scene snapshot).
   */
  static setState(state: Map<string, string>): void {
    this.ownershipMap.clear();
    for (const [k, v] of state) this.ownershipMap.set(k, v);
  }

  /**
   * Reset everything (on disconnect).
   */
  static reset(): void {
    this.ownershipMap.clear();
    for (const [, entry] of this.pendingRequests) {
      clearTimeout(entry.timer);
      entry.resolve({ success: false, ownerId: '', previousOwnerId: null });
    }
    this.pendingRequests.clear();
    this.onTransferCallbacks.clear();
  }
}

export interface OwnershipResult {
  success: boolean;
  ownerId: string;
  previousOwnerId: string | null;
}
