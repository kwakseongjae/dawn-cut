import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, initHistory, pushHistory, redoHistory, undoHistory } from './history.js';

describe('history (undo/redo)', () => {
  it('init has no undo/redo', () => {
    const h = initHistory('a');
    expect(h.present).toBe('a');
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('push then undo restores previous, redo re-applies', () => {
    let h = initHistory('a');
    h = pushHistory(h, 'b');
    expect(h.present).toBe('b');
    expect(canUndo(h)).toBe(true);

    h = undoHistory(h);
    expect(h.present).toBe('a');
    expect(canRedo(h)).toBe(true);

    h = redoHistory(h);
    expect(h.present).toBe('b');
  });

  it('push clears the redo stack', () => {
    let h = initHistory('a');
    h = pushHistory(h, 'b');
    h = undoHistory(h); // present a, future [b]
    h = pushHistory(h, 'c'); // committing c clears redo
    expect(h.present).toBe('c');
    expect(canRedo(h)).toBe(false);
  });

  it('undo/redo at the boundary is a no-op', () => {
    const h = initHistory('a');
    expect(undoHistory(h)).toEqual(h);
    expect(redoHistory(h)).toEqual(h);
  });

  it('handles a multi-step sequence', () => {
    let h = initHistory(0);
    for (const v of [1, 2, 3]) h = pushHistory(h, v);
    expect(h.present).toBe(3);
    h = undoHistory(undoHistory(h)); // → 1
    expect(h.present).toBe(1);
    h = redoHistory(h); // → 2
    expect(h.present).toBe(2);
  });
});
