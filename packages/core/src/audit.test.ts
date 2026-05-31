import { describe, expect, it } from 'vitest';
import { type AuditEntry, appendAudit, pureHash, verifyAudit } from './audit.js';

describe('audit (해시체인 감사 로그)', () => {
  describe('pureHash', () => {
    it('결정적: 같은 입력 → 같은 출력', () => {
      expect(pureHash('hello')).toBe(pureHash('hello'));
    });

    it('한 글자만 달라도 출력이 바뀐다', () => {
      expect(pureHash('hello')).not.toBe(pureHash('hellp'));
    });

    it('16진 문자열을 돌려준다', () => {
      expect(pureHash('dawn-cut')).toMatch(/^[0-9a-f]+$/);
    });

    it('빈 문자열도 결정적으로 해시한다', () => {
      expect(pureHash('')).toBe(pureHash(''));
      expect(typeof pureHash('')).toBe('string');
    });
  });

  describe('appendAudit', () => {
    it('빈 로그에 추가하면 seq=0, prevHash="" 인 항목 1개', () => {
      const log = appendAudit([], { verb: 'removeSilences' }, 1000);
      expect(log).toHaveLength(1);
      expect(log[0]!.seq).toBe(0);
      expect(log[0]!.prevHash).toBe('');
      expect(log[0]!.removedProgramUs).toBe(1000);
      expect(log[0]!.command).toEqual({ verb: 'removeSilences' });
      expect(log[0]!.hash).toMatch(/^[0-9a-f]+$/);
    });

    it('체인 연결: 각 항목 prevHash 가 직전 hash, seq 가 1씩 증가', () => {
      let log: AuditEntry[] = [];
      log = appendAudit(log, { verb: 'a' }, 100);
      log = appendAudit(log, { verb: 'b' }, 200);
      log = appendAudit(log, { verb: 'c' }, 0);

      expect(log).toHaveLength(3);
      expect(log.map((e) => e.seq)).toEqual([0, 1, 2]);
      expect(log[1]!.prevHash).toBe(log[0]!.hash);
      expect(log[2]!.prevHash).toBe(log[1]!.hash);
    });

    it('append-only: 원본 배열을 변형하지 않는다(불변)', () => {
      const log0: AuditEntry[] = [];
      const log1 = appendAudit(log0, { verb: 'a' }, 100);
      expect(log0).toHaveLength(0); // 원본 그대로
      expect(log1).toHaveLength(1);
      expect(log1).not.toBe(log0);
    });

    it('결정적: 동일 순서로 쌓으면 동일한 hash 사슬', () => {
      const buildA = appendAudit(appendAudit([], { verb: 'x' }, 1), { verb: 'y' }, 2);
      const buildB = appendAudit(appendAudit([], { verb: 'x' }, 1), { verb: 'y' }, 2);
      expect(buildA.map((e) => e.hash)).toEqual(buildB.map((e) => e.hash));
    });
  });

  describe('verifyAudit', () => {
    it('빈 로그는 true', () => {
      expect(verifyAudit([])).toBe(true);
    });

    it('appendAudit 로만 쌓은 로그는 true', () => {
      let log: AuditEntry[] = [];
      log = appendAudit(log, { verb: 'deleteWordRange', from: 1, to: 3 }, 500);
      log = appendAudit(log, { verb: 'removeFillers' }, 320);
      log = appendAudit(log, { verb: 'applyGlossary', pairs: [{ from: 'AI', to: '에이아이' }] }, 0);
      expect(verifyAudit(log)).toBe(true);
    });

    it('command 변조 시 false (hash 불일치)', () => {
      let log: AuditEntry[] = [];
      log = appendAudit(log, { verb: 'a' }, 100);
      log = appendAudit(log, { verb: 'b' }, 200);
      // 중간 항목의 command 만 바꾼다(hash 는 그대로 둠).
      const tampered = log.map((e, i) => (i === 0 ? { ...e, command: { verb: 'EVIL' } } : e));
      expect(verifyAudit(tampered)).toBe(false);
    });

    it('removedProgramUs 변조 시 false', () => {
      let log: AuditEntry[] = [];
      log = appendAudit(log, { verb: 'a' }, 100);
      log = appendAudit(log, { verb: 'b' }, 200);
      const tampered = log.map((e, i) => (i === 1 ? { ...e, removedProgramUs: 999 } : e));
      expect(verifyAudit(tampered)).toBe(false);
    });

    it('prevHash 연결이 깨지면 false', () => {
      let log: AuditEntry[] = [];
      log = appendAudit(log, { verb: 'a' }, 100);
      log = appendAudit(log, { verb: 'b' }, 200);
      const tampered = log.map((e, i) => (i === 1 ? { ...e, prevHash: 'deadbeef' } : e));
      expect(verifyAudit(tampered)).toBe(false);
    });

    it('seq 불연속이면 false', () => {
      let log: AuditEntry[] = [];
      log = appendAudit(log, { verb: 'a' }, 100);
      log = appendAudit(log, { verb: 'b' }, 200);
      const tampered = log.map((e, i) => (i === 1 ? { ...e, seq: 5 } : e));
      expect(verifyAudit(tampered)).toBe(false);
    });

    it('항목 삭제(중간 누락) 시 false', () => {
      let log: AuditEntry[] = [];
      log = appendAudit(log, { verb: 'a' }, 100);
      log = appendAudit(log, { verb: 'b' }, 200);
      log = appendAudit(log, { verb: 'c' }, 300);
      // 가운데 항목 제거 → seq 불연속 + prevHash 연결 깨짐.
      const tampered = [log[0]!, log[2]!];
      expect(verifyAudit(tampered)).toBe(false);
    });
  });
});
