import type { Meeting } from './types';
import { AI_IDS } from './types';
import { PARTICIPANTS } from './participants';
import { formatDateTime } from './format';
import { aiMessages } from './meetingEngine';

/**
 * Worker에 닿지 못했을 때만 쓰는 대체 요약. AI가 쓴 것처럼 보이면 안 되므로
 * 머리에 '앱이 만든 기록 요약'임을 박고, 확인되지 않은 결론은 만들지 않는다.
 */
export function buildLocalSummary(meeting: Meeting): string {
  const ai = aiMessages(meeting);
  const lastUser = meeting.messages.filter((m) => m.authorId === 'me' && !m.deleted).slice(-1)[0];
  const counts = AI_IDS.map((id) => `${PARTICIPANTS[id].name} ${ai.filter((m) => m.authorId === id).length}`).join(' / ');
  const recent = ai.slice(-4);

  return [
    '[기록 요약 · AI 요약 아님 · 앱이 저장된 발언만 정리]',
    `주제: ${meeting.topic}`,
    `기간: ${formatDateTime(meeting.createdAt)} ~ ${formatDateTime(Date.now())}`,
    `AI 발언 수: ${counts}`,
    lastUser ? `마지막 사용자 요청: "${lastUser.text.replace(/\s+/g, ' ').slice(0, 200)}"` : '사용자 발언: 없음',
    '',
    '최근 AI 발언 발췌:',
    ...(recent.length ? recent.map((m) => `- ${PARTICIPANTS[m.authorId as 'gptoss'].name}: ${m.text.replace(/\s+/g, ' ').slice(0, 120)}`) : ['- (없음)']),
    '',
    '결론·합의는 위 발췌에 근거가 있을 때만 읽어야 한다. AI 사회자의 최종 정리를 받으려면 Worker 연결을 확인하고 회의를 다시 이어가라.',
  ].join('\n');
}
