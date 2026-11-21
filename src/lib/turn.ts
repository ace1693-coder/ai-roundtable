import type { AiId, ChatMessage, Meeting, MessageAuthor } from './types';
import { AI_IDS } from './types';
import { isAi } from './participants';
import { checkRepeat, REPEAT_LIMIT, REPEAT_THRESHOLD } from './repetition';
import { newId } from './memory';

/** 실제 AI가 남긴 발언(로컬 규칙 엔진 알림 제외) */
function realAiMessages(m: Meeting): ChatMessage[] {
  return m.messages.filter((x) => x.source !== 'local' && isAi(String(x.authorId)));
}

function lastRealMessage(m: Meeting): ChatMessage | undefined {
  for (let i = m.messages.length - 1; i >= 0; i -= 1) {
    if (m.messages[i].source !== 'local') return m.messages[i];
  }
  return undefined;
}

function latestTime(m: Meeting, id: AiId): number {
  const own = realAiMessages(m).filter((x) => x.authorId === id);
  return own.length ? own[own.length - 1].createdAt : 0;
}

function pickNext(m: Meeting, exclude: AiId[] = []): AiId {
  const real = realAiMessages(m);
  const last = lastRealMessage(m);
  const lastAi = last && isAi(String(last.authorId)) ? (last.authorId as AiId) : undefined;
  const silent = AI_IDS.filter((id) => !exclude.includes(id) && !real.some((x) => x.authorId === id));
  if (silent.length) {
    const withoutLast = silent.filter((id) => id !== lastAi);
    return (withoutLast.length ? withoutLast : silent)[0];
  }
  const cands = AI_IDS.filter((id) => !exclude.includes(id));
  const list = cands.length ? cands : AI_IDS.filter((id) => id !== lastAi);
  const usable = list.length ? list : [...AI_IDS];
  return usable
    .map((id) => ({ id, t: latestTime(m, id) }))
    .sort((a, b) => a.t - b.t)[0].id;
}

/**
 * 다음 발언자. 고정 라운드 없음.
 * ① 사용자가 멘션으로 지정한 대기열 → ② 아직 발언하지 않은 AI → ③ 마지막 발언이 가장 오래된 AI(직전 발언자 제외)
 */
export function nextSpeaker(m: Meeting): AiId | null {
  if (m.status !== 'active') return null;
  if (m.queue.length > 0) return m.queue[0];
  return pickNext(m);
}

export function skipSpeaker(m: Meeting): { queue: AiId[] } {
  const cur = nextSpeaker(m);
  if (!cur) return { queue: [] };
  const rest = m.queue.filter((id) => id !== cur);
  const next = pickNext(m, [cur]);
  return { queue: [next, ...rest] };
}

export function systemMessage(text: string): ChatMessage {
  return {
    id: newId('msg'),
    authorId: 'system',
    text,
    createdAt: Date.now(),
    source: 'local',
    roleAtTime: '로컬 요약/규칙 엔진',
  };
}

export interface RegisterResult {
  messages: ChatMessage[];
  repeatWarnings: number;
  status: Meeting['status'];
  notice?: ChatMessage;
}

/** AI 답변 등록 — 반복 감지 후 필요하면 로컬 규칙 엔진 알림을 남긴다. */
export function registerAnswer(m: Meeting, aiId: AiId, text: string, source: 'manual' | 'api', role: string): RegisterResult {
  const msg: ChatMessage = {
    id: newId('msg'),
    authorId: aiId,
    text: text.trim(),
    createdAt: Date.now(),
    source,
    roleAtTime: role,
  };
  const messages = [...m.messages, msg];
  const prior = realAiMessages(m)
    .filter((x) => x.text.length > 40)
    .slice(-6)
    .map((x) => x.text);
  const check = checkRepeat(text, prior, REPEAT_THRESHOLD);

  if (!check.repeated) {
    return { messages, repeatWarnings: 0, status: m.status === 'paused' ? 'paused' : 'active' };
  }

  const warnings = m.repeatWarnings + 1;
  const notice = systemMessage(
    `반복 발언 감지 — 직전 발언과 유사도 ${(check.similarity * 100).toFixed(0)}% (기준 ${Math.round(
      REPEAT_THRESHOLD * 100,
    )}%). 같은 말이 이어지면 Pickle에게 정리를 요청하거나 새 근거를 물어보세요. (로컬 규칙 엔진, ${warnings}/${REPEAT_LIMIT})`,
  );
  const pause = warnings >= REPEAT_LIMIT;
  const notice2 = pause
    ? systemMessage(
        `반복이 ${REPEAT_LIMIT}회 연속 감지되어 회의를 일시정지했습니다. 자동 종료는 하지 않았습니다. [회의 요약]으로 지금까지를 정리하거나 [재개]로 이어가세요.`,
      )
    : null;
  return {
    messages: notice2 ? [...messages, notice, notice2] : [...messages, notice],
    repeatWarnings: warnings,
    status: pause ? 'paused' : m.status === 'paused' ? 'paused' : 'active',
    notice: notice2 ?? notice,
  };
}

export function lastAuthor(m: Meeting): MessageAuthor | undefined {
  return m.messages.length ? m.messages[m.messages.length - 1].authorId : undefined;
}
