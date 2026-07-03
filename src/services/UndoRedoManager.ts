/**
 * Serialized snapshot of an object's transform state, captured before an
 * action so it can be restored on undo.
 */
export interface TransformSnapshot {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/**
 * Full serialized data for a deleted/spawned asset, so undo can restore it.
 */
export interface AssetSnapshot {
  id: string;
  name: string;
  type: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  url?: string;
  fileData?: ArrayBuffer;
  primitiveType?: string;
  isCollidable: boolean;
}

/** A single undoable action with symmetric undo/redo operations. */
interface UndoAction {
  /** Human-readable label (e.g. "Move Cube") for debugging / UI. */
  label: string;
  /** Reverse the action. */
  undo: () => void;
  /** Re-apply the action. */
  redo: () => void;
}

export class UndoRedoManager {
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private maxHistory = 100;

  private onChangeCallbacks: Set<() => void> = new Set();

  public onChange(cb: () => void): () => void {
    this.onChangeCallbacks.add(cb);
    return () => this.onChangeCallbacks.delete(cb);
  }

  private notify(): void {
    for (const cb of this.onChangeCallbacks) cb();
  }

  /** Push a new action onto the undo stack and clear the redo stack. */
  public push(action: UndoAction): void {
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.notify();
  }

  /** Undo the most recent action. */
  public undo(): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;
    action.undo();
    this.redoStack.push(action);
    this.notify();
    return true;
  }

  /** Redo the most recently undone action. */
  public redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;
    action.redo();
    this.undoStack.push(action);
    this.notify();
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify();
  }

  // ---- Convenience factories ----

  /** Record a transform change (position / rotation / scale). */
  public recordTransform(
    assetId: string,
    label: string,
    before: TransformSnapshot,
    after: TransformSnapshot,
    applyTransform: (assetId: string, snap: TransformSnapshot) => void
  ): void {
    this.push({
      label,
      undo: () => applyTransform(assetId, before),
      redo: () => applyTransform(assetId, after),
    });
  }


}
