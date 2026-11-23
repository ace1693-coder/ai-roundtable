import { describe, expect, it } from 'vitest';
import { analyzeTopic } from './topics';

describe('analyzeTopic', () => {
  it('제조 주제는 제조 역할을 배정한다', () => {
    const a = analyzeTopic('코팅 공정 불량 개선 회의');
    expect(a.domain).toBe('manufacturing');
    expect(a.roles.gptoss).toBe('공정혁신 전문가');
    expect(a.roles.gemini).toBe('설비·품질·안전 검증 전문가');
    expect(a.roles.moderator).toBe('생산성·원가절감 사회자');
  });

  it('사업 주제는 사업 역할을 배정한다', () => {
    const a = analyzeTopic('디지털 상품 판매 수익 구조');
    expect(a.domain).toBe('business');
    expect(a.roles.gemini).toBe('시장성 검증 전문가');
  });

  it('앱 개발 주제는 PM/QA 역할을 배정한다', () => {
    const a = analyzeTopic('PWA 앱 설계와 배포');
    expect(a.domain).toBe('appdev');
    expect(a.roles.gptoss).toBe('제품기획/아키텍트');
    expect(a.roles.gemini).toBe('QA/보안/예외상황 검토자');
  });

  it('건강 주제', () => {
    const a = analyzeTopic('수면과 운동 습관');
    expect(a.domain).toBe('health');
    expect(a.roles.moderator).toBe('실천계획 정리 담당');
  });

  it('키워드가 없으면 일반 역할', () => {
    const a = analyzeTopic('오늘 기분');
    expect(a.domain).toBe('general');
    expect(a.roles.gptoss).toBe('전략 분석가');
  });
});
