import { MEETING_TUNING } from '../config/meeting';

/** 설정 화면에서 고를 수 있는 AI 발언 수. 저장된 값이 이 밖이면 가까운 값으로 맞춘다. */
export const MAX_TURN_CHOICES: readonly number[] = [3, 5, 7];

export function normalizeMaxTurns(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : MEETING_TUNING.defaultMaxTurns;
  return MAX_TURN_CHOICES.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), MAX_TURN_CHOICES[1]);
}
