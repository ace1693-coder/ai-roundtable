/** 프런트엔드 ↔ Cloudflare Worker 사이의 요청·응답 계약. 양쪽이 같은 타입을 쓴다. */

export type RoleId = 'gptoss' | 'gemini' | 'moderator';

/**
 * decide  = 사회자가 다음 발언자를 정하는 턴(본문 + NEXT: 표식)
 * open / critique / rebut = 발언 턴
 * summary = 회의 최종 정리
 */
export type TurnPhase = 'open' | 'critique' | 'moderate' | 'rebut' | 'summary' | 'decide';

/** 사회자가 정한 다음 발언자. done 이면 회의를 마무리한다. */
export type NextSpeaker = RoleId | 'done';

export interface TurnDecision {
  next: NextSpeaker;
  /** 왜 그렇게 정했는지 한 줄(화면·기록용) */
  reason?: string;
}

export interface TranscriptLine {
  author: string;
  role?: string;
  text: string;
}

export interface TurnRequest {
  role: RoleId;
  phase: TurnPhase;
  topic: string;
  domain: string;
  /** 몇 번째 AI 발언인지(1부터). 프롬프트의 라운드 표기에 쓴다. */
  turnIndex: number;
  maxTurns: number;
  roles: Record<RoleId, string>;
  thinking: { title: string; instruction: string }[];
  memories: { title: string; body: string; status: string }[];
  transcript: TranscriptLine[];
  /** 사용자가 마지막으로 끼어든 말. 있으면 최우선으로 반영한다. */
  userDirective?: string;
  /** 지금 회의에서 켜져 있는 참가자. 꺼진 참가자는 호출 대상이 될 수 없다. */
  participants?: RoleId[];
  /** 이번 회의에서 몇 번째 호출인지(1부터). 예산 안내에 쓴다. */
  callIndex?: number;
  /** 회의당 호출 예산 */
  callBudget?: number;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'sensitive_blocked'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'provider_error'
  | 'not_configured'
  | 'network';

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
}

export interface TurnSuccess {
  ok: true;
  text: string;
  /** 실제 호출한 모델 ID (예: openai/gpt-oss-120b) */
  model: string;
  /** 실제 제공업체 (예: GroqCloud / Google AI Studio) */
  provider: string;
  latencyMs: number;
  usage?: UsageInfo;
  quota?: { remaining: number; cap: number };
  /** 사회자 턴(decide)에서만 내려온다. 없으면 앱이 기본 교대 규칙으로 정한다. */
  decision?: TurnDecision;
}

export interface TurnFailure {
  ok: false;
  code: ApiErrorCode;
  message: string;
  retryAfter?: number;
  findings?: string[];
  providerStatus?: number;
}

export type TurnResponse = TurnSuccess | TurnFailure;

export interface HealthInfo {
  ok: true;
  app: string;
  version: string;
  models: { gptoss: string; gemini: string; moderator: string };
  configured: { groq: boolean; gemini: boolean; accessToken: boolean };
  /** 패스코드가 맞을 때만 내려온다. */
  quota?: { groq: { used: number; cap: number }; gemini: { used: number; cap: number } };
  allowedOrigin?: boolean;
}

export const PHASE_LABEL: Record<TurnPhase, string> = {
  open: '첫 의견',
  critique: '검토·반박',
  moderate: '쟁점 정리',
  rebut: '재반박',
  summary: '최종 정리',
  decide: '다음 발언자 결정',
};

/**
 * 사회자 응답에서 `NEXT: ...` 표식을 떼어 낸다.
 * 표식이 없거나 후보에 없는 값이면 decision 은 undefined 이고, 앱이 기본 교대 규칙으로 넘어간다.
 */
export function parseDecisionLine(
  raw: string,
  allowed: readonly NextSpeaker[] = ['gptoss', 'gemini', 'moderator', 'done'],
): { text: string; decision?: TurnDecision } {
  const lines = String(raw ?? '').split(/\r?\n/);
  let decision: TurnDecision | undefined;
  const kept: string[] = [];
  for (const line of lines) {
    const m = /^\s*(?:NEXT|다음\s*발언자)\s*[:：]\s*([a-zA-Z가-힣]+)\s*$/i.exec(line);
    if (!m) {
      kept.push(line);
      continue;
    }
    const token = m[1].toLowerCase();
    const next: NextSpeaker | null =
      token === 'done' || token === 'end' || token === 'finish' || token === '종료'
        ? 'done'
        : token === 'gptoss' || token === 'gpt-oss' || token === 'gpt'
          ? 'gptoss'
          : token === 'gemini'
            ? 'gemini'
            : token === 'moderator' || token === '사회자'
              ? 'moderator'
              : null;
    if (next && allowed.includes(next) && !decision) decision = { next };
  }
  return { text: kept.join('\n').trim(), decision };
}
