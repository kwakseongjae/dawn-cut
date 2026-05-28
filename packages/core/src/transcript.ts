import type { TranscriptModel, Word } from './types.js';

/**
 * Build a normalized TranscriptModel from raw words (e.g. from STT).
 * Words are ordered by sourceStart (stable). Enforces 04 §1 contracts.
 */
export function buildTranscriptModel(
  rawWords: Word[],
  mediaId: string,
  language: string,
): TranscriptModel {
  const sorted = [...rawWords].sort((a, b) => a.sourceStart - b.sourceStart);
  const words: Record<string, Word> = {};
  const order: string[] = [];
  for (const w of sorted) {
    words[w.id] = w;
    order.push(w.id);
  }
  const model: TranscriptModel = {
    schemaVersion: 1,
    mediaId,
    language,
    words,
    order,
    segments: order.length ? [{ id: `${mediaId}:seg0`, words: [...order] }] : [],
  };
  return model;
}

/** Returns a list of T-INV violations ([] == valid). */
export function validateTranscript(m: TranscriptModel): string[] {
  const errors: string[] = [];
  const keys = Object.keys(m.words);

  // T-INV-1: order ↔ words bijection
  if (order_has_dupes(m.order)) errors.push('T-INV-1: order has duplicate ids');
  for (const id of m.order)
    if (!(id in m.words)) errors.push(`T-INV-1: order id ${id} missing in words`);
  for (const k of keys)
    if (!m.order.includes(k)) errors.push(`T-INV-1: word ${k} missing in order`);
  if (m.order.length !== keys.length) errors.push('T-INV-1: order/words length mismatch');

  // T-INV-2: sourceStart non-decreasing in order
  for (let i = 1; i < m.order.length; i++) {
    const prev = m.words[m.order[i - 1]!];
    const cur = m.words[m.order[i]!];
    if (prev && cur && cur.sourceStart < prev.sourceStart) {
      errors.push(`T-INV-2: sourceStart decreases at index ${i}`);
    }
  }

  // T-INV-3 + T-INV-4
  for (const id of m.order) {
    const w = m.words[id]!;
    if (w.sourceEnd <= w.sourceStart) errors.push(`T-INV-3: word ${id} has sourceEnd<=sourceStart`);
    if (w.text.trim() === '') errors.push(`T-INV-4: word ${id} has empty text`);
  }

  return errors;
}

function order_has_dupes(order: string[]): boolean {
  return new Set(order).size !== order.length;
}
