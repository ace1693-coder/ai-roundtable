import type { AiId, ChatMessage, Meeting, MemoryItem } from './types';
import { AI_IDS } from './types';
import { selectThinkingPrompts } from '../../shared/thinking';
import type { NextSpeaker, TurnDecision, TurnPhase, TurnRequest, TranscriptLine } from '../../shared/protocol';
import { authorName } from './participants';
import { matchMemories } from './memory';
import { MEETING_TUNING, callBudget } from '../config/meeting';
import { REPEAT_THRESHOLD, similarity } from './repetition';

/** roles 가 비어 있는 예전 기록이 와도 프롬프트 조립이 죽지 않게 한다. */
const GENERAL_ROLES: Record<AiId, string> = { gptoss: '전략 분석가', gemini: '검증 담당', moderator: '사회자' };

/**
 * 회의 진행 규칙.
 *
 * - 고정 라운드 제한은 없다. 멈추는 조건은 ① 사용자 정지 ② 사회자의 done ③ 호출 예산
 *   ④ 반복 감지 ⑤ 실패·민감정보 차단이다(전략회의 C4 확정).
 * - 다음 발언자는 사회자(Gemini 별도 호출)가 정한다. 사회자가 꺼져 있거나 판단이 없으면
 *   기본 교대 규칙으로 넘어간다.
 */
export const AUTO_SEQUENCE: readonly AiId[] = MEETING_TUNING.autoSequence;

export type EndedReason = 'user' | 'moderator_done' | 'budget' | 'repeat' | 'all_disabled' | 'error' | 'sensitive';

export interface StepPlan {
  speaker: AiId;
  phase: TurnPhase;
  /** 1부터. 이번이 몇 번째 AI 발언인지. */
  turnIndex: number;
  /** decide = 사회자가 다음 발언자를 정하는 턴, speak = 발언, summary = 최종 정리 */
  mode: 'decide' | 'speak' | 'summary';
  /** 이 발언이 끝나면 회의 종료 */
  final: boolean;
}

/** 실제 AI가 만든 발언만 센다(사용자·앱 알림 제외). */
export function aiMessages(m: Meeting): ChatMessage[] {
  return m.messages.filter((x) => !x.deleted && x.authorId !== 'me' && x.authorId !== 'system' && Boolean(x.text.trim()));
}

export function enabledAiIds(m: Meeting): AiId[] {
  return AI_IDS.filter((id) => m.enabledAi?.[id] !== false);
}

export function isAiEnabled(m: Meeting, id: AiId): boolean {
  return m.enabledAi?.[id] !== false;
}

function latestAiSpeaker(m: Meeting): AiId | undefined {
  const ai = aiMessages(m);
  for (let i = ai.length - 1; i >= 0; i -= 1) {
    const id = ai[i].authorId;
    if (id !== 'system' && id !== 'me') return id;
  }
  return undefined;
}

/** 기본 교대: 켜져 있는 참가자를 순서대로 돌되 직전 발언자는 건너뛴다. */
export function rotationNext(m: Meeting, exclude?: AiId): AiId | undefined {
  const enabled = enabledAiIds(m);
  if (!enabled.length) return undefined;
  const last = exclude ?? latestAiSpeaker(m);
  const order = AI_IDS.filter((id) => enabled.includes(id));
  const start = last ? (order.indexOf(last) + 1) % order.length : 0;
  const pick = order[start];
  return pick ?? order[0];
}

/** 최근 AI 발언 3개가 연속으로 비슷하면 같은 말을 되풀이하는 것으로 본다. */
export function repeatDetected(m: Meeting): boolean {
  const ai = aiMessages(m).slice(-3);
  if (ai.length < 3) return false;
  const [a, b, c] = ai;
  return similarity(b.text, a.text) >= REPEAT_THRESHOLD && similarity(c.text, b.text) >= REPEAT_THRESHOLD;
}

