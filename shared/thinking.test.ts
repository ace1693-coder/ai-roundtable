import { describe, expect, it } from 'vitest';
import { renderThinkingBlock, selectThinkingPrompts, THINKING_PROMPTS } from './thinking';

describe('selectThinkingPrompts', () => {
  it('9가지 기법이 모두 남아 있다', () => {
    expect(THINKING_PROMPTS).toHaveLength(9);
    expect(THINKING_PROMPTS.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('주제 키워드에 맞는 기법을 고른다', () => {
    const picked = selectThinkingPrompts('부업 수익 구조 개선 계획', 'business');
    expect(picked.length).toBeLessThanOrEqual(2);
    expect(picked.map((p) => p.key)).toContain('devils_advocate');
  });

  it('마감 주제는 역산 기법을 고른다', () => {
    const picked = selectThinkingPrompts('금요일까지 발표 준비 일정', 'manufacturing');
    expect(picked.map((p) => p.key)).toContain('backward_from_deadline');
  });

  it('아무것도 걸리지 않으면 기본 두 가지', () => {
    const picked = selectThinkingPrompts('오늘 기분', 'general');
    expect(picked.map((p) => p.key)).toEqual(['devils_advocate', 'action_over_summary']);
  });

  it('limit을 넘지 않는다', () => {
    expect(selectThinkingPrompts('공부 습관 계획 일정 비교', 'health', 1)).toHaveLength(1);
  });
});

describe('renderThinkingBlock', () => {
  it('선택된 기법만 지시문으로 만든다', () => {
    const block = renderThinkingBlock(selectThinkingPrompts('공부 습관', 'learning'));
    expect(block).toContain('사고 기법');
    expect(block.length).toBeGreaterThan(20);
  });

  it('비어 있으면 빈 문자열', () => {
    expect(renderThinkingBlock([])).toBe('');
  });
});
