import { describe, expect, it } from 'vitest';
import type { AiId, ChatMessage, Meeting } from './types';
import { nextSpeaker, registerAnswer, skipSpeaker } from './turn';

let n = 0;
function msg(authorId: ChatMessage['authorId'], text: string, source: ChatMessage['source'] = 'manual'): ChatMessage {
  n += 1;
  return { id: `m${n}`, authorId, text, createdAt: 1000 + n, source, roleAtTime: 'r' };
}

function meeting(partial: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mt1',
    title: '테스트 회의',
    topic: '테스트',
    domain: 'general',
    createdAt: 1,
    updatedAt: 1,
    roles: { chatgpt: 'A', gemini: 'B', pickle: 'C' },
    status: 'active',
    messages: [],
    queue: [],
    usedMemoryIds: [],
    repeatWarnings: 0,
    ...partial,
  };
}

describe('nextSpeaker', () => {
  it('새 회의는 ChatGPT부터', () => {
    expect(nextSpeaker(meeting())).toBe('chatgpt');
  });

  it('멘션 대기열을 먼저 소비한다', () => {
    const m = meeting({ queue: ['gemini', 'pickle'] });
    expect(nextSpeaker(m)).toBe('gemini');
  });

  it('일시정지·종료면 null', () => {
    expect(nextSpeaker(meeting({ status: 'paused' }))).toBeNull();
    expect(nextSpeaker(meeting({ status: 'ended' }))).toBeNull();
  });

  it('아직 발언하지 않은 AI를 먼저 부른다', () => {
    const m = meeting({ messages: [msg('chatgpt', 'aaaaa')] });
    expect(nextSpeaker(m)).toBe('gemini');
  });

  it('모두 발언했으면 마지막 발언자가 아닌 쪽 중 오래된 쪽', () => {
    const m = meeting({
      messages: [msg('chatgpt', 'a'), msg('gemini', 'b'), msg('pickle', 'c')],
    });
    expect(nextSpeaker(m)).toBe('chatgpt');
  });

  it('로컬 알림은 발언으로 세지 않는다', () => {
    const m = meeting({ messages: [msg('chatgpt', 'a'), msg('system', '알림', 'local')] });
    expect(nextSpeaker(m)).toBe('gemini');
  });
});

describe('skipSpeaker', () => {
  it('현재 발언자를 건너뛰고 다른 AI를 제안한다', () => {
    const m = meeting({ queue: ['chatgpt'] });
    const next = skipSpeaker(m).queue;
    expect(next[0]).not.toBe('chatgpt');
    expect(['gemini', 'pickle']).toContain(next[0] as AiId);
  });
});

describe('registerAnswer', () => {
  it('답변을 추가하고 반복이 아니면 경고 0', () => {
    const m = meeting();
    const r = registerAnswer(m, 'chatgpt', '첫 발언: 측정이 먼저다', 'manual', 'A');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].source).toBe('manual');
    expect(r.repeatWarnings).toBe(0);
  });

  it('같은 말을 반복하면 로컬 규칙 엔진 알림을 남긴다', () => {
    const long = '코팅 공정의 불량 원인을 먼저 측정하고 병목을 확정해야 한다. 측정 없이 설비를 바꾸면 위험하다.';
    const m = meeting({ messages: [msg('chatgpt', long)] });
    const r = registerAnswer(m, 'gemini', long, 'manual', 'B');
    expect(r.repeatWarnings).toBe(1);
    // 마지막 메시지가 로컬 알림
    const last = r.messages[r.messages.length - 1];
    expect(last.authorId).toBe('system');
    expect(last.source).toBe('local');
    expect(last.text).toContain('반복 발언 감지');
  });

  it('3회 연속이면 일시정지하고, 자동 종료는 하지 않는다', () => {
    const long = 'PWA 캐시 전략은 앱셸 선캐시와 탐색 요청 네트워크 우선으로 간다. 해시 자산은 캐시 우선이다.';
    let m = meeting({ messages: [msg('chatgpt', long)] });
    let r = registerAnswer(m, 'gemini', long, 'manual', 'B');
    r = registerAnswer({ ...m, messages: r.messages, repeatWarnings: r.repeatWarnings }, 'pickle', long, 'manual', 'C');
    r = registerAnswer({ ...m, messages: r.messages, repeatWarnings: r.repeatWarnings }, 'chatgpt', long, 'manual', 'A');
    expect(r.repeatWarnings).toBe(3);
    expect(r.status).toBe('paused');
    expect(r.messages.some((x) => x.source === 'local' && x.text.includes('일시정지'))).toBe(true);
  });
});
