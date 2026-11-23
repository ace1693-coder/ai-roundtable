import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLES,
  isLegacyMeeting,
  normalizeEnabledAi,
  normalizeMeeting,
  normalizeMeetings,
  normalizeMemories,
  normalizeMemoryItem,
  normalizeMessage,
  normalizeRoles,
  normalizeSettings,
  toAiId,
  toAuthorId,
} from './schema';

/** 3.0 이 localStorage/IndexedDB 에 실제로 남기던 형태(enabledAi·maxTurns·auto·callCount 없음). */
const V3_MEETING = {
  id: 'mt_v3',
  title: '코팅 불량 개선',
  topic: '코팅 불량 개선',
  domain: 'manufacturing',
  createdAt: 1_766_000_000_000,
  updatedAt: 1_766_000_060_000,
  roles: { chatgpt: '공정혁신 전문가', gemini: '설비·품질·안전 검증 전문가', pickle: '생산성·원가절감 사회자' },
  status: 'ended',
  queue: ['chatgpt'],
  usedMemoryIds: ['mem_1'],
  repeatWarnings: 1,
  summary: '3.0 요약문',
  messages: [
    { id: 'm1', authorId: 'chatgpt', text: '첫 발언', createdAt: 1_766_000_010_000, source: 'api', roleAtTime: '공정혁신 전문가' },
    { id: 'm2', authorId: 'pickle', text: '사회자 정리', createdAt: 1_766_000_020_000, source: 'api', roleAtTime: '생산성·원가절감 사회자' },
    { id: 'm3', authorId: 'me', text: '내 말', createdAt: 1_766_000_030_000, source: 'user', roleAtTime: '나' },
  ],
};

/** 4.0 형태지만 중첩 객체(enabledAi)가 빠진 기록 — 실제 장애를 일으킨 모양. */
const MISSING_ENABLED = {
  id: 'mt_broken',
  title: '필드 빠진 회의',
  domain: 'general',
  createdAt: 1_766_000_000_000,
  updatedAt: 1_766_000_000_500,
  roles: { gptoss: '전략 분석가', gemini: '검증 담당', moderator: '사회자' },
  status: 'active',
  messages: [{ id: 'm1', authorId: 'gptoss', text: 'GPT-OSS 발언', createdAt: 1_766_000_000_100, source: 'api', roleAtTime: '전략 분석가' }],
};

describe('toAiId / toAuthorId', () => {
  it('예전 참가자 이름을 지금 키로 옮긴다', () => {
    expect(toAiId('chatgpt')).toBe('gptoss');
    expect(toAiId('GPT-OSS')).toBe('gptoss');
    expect(toAiId('pickle')).toBe('moderator');
    expect(toAiId('모르는이름')).toBeUndefined();
    expect(toAiId(42)).toBeUndefined();
  });

  it('작성자: 모르는 값은 system 으로 떨어뜨린다', () => {
    expect(toAuthorId('chatgpt')).toBe('gptoss');
    expect(toAuthorId('pickle')).toBe('moderator');
    expect(toAuthorId('me')).toBe('me');
    expect(toAuthorId('system')).toBe('system');
    expect(toAuthorId(undefined)).toBe('system');
  });
});

describe('normalizeRoles / normalizeEnabledAi', () => {
  it('역할이 없으면 기본 역할로 채운다', () => {
    expect(normalizeRoles(undefined)).toEqual(DEFAULT_ROLES);
    expect(normalizeRoles('깨진 값')).toEqual(DEFAULT_ROLES);
  });

  it('예전 키의 역할명을 새 키로 가져온다', () => {
    const roles = normalizeRoles({ chatgpt: '공정 전문가', pickle: '사회자' });
    expect(roles.gptoss).toBe('공정 전문가');
    expect(roles.moderator).toBe('사회자');
    expect(roles.gemini).toBe(DEFAULT_ROLES.gemini);
  });

  it('enabledAi 가 없으면 모두 켜짐, 예전 disabledAi 는 존중한다', () => {
    expect(normalizeEnabledAi(undefined)).toEqual({ gptoss: true, gemini: true, moderator: true });
    expect(normalizeEnabledAi(undefined, ['pickle'])).toEqual({ gptoss: true, gemini: true, moderator: false });
    expect(normalizeEnabledAi({ gptoss: false })).toEqual({ gptoss: false, gemini: true, moderator: true });
  });
});

