import type { AiId, Domain } from './types';

export interface TopicAnalysis {
  domain: Domain;
  label: string;
  roles: Record<AiId, string>;
}

interface DomainRule {
  domain: Domain;
  label: string;
  keywords: string[];
  roles: Record<AiId, string>;
}

/** 주제 키워드 → 분야 → AI별 전문가 역할. 사용자가 지정한 예시(제조/사업/앱개발/건강/일반)를 그대로 쓴다. */
export const DOMAIN_RULES: DomainRule[] = [
  {
    domain: 'manufacturing',
    label: '제조 공정 개선',
    keywords: ['제조', '공정', '설비', '품질', '생산', '조립', '불량', '코팅', '작업', '원가', '안전', '테스트'],
    roles: {
      gptoss: '공정혁신 전문가',
      gemini: '설비·품질·안전 검증 전문가',
      moderator: '생산성·원가절감 사회자',
    },
  },
  {
    domain: 'business',
    label: '사업·부업',
    keywords: ['사업', '부업', '수익', '판매', '매출', '마케팅', '고객', '가격', '상품', '창업', '크몽', '전환'],
    roles: {
      gptoss: '사업전략 전문가',
      gemini: '시장성 검증 전문가',
      moderator: '수익성·실행계획 관리자',
    },
  },
  {
    domain: 'appdev',
    label: '앱·웹 개발',
    keywords: ['앱', '웹', '개발', 'pwa', '리액트', 'react', '코드', '버그', 'api', 'ui', 'ux', '배포', '테스트', '설계'],
    roles: {
      gptoss: '제품기획/아키텍트',
      gemini: 'QA/보안/예외상황 검토자',
      moderator: 'PM/실행 총괄',
    },
  },
  {
    domain: 'health',
    label: '건강',
    keywords: ['건강', '운동', '다이어트', '병원', '통증', '수면', '식단', '스트레칭', '체중', '영양'],
    roles: {
      gptoss: '근거 정리 담당',
      gemini: '위험성/보수 검토 담당',
      moderator: '실천계획 정리 담당',
    },
  },
];

export const GENERAL_ANALYSIS: TopicAnalysis = {
  domain: 'general',
  label: '일반',
  roles: {
    gptoss: '전략 분석가',
    gemini: '검증 담당',
    moderator: '사회자',
  },
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function analyzeTopic(topic: string): TopicAnalysis {
  const t = normalize(topic);
  if (!t) return GENERAL_ANALYSIS;
  let best: { rule: DomainRule; score: number } | null = null;
  for (const rule of DOMAIN_RULES) {
    let score = 0;
    for (const k of rule.keywords) {
      if (t.includes(k.toLowerCase())) score += k.length >= 3 ? 2 : 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { rule, score };
  }
  if (!best) return GENERAL_ANALYSIS;
  return { domain: best.rule.domain, label: best.rule.label, roles: { ...best.rule.roles } };
}

/** 역할 짧은 표기: "ChatGPT · 제품기획/아키텍트"처럼 이름 옆에 붙인다. */
export function shortRole(role: string): string {
  return role.replace(/\s*전문가$/, '').trim();
}
