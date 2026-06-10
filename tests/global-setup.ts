// vitest globalSetup — 깨끗한 체크아웃(CI)에서도 artifacts/ 출력 폴더를 보장한다.
// 다수의 테스트(g4 속성 리포트, g18 픽셀 증거 등)가 artifacts/에 증거 파일을 쓰는데,
// 이 폴더는 gitignore라 fresh clone엔 없다 — 로컬 개발기에서만 우연히 존재했다(CI ENOENT 원인).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default function setup() {
  mkdirSync(resolve(process.cwd(), 'artifacts'), { recursive: true });
}
