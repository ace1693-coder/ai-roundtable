/**
 * 9가지 사고 프롬프트 — 프런트엔드와 Cloudflare Worker가 함께 쓰는 단일 원본.
 * 사용자가 2026-11-22 21:38에 지정한 기법을 그대로 옮겼고, 주제에 맞는 것만 골라 쓴다.
 */

export interface ThinkingPrompt {
  id: number;
  key: string;
  title: string;
  instruction: string;
  bestForDomains: string[];
  keywords: string[];
}

export const THINKING_PROMPTS: ThinkingPrompt[] = [
  {
    id: 1,
    key: 'clarify_first',
    title: '먼저 되묻게 하기',
    instruction: '정확한 답변에 반드시 필요한 정보가 부족하면 핵심 질문 3개 이내로 확인하기.',
    bestForDomains: ['all'],
    keywords: ['모호', '조건', '정보부족', '미정', '확인'],
  },
  {
    id: 2,
    key: 'devils_advocate',
    title: '반대편에 세우기',
    instruction: '계획에 대한 강력한 반론 5개와 각각의 대응책 제시하기.',
    bestForDomains: ['business', 'investment', 'manufacturing', 'tech', 'appdev'],
    keywords: ['계획', '전략', '사업', '투자', '도입', '런칭', '판매', '개선', '출시'],
  },
  {
    id: 3,
    key: 'backward_from_deadline',
    title: '마감일에서 거꾸로',
    instruction: '목표와 마감일을 기준으로 역산해 일정·점검일·병목 구간 정리하기.',
    bestForDomains: ['manufacturing', 'appdev', 'learning', 'health'],
    keywords: ['마감', '일정', '기한', '준비', '발표', '제출', '프로젝트', '평가', '까지'],
  },
  {
    id: 4,
    key: 'ten_year_veteran',
    title: '10년 차의 눈',
    instruction: '해당 분야 숙련자의 관점에서 초보자의 실수와 개선점 3가지 찾기.',
    bestForDomains: ['manufacturing', 'business', 'appdev'],
    keywords: ['설비', '공정', '품질', '개발', '코드', '운영', '디자인', '실무', '조립', '테스트'],
  },
  {
    id: 5,
    key: 'decision_matrix',
    title: '비교표로 결정하기',
    instruction: '비용·시간·위험·되돌릴 가능성을 비교하고 최적의 선택 추천하기.',
    bestForDomains: ['business', 'appdev', 'general'],
    keywords: ['비교', '선택', '대안', '요금제', '구매', '구독', '도구', '비용', '추천', '어떤'],
  },
  {
    id: 6,
    key: 'overlooked_opportunities',
    title: '남들이 놓친 기회',
    instruction: '사람들이 잘 시도하지 않지만 가치가 있을 수 있는 기회 5개 발굴하기.',
    bestForDomains: ['business', 'general'],
    keywords: ['기회', '아이디어', '차별화', '틈새', '수익', '마케팅', '유입', '콘텐츠'],
  },
  {
    id: 7,
    key: 'seven_day_practice',
    title: '7일 만에 써먹기',
    instruction: '하루 30분 기준의 7일 실습 계획과 매일 확인 문제 1개 만들기.',
    bestForDomains: ['learning', 'appdev'],
    keywords: ['공부', '학습', '실습', '연습', '익히기', '입문', '기초', '세미나'],
  },
  {
    id: 8,
    key: 'unbreakable_habit',
    title: '무너지지 않는 습관',
    instruction: '최소 실행 방법·기록 방법·실패 후 재시작 규칙 설계하기.',
    bestForDomains: ['health', 'learning', 'general'],
    keywords: ['습관', '루틴', '운동', '스트레칭', '다이어트', '매일', '지속', '꾸준'],
  },
  {
    id: 9,
    key: 'action_over_summary',
    title: '요약 말고 행동',
    instruction: '문서에서 즉시 실행할 행동 3개와 놓치면 손해 보는 내용 3개 추출하기.',
    bestForDomains: ['general', 'manufacturing', 'business'],
    keywords: ['문서', '요약', '정리', '계약', '약관', '보고서', '매뉴얼', '자료', '분석'],
  },
];

/** 아무 기법도 걸리지 않을 때 쓰는 기본값 — 토론에 가장 무난한 두 가지. */
const DEFAULT_KEYS = ['devils_advocate', 'action_over_summary'];

/**
 * 주제·분야로 기법을 자동 선택한다. 전부 넣으면 지시문만 길어져 모델이 얕게 훑으므로
 * 최대 limit(기본 2)개만 고른다.
 */
export function selectThinkingPrompts(topic: string, domain: string, limit = 2): ThinkingPrompt[] {
  const text = `${topic} ${domain}`.toLowerCase();
  const scored = THINKING_PROMPTS.map((p) => {
    let keywordHits = 0;
    for (const k of p.keywords) {
      if (k && text.includes(k.toLowerCase())) keywordHits += 1;
    }
    // 분야만 같다는 이유로 기법을 끌어오지 않는다. 키워드가 걸린 것 중에서 분야가 맞으면 앞세운다.
    const domainBonus = p.bestForDomains.includes(domain) ? 1 : 0;
    return { p, keywordHits, score: keywordHits * 3 + domainBonus };
  })
    .filter((s) => s.keywordHits > 0)
    .sort((a, b) => b.score - a.score || a.p.id - b.p.id);

  if (scored.length === 0) {
    return DEFAULT_KEYS.map((k) => THINKING_PROMPTS.find((p) => p.key === k)!).filter(Boolean).slice(0, limit);
  }
  return scored.slice(0, limit).map((s) => s.p);
}

/** 모델 지시문에 넣는 형태. 선택된 기법이 없으면 빈 문자열을 돌려준다(빈 머리말을 만들지 않는다). */
export function renderThinkingBlock(prompts: { title: string; instruction: string }[]): string {
  if (!prompts.length) return '';
  return ['[이번 주제에 자동 선택된 사고 기법 — 이 방식으로 답해라]']
    .concat(prompts.map((p, i) => `${i + 1}. ${p.title}: ${p.instruction}`))
    .join('\n');
}
