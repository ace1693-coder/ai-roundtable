import type { AiId } from '../lib/types';

/**
 * 자동 회의 운영 값. 모델명·턴 순서·호출 간격·요약 문턱처럼
 * 작업 A(개발회의) 결론에 따라 바뀔 수 있는 값은 전부 여기 모아 둔다.
 *
 * 무료 한도(Groq TPM 8K · Gemini RPM) 때문에 호출 간격은 실측으로 정한 값이다.
 * 간격을 줄이면 무료 한도 429가 잦아지고 회의가 중간에 멈춘다.
 */
export const MEETING_TUNING = {
  /** 발언 순서. 사용자가 @멘션으로 지정하면 그 대상이 이 순서보다 우선한다. */
  autoSequence: ['gptoss', 'gemini', 'moderator', 'gptoss', 'gemini', 'moderator'] as AiId[],
  /** 같은 제공업체를 연달아 부를 때 최소 간격(ms) */
  callGapMs: { gptoss: 20_000, gemini: 5_000 },
  /**
   * 회의당 호출 예산(개발 시험값). 전략회의 확정대로 '고정 라운드 제한'이 아니라
   * 비용 안전장치다. 닿으면 회의를 정리하고 멈춘다. 실측 후 조정한다.
   */
  maxCallsPerMeeting: 20,
  /** 회의방을 만들 때 표시용 기본값(고정 상한으로 쓰지 않는다) */
  defaultMaxTurns: 5,
  /** 모델에 넘기는 최근 대화 줄 수 */
  transcriptLines: 6,
  /** 모델에 넘기는 관련 기억 수 */
  memoryLimit: 3,
} as const;

export type MeetingTuning = typeof MEETING_TUNING;

/**
 * 회의당 호출 예산. 자동 E2E 가 `airt3.test.budget` 으로만 늘릴 수 있고
 * 사람이 쓰는 기본값은 항상 MEETING_TUNING.maxCallsPerMeeting 이다.
 */
export function callBudget(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('airt3.test.budget') : null;
    const v = Number(raw);
    if (raw !== null && Number.isFinite(v) && v > 0) return Math.floor(v);
  } catch {
    /* 저장소를 못 읽으면 기본값 */
  }
  return MEETING_TUNING.maxCallsPerMeeting;
}