describe('normalizeMeeting — 3.0 기록 복구', () => {
  const m = normalizeMeeting(V3_MEETING);

  it('null 이 아니고 내용이 그대로 남는다', () => {
    expect(m).not.toBeNull();
    expect(m!.id).toBe('mt_v3');
    expect(m!.title).toBe('코팅 불량 개선');
    expect(m!.summary).toBe('3.0 요약문');
    expect(m!.messages).toHaveLength(3);
    expect(m!.messages.map((x) => x.text)).toEqual(['첫 발언', '사회자 정리', '내 말']);
    expect(m!.usedMemoryIds).toEqual(['mem_1']);
    expect(m!.repeatWarnings).toBe(1);
  });

  it('빠진 중첩 객체를 채운다 (장애 지점)', () => {
    expect(m!.enabledAi).toEqual({ gptoss: true, gemini: true, moderator: true });
    expect(m!.roles.gptoss).toBe('공정혁신 전문가');
    expect(m!.maxTurns).toBe(5);
    expect(m!.callCount).toBe(0);
    expect(m!.auto).toBe(false); // 3.0 은 자동 회의가 없었다 — 불러오자마자 API 를 부르지 않는다
  });

  it('예전 참가자 id 를 새 id 로 옮긴다', () => {
    expect(m!.messages[0].authorId).toBe('gptoss');
    expect(m!.messages[1].authorId).toBe('moderator');
    expect(m!.queue).toEqual(['gptoss']);
  });

  it('3.0 형태로 판별한다', () => {
    expect(isLegacyMeeting(V3_MEETING)).toBe(true);
    expect(isLegacyMeeting(MISSING_ENABLED)).toBe(true);
    expect(isLegacyMeeting(m)).toBe(false);
  });
});

describe('normalizeMeeting — 필드 일부 누락', () => {
  it('enabledAi 만 빠져도 기본값으로 채운다', () => {
    const m = normalizeMeeting(MISSING_ENABLED)!;
    expect(m.enabledAi).toEqual({ gptoss: true, gemini: true, moderator: true });
    expect(m.roles.gptoss).toBe('전략 분석가');
    expect(m.messages[0].authorId).toBe('gptoss');
  });

  it('모르는 필드는 지우지 않는다', () => {
    const m = normalizeMeeting({ ...MISSING_ENABLED, futureField: { keep: 1 } })!;
    expect((m as unknown as Record<string, unknown>).futureField).toEqual({ keep: 1 });
  });

  it('잘못된 nextSpeaker·queue·lastDecision 은 안전한 값만 남긴다', () => {
    const m = normalizeMeeting({
      ...MISSING_ENABLED,
      nextSpeaker: 'gptoss',
      queue: ['gemini', '해커', 'pickle'],
      lastDecision: { next: 'pickle', reason: '검증 필요' },
    })!;
    expect(m.nextSpeaker).toBe('gptoss');
    expect(m.queue).toEqual(['gemini', 'moderator']);
    expect(m.lastDecision).toEqual({ next: 'moderator', reason: '검증 필요' });
    const done = normalizeMeeting({ ...MISSING_ENABLED, nextSpeaker: 'done' })!;
    expect(done.nextSpeaker).toBe('done');
  });
});

