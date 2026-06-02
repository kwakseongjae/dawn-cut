// dawn-cut MCP 세션 — '한 번에 .dawn 프로젝트 하나'를 메모리에 들고, GUI와 동일한
// command bus(applyCommand) + 불변식 + 감사로그(appendAudit) + dry-run 게이트로 편집한다.
// SDK 비의존(순수 로직 + node fs) → 직접 단위/통합 테스트 가능. index.ts가 이걸 MCP tool로 감싼다.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  type AuditEntry,
  type DryRunReport,
  type EditCommand,
  type EditorState,
  type Project,
  type StateSummary,
  appendAudit,
  applyCommand,
  commandManifest,
  deserializeProject,
  dryRunCommands,
  makeProject,
  planAndPreview,
  plannerManifest,
  ruleBasedPlan,
  serializeProject,
  summarizeState,
  timelineToEdl,
  verifyAudit,
} from '@dawn-cut/core';
import { probeMedia, renderEdl } from '@dawn-cut/sidecar-ffmpeg';
import { isLlmAvailable, llmPlanProvider } from '@dawn-cut/sidecar-llm';

export interface ApplyResult {
  summary: StateSummary;
  removedProgramUs: number;
  auditCount: number;
  auditHead: string | null;
  auditVerified: boolean;
}

/**
 * 열린 프로젝트 한 개의 편집 세션. 상태 변경 지점은 `apply` 하나뿐(GUI의 approvePlan과 동형).
 * `dryRun`은 절대 상태를 바꾸지 않는다(미리보기). 모든 적용 명령은 해시체인 감사로그에 남는다.
 */
export class DawnSession {
  private project: Project | null = null;
  private state: EditorState | null = null;
  private audit: AuditEntry[] = [];
  private path: string | null = null;

  /** .dawn 파일을 열어 메모리에 적재(검증 실패 시 throw). 상태 요약을 돌려준다. */
  open(path: string): { summary: StateSummary; mediaPath: string } {
    const project = deserializeProject(readFileSync(path, 'utf8'));
    this.project = project;
    this.path = path;
    this.state = {
      timeline: project.timeline,
      transcript: project.transcript,
      subtitleStyle: project.subtitleStyle ?? {},
    };
    this.audit = [];
    return { summary: summarizeState(this.state), mediaPath: project.mediaPath };
  }

  private require(): EditorState {
    if (!this.state) throw new Error('열린 프로젝트가 없습니다 — 먼저 open_project를 호출하세요.');
    return this.state;
  }

  /** 컴팩트 상태 요약(길이/어절/cue/필러/챕터/스타일). */
  summary(): StateSummary {
    return summarizeState(this.require());
  }

  /** 편집 명령 표면(9 verb + 입력 JSON-Schema) = GUI command bus와 1:1. */
  manifest(): Array<{ name: string; inputSchema: unknown }> {
    return commandManifest();
  }

  /**
   * 자연어 지시를 EditCommand[]로 계획한다(P3+P4 융합) — 외부 AI가 저수준 명령 대신 자연어를 위임.
   * 로컬 LLM 가용 시 LLM 플래너(plannerGrammar 안전 부분집합), 부재/실패/빈plan이면 결정적 룰 플래너로
   * graceful fallback(GUI store.planAndPreview와 동일 정책). 상태는 변경하지 않는다(미리보기) — 호출측이
   * commands를 검토 후 apply 한다.
   */
  async plan(nl: string): Promise<{
    engine: 'llm' | 'rule';
    commands: EditCommand[];
    report: DryRunReport;
    errors: string[];
  }> {
    const state = this.require();
    if (isLlmAvailable().available) {
      try {
        const { plan, report, errors } = await planAndPreview(
          nl,
          state,
          llmPlanProvider,
          plannerManifest(),
        );
        if (plan.length > 0) return { engine: 'llm', commands: plan, report, errors };
      } catch {
        // LLM 실패 → 룰 폴백.
      }
    }
    const commands = ruleBasedPlan(nl, state);
    const { report } = dryRunCommands(state, commands);
    return { engine: 'rule', commands, report, errors: [] };
  }

  /** 명령 묶음을 상태 변경 없이 미리 평가(원자적·결정적). 적용 전 안전 게이트. */
  dryRun(commands: unknown[]): DryRunReport {
    return dryRunCommands(this.require(), commands).report;
  }

  /**
   * 유일한 상태 변경 지점. 각 명령을 command bus로 적용하고 감사로그에 누적한다.
   * 하나라도 불변식을 깨면 applyCommand가 throw → 세션 상태는 보존(부분 적용 노출 안 함).
   */
  apply(commands: EditCommand[]): ApplyResult {
    const before = this.require();
    let st = before;
    let audit = this.audit;
    // 원자성: 임시로 진행하다 throw하면 this.state/this.audit를 건드리지 않는다.
    for (const cmd of commands) {
      const { after, removedProgramUs } = applyCommand(st, cmd);
      st = {
        timeline: after.timeline,
        transcript: after.transcript,
        subtitleStyle: after.subtitleStyle ?? {},
      };
      audit = appendAudit(audit, cmd, removedProgramUs);
    }
    this.state = st;
    this.audit = audit;
    return {
      summary: summarizeState(st),
      removedProgramUs: before.timeline.durationProgram - st.timeline.durationProgram,
      auditCount: audit.length,
      auditHead: audit[audit.length - 1]?.hash ?? null,
      auditVerified: verifyAudit(audit),
    };
  }

  /** 현재 상태를 .dawn로 직렬화해 저장(경로 생략 시 열었던 경로). */
  save(path?: string): { path: string } {
    const st = this.require();
    const target = path ?? this.path;
    if (!target) throw new Error('저장 경로가 없습니다.');
    if (!this.project) throw new Error('열린 프로젝트가 없습니다.');
    const out = makeProject(this.project.mediaPath, st.transcript, st.timeline, {
      subtitleStyle: st.subtitleStyle,
      subtitlePos: this.project.subtitlePos,
    });
    writeFileSync(target, serializeProject(out), 'utf8');
    this.path = target;
    return { path: target };
  }

  /** 감사로그 전체(해시체인) — 외부에서 재생/검증용. */
  auditLog(): { entries: AuditEntry[]; verified: boolean } {
    return { entries: this.audit, verified: verifyAudit(this.audit) };
  }

  /**
   * 현재 편집(타임라인=컷+색보정/줌 이펙트)을 실제 mp4로 렌더한다(sidecar-ffmpeg).
   * 외부 AI 파이프라인의 마지막 단계 — open→(plan)→apply→render. 길이/색/줌/파일오버레이가 반영된다.
   * 주의(MVP): 자막 '번인'은 렌더에 미포함(자막 PNG 래스터는 UI/데모 캔버스 파이프라인에 있음).
   */
  async render(outPath: string): Promise<{ outPath: string; durationUs: number }> {
    const st = this.require();
    if (!this.project) throw new Error('열린 프로젝트가 없습니다.');
    const probe = await probeMedia(this.project.mediaPath);
    const edl = timelineToEdl(st.timeline, this.project.mediaPath);
    await renderEdl(edl, outPath, { frameW: probe.width, frameH: probe.height });
    const result = await probeMedia(outPath);
    return { outPath, durationUs: result.durationUs };
  }
}
