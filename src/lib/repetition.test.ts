import { describe, expect, it } from 'vitest';
import { checkRepeat, jaccard, similarity } from './repetition';

describe('similarity', () => {
  it('같은 문장은 1에 가깝다', () => {
    const s = '코팅 공정의 불량 원인을 먼저 측정해야 한다';
    expect(similarity(s, s)).toBeCloseTo(1, 5);
  });

  it('조사만 다른 반복 발언을 잡아낸다', () => {
    const a = '코팅 공정 불량 원인을 먼저 측정해서 병목을 확정하자';
    const b = '코팅 공정의 불량 원인을 먼저 측정하고 병목을 확정해야 해';
    expect(similarity(a, b)).toBeGreaterThan(0.6);
  });

  it('다른 주제는 낮다', () => {
    const a = '코팅 공정 불량 원인을 먼저 측정해서 병목을 확정하자';
    const b = '가격을 올리면 전환율이 떨어질 수 있으니 소액으로 실험하자';
    expect(similarity(a, b)).toBeLessThan(0.3);
  });

  it('짧은 동의 발언은 1.0으로 과대평가하지 않는다', () => {
    expect(similarity('좋아', '좋아')).toBeLessThanOrEqual(0.85);
  });
});

describe('jaccard', () => {
  it('빈 배열은 0', () => {
    expect(jaccard([], ['a'])).toBe(0);
  });
});

describe('checkRepeat', () => {
  it('임계값 이상이면 반복으로 표시하고 위치를 돌려준다', () => {
    const prev = ['다른 말', '코팅 공정의 불량 원인을 먼저 측정하고 병목을 확정해야 한다'];
    const r = checkRepeat('코팅 공정의 불량 원인을 먼저 측정하고 병목을 확정해야 한다', prev);
    expect(r.repeated).toBe(true);
    expect(r.matchedIndex).toBe(1);
  });

  it('관계없는 발언은 반복이 아니다', () => {
    const r = checkRepeat('PWA 캐시 전략은 앱셸 선캐시로 간다', ['가격 실험을 소액으로 하자']);
    expect(r.repeated).toBe(false);
  });
});
