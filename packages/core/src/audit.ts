/**
 * 편집 명령 감사 로그 — append-only 해시체인.
 *
 * 사용자가 적용한 편집 명령(command)과 그 결과 제거된 프로그램 길이(removedProgramUs)를
 * 변조 불가능한 사슬로 누적한다. 각 항목의 hash 는 직전 항목 hash(prevHash)와 자신의
 * 내용(seq·command·removedProgramUs)을 결합해 계산하므로, 중간 항목을 바꾸면 그 이후
 * 모든 hash 가 깨져 verifyAudit 이 false 를 돌려준다.
 *
 * 100% 로컬·결정적 순수 TS. node:crypto 같은 런타임 의존을 쓰지 않고 해시를 직접 구현한다.
 * 단 여기서 쓰는 pureHash 는 충돌 저항성이 보장되는 암호용 해시가 아니라, '우발적/단순
 * 변조 탐지'와 '결정적 식별자' 용도임에 유의한다(보안 서명 대용으로 쓰면 안 된다).
 */

/**
 * 감사 로그 한 항목.
 *
 * @property seq 0부터 시작하는 연속 시퀀스 번호(append 순서).
 * @property command 적용된 편집 명령(임의 형태 — 직렬화 가능해야 함).
 * @property removedProgramUs 이 명령으로 제거된 프로그램 길이(µs, 비음수).
 * @property prevHash 직전 항목의 hash(체인의 첫 항목은 빈 문자열 '').
 * @property hash 이 항목의 해시 = pureHash(prevHash + seq + JSON.stringify(command) + removedProgramUs).
 */
export interface AuditEntry {
  seq: number;
  command: unknown;
  removedProgramUs: number;
  prevHash: string;
  hash: string;
}

/** 체인의 시작점(첫 항목의 prevHash). 빈 문자열로 고정한다. */
const GENESIS_PREV_HASH = '';

/**
 * 한 항목의 해시 입력 문자열을 결정적으로 구성한다.
 * prevHash·seq·canonicalJson(command)·removedProgramUs 를 순서대로 이어 붙인다.
 *
 * command 직렬화는 키를 정렬한 canonical JSON 을 쓴다(R2) — 의미상 동일한 명령이 키 순서만
 * 달라도 같은 해시가 되도록. 따라서 호출자가 키 순서를 맞출 필요가 없다.
 */
function hashInput(
  prevHash: string,
  seq: number,
  command: unknown,
  removedProgramUs: number,
): string {
  return `${prevHash}${seq}${canonicalJson(command)}${removedProgramUs}`;
}

/**
 * 키를 정렬한 결정적 JSON 직렬화(순수). 객체는 키 사전순 정렬, 배열은 순서 보존,
 * 원시값은 JSON.stringify 그대로. 의미상 동일한 값 → 항상 동일한 문자열(해시 안정화).
 */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * 결정적 비암호용 해시(cyrb53 계열). 입력 문자열을 두 개의 32-bit 누산기로 섞은 뒤
 * 53-bit 정수를 만들어 16진 문자열로 돌려준다.
 *
 * - 같은 입력 → 항상 같은 출력(결정적).
 * - 길이가 한 글자만 달라도 출력이 크게 바뀜(우발적 변조 탐지에 충분).
 * - 암호학적 충돌 저항성은 없음 — 보안 서명 용도로 쓰지 말 것.
 *
 * @param s 해시할 문자열.
 * @returns 소문자 16진 해시 문자열.
 */
export function pureHash(s: string): string {
  // cyrb53: 두 시드를 다르게 초기화해 53-bit 결과를 얻는다.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  // 최종 혼합(avalanche).
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // 53-bit 정수 = (h2 의 21-bit) * 2^32 + (h1 의 32-bit). >>> 0 으로 부호 제거.
  const result = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return result.toString(16);
}

/**
 * 로그 끝에 새 항목을 추가한 '새 배열'을 반환한다(원본 불변, append-only).
 *
 * - seq 는 직전 항목 seq + 1(빈 로그면 0).
 * - prevHash 는 직전 항목 hash(빈 로그면 GENESIS_PREV_HASH).
 * - hash = pureHash(prevHash + seq + JSON.stringify(command) + removedProgramUs).
 *
 * @param log 기존 감사 로그(불변으로 취급).
 * @param command 추가할 편집 명령.
 * @param removedProgramUs 이 명령으로 제거된 프로그램 길이(µs).
 * @returns 새 항목이 끝에 추가된 새 AuditEntry[].
 */
export function appendAudit(
  log: readonly AuditEntry[],
  command: unknown,
  removedProgramUs: number,
): AuditEntry[] {
  const last = log.length > 0 ? log[log.length - 1] : undefined;
  const seq = last ? last.seq + 1 : 0;
  const prevHash = last ? last.hash : GENESIS_PREV_HASH;
  const hash = pureHash(hashInput(prevHash, seq, command, removedProgramUs));
  const entry: AuditEntry = { seq, command, removedProgramUs, prevHash, hash };
  return [...log, entry];
}

/**
 * 감사 로그 무결성을 검증한다. 모두 만족하면 true, 하나라도 어긋나면 false.
 *
 * 검사 항목(각 인덱스 i 에 대해):
 *  1. seq 연속성 — seq[i] === i (0부터 1씩 증가).
 *  2. prevHash 연결 — prevHash[i] 가 직전 항목 hash 와 일치(첫 항목은 GENESIS_PREV_HASH).
 *  3. hash 재계산 — pureHash(hashInput(...)) 가 저장된 hash 와 일치.
 *
 * 빈 로그는 위반이 없으므로 true.
 *
 * @param log 검증할 감사 로그.
 * @returns 무결하면 true, 변조/불연속이면 false.
 */
export function verifyAudit(log: readonly AuditEntry[]): boolean {
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry === undefined) return false;
    // 1) seq 연속성.
    if (entry.seq !== i) return false;
    // 2) prevHash 연결.
    if (entry.prevHash !== prevHash) return false;
    // 3) hash 재계산 일치.
    const expected = pureHash(
      hashInput(entry.prevHash, entry.seq, entry.command, entry.removedProgramUs),
    );
    if (entry.hash !== expected) return false;
    prevHash = entry.hash;
  }
  return true;
}
