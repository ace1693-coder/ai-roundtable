import { describe, expect, it } from 'vitest';
import type { TurnRequest } from '../../shared/protocol';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

const base: TurnRequest = {
  role: 'gptoss',
  phase: 'open',
  topic: '코팅 공정 불량 개선',
  domain: 'manufacturing',
  turnIndex: 1,
  maxTurns: 5,
  roles: { gptoss: '공정혁신 전문가', gemini: '검증 담당', moderator: '사회자' },
  thinking: [{ title: '반대편에 세우기', instruction: '반론 5개와 대응책' }],
  memories: [{ title: '노즐 막힘', body: '3라인에서 반복', status: '가설' }],
  transcript: [{ author: '나', role: '사용자', text: '불량이 줄었으면 좋겠어' }],
  userDirective: '예산은 빼고 봐줘',
};

describe('buildSystemPrompt', () => {
  it('GPT-OSS는 ChatGPT가 아니라고 분명히 말한다', () => {
    const s = buildSystemPrompt(base);
    expect(s).toContain('openai/gpt-oss-120b');
    expect(s).toContain('GroqCloud');
    expect(s).toContain('ChatGPT가 아니');
  });

  it('선택된 사고 기법을 지시문에 넣는다', () => {
    expect(buildSystemPrompt(base)).toContain('반대편에 세우기');
  });

  it('사회자는 발언자를 대신하지 않는다', () => {
    const s = buildSystemPrompt({ ...base, role: 'moderator' });
    expect(s).toContain('대신하지 않고');
  });
});

describe('buildUserPrompt', () => {
  it('사용자 지시를 최우선으로 넣는다', () => {
    const u = buildUserPrompt(base);
    expect(u).toContain('[사용자 최우선 지시]');
    expect(u).toContain('예산은 빼고 봐줘');
  });

  it('기억·대화록·진행 표기를 담는다', () => {
    const u = buildUserPrompt(base);
    expect(u).toContain('노즐 막힘');
    expect(u).toContain('1/5번째');
    expect(u).toContain('공정혁신 전문가');
  });

  it('최종 정리는 5개 항목 형식을 요구한다', () => {
    const u = buildUserPrompt({ ...base, role: 'moderator', phase: 'summary' });
    expect(u).toContain('결론 한 문장');
    expect(u).toContain('사용자가 지금 할 행동 1개');
  });

  it('긴 입력을 잘라 프롬프트가 무한정 커지지 않는다', () => {
    const u = buildUserPrompt({ ...base, topic: '가'.repeat(5000), transcript: [{ author: '나', text: '나'.repeat(3000) }] });
    expect(u.length).toBeLessThan(3000);
  });
});
