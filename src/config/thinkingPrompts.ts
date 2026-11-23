/**
 * 9가지 사고 프롬프트의 앱 쪽 진입점.
 * 실제 데이터·선택 로직은 프런트엔드와 Worker가 함께 쓰는 `shared/thinking.ts`에 있다.
 */
export {
  THINKING_PROMPTS,
  selectThinkingPrompts,
  renderThinkingBlock,
  type ThinkingPrompt,
} from '../../shared/thinking';

/** 이 앱의 AI 회의 공통 규칙(사용자가 2026-11-22에 확정). */
export const THINKING_COMMON_RULES = {
  selectOnlyRelevant: true,
  preserveUserGoalsAndConstraints: true,
  distinguishFactsFromSpeculation: true,
  prioritizeAccuracyPracticalityCostEffectiveness: true,
  aiMeetingRules: {
    includeSelectedTechniquesInPrompt: true,
    requireIndependentOpinions: true,
    crossVerifyClaimsAndEvidence: true,
    /** 매 호출이 새 세션이므로 앱이 매번 맥락을 다시 넣는다. */
    assumeFreshSessionEveryTime: true,
    language: 'ko-banmal',
  },
} as const;