/** 지금 회의를 멈춰야 하는 이유. null 이면 계속한다. */
export function endReasonFor(m: Meeting): EndedReason | null {
  if (!enabledAiIds(m).length) return 'all_disabled';
  if (m.nextSpeaker === 'done') return 'moderator_done';
  if ((m.callCount ?? 0) >= callBudget()) return 'budget';
  if (repeatDetected(m)) return 'repeat';
  return null;
}

function phaseFor(speaker: AiId, priorTurns: number): TurnPhase {
  if (speaker === 'moderator') return 'moderate';
  if (speaker === 'gemini') return priorTurns === 0 ? 'critique' : 'rebut';
  return priorTurns === 0 ? 'open' : 'rebut';
}

/**
 * 다음에 할 일. null 이면 자동으로 할 일이 없다(멈춤·종료·예산 초과).
 * 순수 함수라 새로고침·재개 후에도 같은 상태면 같은 계획이 나온다.
 */
export function planNextTurn(m: Meeting): StepPlan | null {
  if (m.status !== 'active') return null;
  const enabled = enabledAiIds(m);
  if (!enabled.length) return null;

  const turns = aiMessages(m).length;
  const moderatorOn = enabled.includes('moderator');
  // 사회자가 done 을 결정했으면 더 말하지 않는다(종료 처리는 endReasonFor 가 맡는다).
  if ((m.nextSpeaker as NextSpeaker | undefined) === 'done') return null;

  // 1) 사용자가 @로 지정한 발언자가 있으면 그것이 우선.
  const queued = m.queue.find((id) => enabled.includes(id));
  if (queued) return { speaker: queued, phase: phaseFor(queued, turns), turnIndex: turns + 1, mode: 'speak', final: false };

  // 2) 사회자가 정해 둔 다음 발언자.
  const decided = m.nextSpeaker as NextSpeaker | undefined;
  if (decided && decided !== 'done' && enabled.includes(decided)) {
    return { speaker: decided, phase: phaseFor(decided, turns), turnIndex: turns + 1, mode: 'speak', final: false };
  }

  // 3) 사회자가 켜져 있고 아직 이번 차례를 정하지 않았으면 결정 턴.
  if (moderatorOn && m.awaitingDecision !== false) {
    return { speaker: 'moderator', phase: 'decide', turnIndex: turns + 1, mode: 'decide', final: false };
  }

  // 4) 사회자가 없거나 결정을 못 했으면 기본 교대.
  const next = rotationNext(m);
  if (!next) return null;
  return { speaker: next, phase: phaseFor(next, turns), turnIndex: turns + 1, mode: 'speak', final: false };
}

/** 사회자의 결정을 회의 상태에 반영한다. 고를 수 없는 값이면 기본 교대로 대체한다. */
export function applyDecision(m: Meeting, decision: TurnDecision | undefined): Partial<Meeting> {
  const enabled = enabledAiIds(m);
  if (decision?.next === 'done') return { nextSpeaker: 'done', awaitingDecision: false };
  if (decision && enabled.includes(decision.next)) {
    return { nextSpeaker: decision.next, awaitingDecision: false, lastDecision: { next: decision.next, reason: decision.reason } };
  }
  return { nextSpeaker: rotationNext(m) ?? 'done', awaitingDecision: false, lastDecision: undefined };
}

/** 발언이 끝난 뒤: 사회자가 켜져 있으면 다시 결정을 받고, 아니면 교대로 넘긴다. */
export function afterSpeech(m: Meeting, spoken: AiId): Partial<Meeting> {
  const moderatorOn = isAiEnabled(m, 'moderator');
  return {
    nextSpeaker: moderatorOn ? undefined : (rotationNext(m, spoken) ?? 'done'),
    awaitingDecision: moderatorOn,
    queue: m.queue.filter((id) => id !== spoken),
    lastSpeaker: spoken,
  };
}

