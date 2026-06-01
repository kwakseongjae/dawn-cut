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
  serializeProject,
  summarizeState,
  verifyAudit,
} from '@dawn-cut/core';

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
}
