/**
 * Generic undo/redo history (pure, immutable). The store uses this with
 * TimelineModel snapshots; kept in core so the logic is unit-tested.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Commit a new present; clears the redo stack. */
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  return { past: [...h.past, h.present], present: next, future: [] };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1]!;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const next = h.future[0]!;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
