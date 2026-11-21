import type { Meeting } from './types';
import { AI_IDS } from './types';
import { PARTICIPANTS } from './participants';
import { formatDateTime } from './format';

/**
 * 종료 요약 — AI가 쓴 것처럼 보이면 안 되므로 로컬 규칙 엔진이 만든 초안임을 머리에 박는다.
 * 더 좋은 요약은 `buildSummaryPrompt`로 복사해 게스트 AI에 물어보고 붙여넣는다(출처: 수동 입력).
 */
export function buildLocalSummary(meeting: Meeting): string {
  const counts = { me: 0, chatgpt: 0, gemini: 0, pickle: 0 } as Record<string, number>;
  for (const m of meeting.messages) {
    if (m.deleted || m.source === 'local') continue;
    counts[m.authorId] = (counts[m.authorId] ?? 0) + 1;
  }
  const userMessages = meeting.messages.filter((m) => m.authorId === 'me' && !m.deleted);
  const lastUser = userMessages.slice(-1)[0];
  const aiMessages = meeting.messages.filter((m) => m.source !== 'local' && m.authorId !== 'me' && !m.deleted);
  const recent = aiMessages.slice(-4);
  const memoryNotes = meeting.messages.filter((m) => m.memoryId);

  const roles = AI_IDS.map((id) => `${PARTICIPANTS[id].name} · ${meeting.roles[id]}`).join(' / ');

  const lines = [
    '[로컬 요약 · 출처: 로컬 규칙 엔진]',
    `주제: ${meeting.topic}`,
    `역할: ${roles}`,
    `기간: ${formatDateTime(meeting.createdAt)} ~ ${formatDateTime(Date.now())}`,
    `발언 수: 나 ${counts.me ?? 0} / ChatGPT ${counts.chatgpt ?? 0} / Gemini ${counts.gemini ?? 0} / Pickle ${counts.pickle ?? 0}`,
    lastUser ? `마지막 사용자 요청: "${lastUser.text.replace(/\s+/g, ' ').slice(0, 200)}"` : '사용자 발언: 없음',
    '',
    '최근 쟁점(실제 발언에서 발췌):',
    ...(recent.length
      ? recent.map((m) => `- ${PARTICIPANTS[m.authorId as 'chatgpt'].name}: ${m.text.replace(/\s+/g, ' ').slice(0, 120)}`)
      : ['- (등록된 AI 발언 없음)']),
    '',
    `지식 저장소에 등록한 메시지: ${memoryNotes.length}건`,
    `불러온 기억: ${meeting.usedMemoryIds.length}건`,
    '남은 것: 위 발췌에 없는 결론은 저장된 발언에 근거가 없다. AI 요약이 필요하면 [요약 프롬프트 복사]로 게스트 AI에 물어보고 결과를 붙여넣어라(출처: 수동 입력).',
  ];
  return lines.join('\n');
}
