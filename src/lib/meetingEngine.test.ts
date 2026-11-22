import { describe, expect, it } from 'vitest';
import type { AiId, ChatMessage, Meeting } from './types';
import {
  applyDecision,
  afterSpeech,
  buildTurnRequest,
  endReasonFor,
  planNextTurn,
  repeatDetected,
} from './meetingEngine';
import { MEETING_TUNING } from '../config/meeting';

function msg(author: AiId | 'me' | 'system', text: string, at = Date.now()): ChatMessage {
  return {
    id: `m${at}-${Math.random().toString(36).slice(2, 6)}`,
    authorId: author,
    text,
    createdAt: at,
    source: author === 'me' ? 'user' : author === 'system' ? 'local' : 'api',
    roleAtTime: author === 'me' ? '나' : '역할',
  };
}

function meeting(partial: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mt1',
    title: '테스트 회의',
    topic: '코팅 공정 불량 개선',
    domain: 'manufacturing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    roles: { gptoss: '공정혁신 전문가', gemini: '검증 전문가', moderator: '사회자' },
    status: 'active',
    messages: [],
    queue: [],
    usedMemoryIds: [],
    repeatWarnings: 0,
    maxTurns: 5,
    enabledAi: { gptoss: true, gemini: true, moderator: true },
    callCount: 0,
    awaitingDecision: true,
    auto: true,
    ...partial,
  };
}

describe('planNextTurn — 사회자가 순서를 정한다', () => {
  it('회의를 열면 사회자가 먼저 다음 발언자를 정한다', () => {
    const m = meeting();
    const plan = planNextTurn(m)!;
    expect(plan).toMatchObject({ speaker: 'moderator', phase: 'decide', mode: 'decide' });
  });

  it('사회자의 결정을 그대로 다음 발언자로 쓴다', () => {
    const m = meeting({ awaitingDecision: false, nextSpeaker: 'gemini' });
    const plan = planNextTurn(m)!;
    expect(plan.speaker).toBe('gemini');
    expect(plan.mode).toBe('speak');
    expect(plan.phase).toBe('critique');
  });

  it('발언이 끝나면 다시 사회자 결정 차례로 돌아간다', () => {
    const m = meeting({ awaitingDecision: false, nextSpeaker: 'gptoss' });
    const after = afterSpeech(m, 'gptoss');
    expect(after.awaitingDecision).toBe(true);
    expect(after.nextSpeaker).toBeUndefined();
    const next = planNextTurn({ ...m, ...after } as Meeting)!;
    expect(next).toMatchObject({ speaker: 'moderator', mode: 'decide' });
  });

  it('사회자가 꺼져 있으면 기본 교대 규칙으로 넘어간다', () => {
    const m = meeting({ enabledAi: { gptoss: true, gemini: true, moderator: false }, awaitingDecision: false });
    expect(planNextTurn(m)!.speaker).toBe('gptoss');
    const after = afterSpeech(m, 'gptoss');
    expect(after.awaitingDecision).toBe(false);
    expect(after.nextSpeaker).toBe('gemini');
  });

  it('꺼진 AI는 결정·교대 어느 쪽에서도 발언자가 되지 않는다', () => {
    const m = meeting({ enabledAi: { gptoss: false, gemini: true, moderator: true }, awaitingDecision: false });
    expect(planNextTurn(m)!.speaker).toBe('gemini');
    // 사회자가 꺼진 AI를 지목해도 교대로 대체한다
    const decided = applyDecision(m, { next: 'gptoss' });
    expect(decided.nextSpeaker).toBe('gemini');
  });

  it('사회자가 done 이면 계획을 만들지 않고 종료 사유가 선다', () => {
    const m = meeting({ nextSpeaker: 'done', awaitingDecision: false });
    expect(planNextTurn(m)).toBeNull();
    expect(endReasonFor(m)).toBe('moderator_done');
  });

  it('호출 예산에 닿으면 종료 사유가 선다', () => {
    const m = meeting({ callCount: MEETING_TUNING.maxCallsPerMeeting });
    expect(endReasonFor(m)).toBe('budget');
  });

  it('같은 말이 세 번 이어지면 반복으로 멈춘다', () => {
    const same = '코팅 노즐 점검 주기를 2주로 줄이고 데이터를 더 모아 판단하자';
    const m = meeting({ messages: [msg('gptoss', same), msg('gemini', same), msg('gptoss', same)] });
    expect(repeatDetected(m)).toBe(true);
    expect(endReasonFor(m)).toBe('repeat');
  });

  it('모든 AI가 꺼지면 종료 사유가 선다', () => {
    const m = meeting({ enabledAi: { gptoss: false, gemini: false, moderator: false } });
    expect(endReasonFor(m)).toBe('all_disabled');
    expect(planNextTurn(m)).toBeNull();
  });

  it('일시정지·종료 상태에서는 null', () => {
    expect(planNextTurn(meeting({ status: 'paused' }))).toBeNull();
    expect(planNextTurn(meeting({ status: 'ended' }))).toBeNull();
  });

  it('사용자가 멘션한 AI를 다음 발언자로 올린다', () => {
    const m = meeting({ queue: ['gemini'] });
    expect(planNextTurn(m)!.speaker).toBe('gemini');
  });

  it('앱 알림과 사용자 메시지는 발언 수에 세지 않는다', () => {
    const m = meeting();
    m.messages = [msg('me', '질문'), msg('system', '알림'), msg('me', '추가')];
    const plan = planNextTurn(m)!;
    expect(plan.turnIndex).toBe(1);
  });
});

