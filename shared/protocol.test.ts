import { describe, expect, it } from 'vitest';
import { parseDecisionLine } from './protocol';

describe('parseDecisionLine', () => {
  it('NEXT 표식을 떼고 decision 만 남긴다', () => {
    const out = parseDecisionLine('NEXT: gemini\n쟁점은 두 가지다. Gemini가 근거를 대라.');
    expect(out.decision).toEqual({ next: 'gemini' });
    expect(out.text).toBe('쟁점은 두 가지다. Gemini가 근거를 대라.');
  });

  it('done·종료 표기를 인식한다', () => {
    expect(parseDecisionLine('NEXT: done\n정리한다.').decision).toEqual({ next: 'done' });
    expect(parseDecisionLine('다음 발언자: 종료\n끝.').decision).toEqual({ next: 'done' });
  });

  it('후보에 없는 발언자는 버린다', () => {
    expect(parseDecisionLine('NEXT: moderator\n정리', ['gptoss', 'gemini']).decision).toBeUndefined();
    expect(parseDecisionLine('NEXT: moderator\n정리', ['gptoss', 'gemini']).text).toBe('정리');
  });

  it('표식이 없으면 decision 없이 본문만 돌려준다', () => {
    const out = parseDecisionLine('그냥 정리만 했다.');
    expect(out.decision).toBeUndefined();
    expect(out.text).toBe('그냥 정리만 했다.');
  });
});
