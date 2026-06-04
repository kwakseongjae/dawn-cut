import { defineConfig } from '@playwright/test';

// 프로덕션 기능 QA 스위트 — 실제 앱을 기능별로 구동하며 스크린샷 + 콘솔에러 + 관찰결과(JSON)를
// output/qa/<id>/ 에 남긴다. verify와 분리(직접 실행). 앱은 미리 빌드해 두고 돌린다.
export default defineConfig({
  testDir: 'tests/qa',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1, // Electron 단일 인스턴스(유저데이터 충돌 방지) — 시나리오는 순차 실행
  reporter: [['list']],
  retries: 0,
});