describe('applyDecision', () => {
  it('후보가 아닌 값이면 기본 교대로 대체한다', () => {
    const m = meeting({ enabledAi: { gptoss: true, gemini: true, moderator: false }, messages: [msg('gptoss', '의견')] });
    expect(applyDecision(m, undefined).nextSpeaker).toBe('gemini');
  });

  it('done 을 받으면 done 으로 남긴다', () => {
    expect(applyDecision(meeting(), { next: 'done' }).nextSpeaker).toBe('done');
  });
});

describe('buildTurnRequest', () => {
  it('마지막이 사용자 발언이면 최우선 지시로 넣는다', () => {
    const m = meeting();
    m.messages = [msg('gptoss', '의견'), msg('me', '가격은 빼고 봐줘')];
    const plan = { speaker: 'gemini' as const, phase: 'critique' as const, turnIndex: 2, mode: 'speak' as const, final: false };
    const req = buildTurnRequest(m, plan, [], '낙균');
    expect(req.userDirective).toBe('가격은 빼고 봐줘');
    expect(req.role).toBe('gemini');
  });

  it('전달 완료로 표시된 지시는 다시 싣지 않는다', () => {
    const m = meeting();
    const mine = msg('me', '가격은 빼고');
    m.messages = [mine, msg('gemini', '알겠어')];
    m.directiveSentId = mine.id;
    const req = buildTurnRequest(m, planNextTurn(m)!, [], '낙균');
    expect(req.userDirective).toBeUndefined();
  });

  it('대화록은 최근 6개, 320자로 자른다', () => {
    const m = meeting();
    m.messages = Array.from({ length: 10 }, (_, i) => msg('gptoss', `발언 ${i} ${'가'.repeat(400)}`, i));
    const req = buildTurnRequest(m, planNextTurn(m)!, [], '낙균');
    expect(req.transcript).toHaveLength(6);
    expect(req.transcript[0].text.length).toBeLessThanOrEqual(321);
  });

  it('관련 기억과 사고 기법을 함께 보낸다', () => {
    const m = meeting();
    const req = buildTurnRequest(
      m,
      planNextTurn(m)!,
      [
        { id: 'x', title: '코팅 불량 원인', body: '노즐 막힘', status: '가설', type: '사실', tags: ['코팅'], createdAt: 1, updatedAt: 1 },
        { id: 'y', title: '무관한 기억', body: '수면', status: '가설', type: '사실', tags: [], createdAt: 1, updatedAt: 1 },
      ],
      '낙균',
    );
    expect(req.memories.map((x) => x.title)).toContain('코팅 불량 원인');
    expect(req.memories.map((x) => x.title)).not.toContain('무관한 기억');
    expect(req.thinking.length).toBeGreaterThan(0);
    expect(req.maxTurns).toBe(MEETING_TUNING.maxCallsPerMeeting);
    expect(req.participants).toEqual(['gptoss', 'gemini', 'moderator']);
  });
});

describe('buildTurnRequest — 끼어든 말', () => {
  it('마지막이 사용자 발언이면 userDirective로 싣는다', () => {
    const m = meeting({ messages: [msg('gptoss', '첫 의견'), msg('me', '라인 정지 위험을 먼저 따져 줘')] });
    const plan = planNextTurn(m)!;
    const req = buildTurnRequest(m, plan, []);
    expect(req.userDirective).toBe('라인 정지 위험을 먼저 따져 줘');
  });

  it('끼어든 뒤 예전 요청의 답이 도착해도 그 말을 잃지 않는다', () => {
    // 사용자가 끼어든 직후, 이미 나가 있던 요청의 AI 답이 붙는다.
    // 예전 규칙(마지막이 AI면 반영됨)에서는 이 말이 한 번도 전달되지 않았다.
    const m = meeting({
      messages: [msg('gptoss', '첫 의견'), msg('gemini', '검토'), msg('me', '라인 정지 위험을 먼저 따져 줘'), msg('moderator', '쟁점 정리')],
    });
    const plan = planNextTurn(m)!;
    const req = buildTurnRequest(m, plan, []);
    expect(req.userDirective).toBe('라인 정지 위험을 먼저 따져 줘');
  });

  it('이미 전달한 말은 다시 싣지 않는다', () => {
    const mine = msg('me', '라인 정지 위험을 먼저 따져 줘');
    const m = meeting({ messages: [mine, msg('moderator', '쟁점 정리')], directiveSentId: mine.id });
    const plan = planNextTurn(m)!;
    const req = buildTurnRequest(m, plan, []);
    expect(req.userDirective).toBeUndefined();
  });

  it('전달한 뒤에 새로 끼어들면 새 말을 싣는다', () => {
    const first = msg('me', '첫 번째 지시', 1);
    const second = msg('me', '두 번째 지시', 2);
    const m = meeting({ messages: [first, msg('gptoss', '답변', 3), second], directiveSentId: first.id });
    const plan = planNextTurn(m)!;
    const req = buildTurnRequest(m, plan, []);
    expect(req.userDirective).toBe('두 번째 지시');
  });
});