describe('normalizeMeeting — 깨진 입력', () => {
  it('객체가 아니면 null', () => {
    expect(normalizeMeeting(null)).toBeNull();
    expect(normalizeMeeting(undefined)).toBeNull();
    expect(normalizeMeeting('{broken json')).toBeNull();
    expect(normalizeMeeting(3)).toBeNull();
    expect(normalizeMeeting([1, 2])).toBeNull();
  });

  it('messages 가 배열이 아니어도 살아난다', () => {
    const m = normalizeMeeting({ ...MISSING_ENABLED, messages: '깨짐' })!;
    expect(m.messages).toEqual([]);
    expect(m.title).toBe('필드 빠진 회의');
  });

  it('제목이 없으면 주제·기본 제목으로 채운다', () => {
    expect(normalizeMeeting({ ...MISSING_ENABLED, title: undefined, topic: '주제만 있음' })!.title).toBe('주제만 있음');
    expect(normalizeMeeting({ ...MISSING_ENABLED, title: '  ' })!.title).toBe('복구한 회의');
  });

  it('내용 없는 메시지는 버리고, 삭제 표시는 남긴다', () => {
    const roles = DEFAULT_ROLES;
    expect(normalizeMessage({ authorId: 'gptoss' }, roles)).toBeNull();
    expect(normalizeMessage('문자열', roles)).toBeNull();
    const del = normalizeMessage({ authorId: 'me', text: '', deleted: true }, roles);
    expect(del?.deleted).toBe(true);
  });

  it('메시지의 깨진 첨부·출처는 안전한 값으로', () => {
    const m = normalizeMessage(
      { authorId: 'chatgpt', text: '발언', source: '해킹', attachment: { name: 'a.png' } },
      DEFAULT_ROLES,
    )!;
    expect(m.authorId).toBe('gptoss');
    expect(m.source).toBe('local');
    expect(m.attachment).toEqual({ name: 'a.png', type: '', size: 0 });
    expect(m.roleAtTime).toBe(DEFAULT_ROLES.gptoss);
  });
});

describe('normalizeMeetings 배치', () => {
  it('정상 레코드는 유지하고 복구 수를 센다', () => {
    const r = normalizeMeetings([V3_MEETING, MISSING_ENABLED, null, 'x']);
    expect(r.total).toBe(4);
    expect(r.items).toHaveLength(2);
    expect(r.dropped).toBe(2);
    expect(r.repaired).toBe(2);
  });

  it('배열이 아니면 빈 결과', () => {
    expect(normalizeMeetings('{broken json')).toEqual({ items: [], total: 0, dropped: 0, repaired: 0 });
    expect(normalizeMeetings(undefined).items).toEqual([]);
  });
});

describe('기억·설정 정규화', () => {
  it('기억의 빠진 메타만 채우고 본문은 보존한다', () => {
    const mem = normalizeMemoryItem({ id: 'mem_1', title: '온도 기록', body: '본문', tags: '코팅', status: '이상한값' })!;
    expect(mem.body).toBe('본문');
    expect(mem.tags).toEqual([]);
    expect(mem.status).toBe('확인 필요');
    expect(mem.type).toBe('사실');
    expect(normalizeMemoryItem({ id: 'x' })).toBeNull();
    expect(normalizeMemoryItem(null)).toBeNull();
  });

  it('기억 목록에서 객체가 아닌 항목만 센다', () => {
    const r = normalizeMemories([{ title: 'a', body: 'b' }, 7, null]);
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  it('설정이 깨져도 Settings 를 만든다', () => {
    expect(normalizeSettings(null)).toEqual({ displayName: '나', avatarEmoji: '', workerUrl: '', accessCode: '', maxTurns: 5 });
    expect(normalizeSettings('{broken json').workerUrl).toBe('');
    expect(normalizeSettings({ displayName: '낙균', workerUrl: 'https://w.example', maxTurns: 99 })).toMatchObject({
      displayName: '낙균',
      workerUrl: 'https://w.example',
      maxTurns: 7,
    });
  });
});