function clip(text: string, n: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 최근 대화를 모델 입력 크기에 맞춰 압축한다. Groq 무료 TPM(8K)이 빠듯해 길이를 지킨다. */
export function buildTranscript(
  m: Meeting,
  displayName: string,
  limit = MEETING_TUNING.transcriptLines,
): TranscriptLine[] {
  return m.messages
    .filter((x) => !x.deleted && x.text.trim())
    .slice(-limit)
    .map((x) => ({
      author: x.authorId === 'system' ? '앱 알림' : authorName(x.authorId, displayName),
      role: x.authorId === 'me' ? '사용자' : x.roleAtTime,
      text: clip(x.text, 320),
    }));
}

/**
 * 아직 AI에게 최우선 지시로 전달하지 못한 사용자 발언.
 *
 * 예전에는 "마지막이 AI 발언이면 이미 반영됐다"고 봤는데, 사용자가 끼어든 직후
 * *이미 나가 있던* AI 요청의 답이 도착하면 그 말이 한 번도 전달되지 않고 사라졌다.
 * 그래서 실제로 전달한 발언의 id를 회의에 남기고 그것만 소비된 것으로 본다.
 */
export function pendingUserDirective(m: Meeting): ChatMessage | undefined {
  for (let i = m.messages.length - 1; i >= 0; i -= 1) {
    const x = m.messages[i];
    if (x.deleted || !x.text.trim()) continue;
    if (x.authorId !== 'me') continue;
    if (m.directiveSentId === x.id) return undefined;
    return x;
  }
  return undefined;
}

/**
 * Worker로 보낼 회의 턴 요청을 만든다. 프롬프트 문장은 Worker가 조립하므로
 * 여기서는 사실 데이터(주제·역할·기억·대화록·사고 기법·켜진 참가자)만 넘긴다.
 */
export function buildTurnRequest(
  m: Meeting,
  plan: StepPlan,
  memories: MemoryItem[],
  displayName = '나',
  memoryLimit = MEETING_TUNING.memoryLimit,
): TurnRequest {
  const related = matchMemories(`${m.topic} ${m.messages.at(-1)?.text ?? ''}`, memories, memoryLimit).map((r) => r.item);
  const directive = pendingUserDirective(m);
  const thinking = selectThinkingPrompts(m.topic, m.domain, 2);

  return {
    role: plan.speaker,
    phase: plan.phase,
    topic: m.topic,
    domain: m.domain,
    turnIndex: plan.turnIndex,
    maxTurns: callBudget(),
    roles: m.roles ?? GENERAL_ROLES,
    thinking: thinking.map((t) => ({ title: t.title, instruction: t.instruction })),
    memories: related.map((x) => ({ title: clip(x.title, 80), body: clip(x.body, 260), status: x.status })),
    transcript: buildTranscript(m, displayName),
    userDirective: directive ? clip(directive.text, 500) : undefined,
    participants: enabledAiIds(m),
    callIndex: (m.callCount ?? 0) + 1,
    callBudget: callBudget(),
  };
}

/** 회의 상태를 사람이 읽는 한 줄로. 화면 상단 진행 표시에 쓴다. */
export function describeProgress(m: Meeting): string {
  return `AI 발언 ${aiMessages(m).length} · 호출 ${m.callCount ?? 0}/${callBudget()}`;
}

/** 응답 시간 실측값 평균(ms). 측정값이 없으면 null. */
export function averageLatency(m: Meeting): number | null {
  const rows = m.messages.filter((x) => typeof x.latencyMs === 'number' && x.latencyMs > 0) as (ChatMessage & { latencyMs: number })[];
  if (!rows.length) return null;
  return Math.round(rows.reduce((sum, r) => sum + r.latencyMs, 0) / rows.length);
}

/** 멘션 대기열 정리: 켜져 있는 실제 AI만 남긴다. */
export function normalizeQueue(ids: string[]): AiId[] {
  return ids.filter((id): id is AiId => AI_IDS.includes(id as AiId));
}

export type { NextSpeaker };
