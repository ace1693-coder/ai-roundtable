import { describe, expect, it } from 'vitest';
import type { ChatMessage, Meeting, MemoryItem } from './types';
import { createMemory } from './memory';
import { buildSummaryPrompt, buildTurnPrompt } from './prompt';
import { buildLocalSummary } from './summary';
import { formatDateDivider, formatTime } from './format';

function msg(authorId: ChatMessage['authorId'], text: string, source: ChatMessage['source'] = 'manual'): ChatMessage {
  return { id: `m${Math.random()}`, authorId, text, createdAt: new Date('2026-11-22T02:20:00+09:00').getTime(), source, roleAtTime: 'r' };
}

const meeting: Meeting = {
  id: 'mt',
  title: '코팅 공정 개선',
  topic: '코팅 공정 개선',
  domain: 'manufacturing',
  createdAt: new Date('2026-11-22T02:00:00+09:00').getTime(),
  updatedAt: Date.now(),
  roles: { chatgpt: '공정혁신 전문가', gemini: '설비·품질·안전 검증 전문가', pickle: '생산성·원가절감 사회자' },
  status: 'active',
  messages: [msg('chatgpt', '측정이 먼저다'), msg('me', '@Gemini 위험성 검토해', 'user')],
  queue: ['gemini'],
  usedMemoryIds: ['mem1'],
  repeatWarnings: 0,
};

const memories: MemoryItem[] = [
  createMemory({ title: '측정 우선', body: '불량 유형을 먼저 기록', status: '가설', type: '배경지식', tags: ['측정'] }),
];

describe('buildTurnPrompt', () => {
  const p = buildTurnPrompt(meeting, 'gemini', memories, '낙균');
  it('대상 AI의 역할이 들어간다', () => {
    expect(p).toContain('Gemini');
    expect(p).toContain('설비·품질·안전 검증 전문가');
  });
  it('기억의 상태 태그가 들어간다', () => {
    expect(p).toContain('[가설] 측정 우선');
  });
  it('사용자 멘션 메시지가 최우선 지시로 들어간다', () => {
    expect(p).toContain('사용자가 방금 말했다');
    expect(p).toContain('위험성 검토해');
  });
  it('수동 릴레이임을 밝힌다(자동 호출 아님)', () => {
    expect(p).toContain('앱이 자동 호출한 것이 아니');
  });
  it('지식후보 형식을 요구한다', () => {
    expect(p).toContain('지식후보');
  });
});

describe('buildSummaryPrompt', () => {
  it('전체 대화와 출력 형식이 들어간다', () => {
    const s = buildSummaryPrompt(meeting, memories, '낙균');
    expect(s).toContain('아직 갈린 쟁점');
    expect(s).toContain('측정이 먼저다');
  });
});

describe('buildLocalSummary', () => {
  it('로컬 규칙 엔진 출처를 밝히고 발언 수를 센다', () => {
    const s = buildLocalSummary(meeting);
    expect(s).toContain('출처: 로컬 규칙 엔진');
    expect(s).toContain('나 1');
    expect(s).toContain('ChatGPT 1');
    expect(s).toContain('위험성 검토해');
  });
});

describe('format', () => {
  it('오전/오후 HH:MM', () => {
    const d = new Date('2026-11-22T02:20:00+09:00');
    expect(formatTime(d.getTime())).toMatch(/^오전 0?2:20$/);
    const e = new Date('2026-11-22T14:05:00+09:00');
    expect(formatTime(e.getTime())).toBe('오후 02:05');
  });
  it('오늘/어제/날짜 구분선', () => {
    const now = new Date('2026-11-22T12:00:00+09:00').getTime();
    expect(formatDateDivider(now, now)).toBe('오늘');
    const y = new Date('2026-11-21T12:00:00+09:00').getTime();
    expect(formatDateDivider(y, now)).toBe('어제');
    const old = new Date('2026-11-01T12:00:00+09:00').getTime();
    expect(formatDateDivider(old, now)).toContain('11월 1일');
  });
});
