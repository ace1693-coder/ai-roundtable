import type { AiId, ChatMessage, Meeting, MemoryItem } from './types';
import { PARTICIPANTS, authorName } from './participants';
import { formatTime } from './format';
import { parseMentions, stripMentions } from './mentions';

function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function memoryBlock(memories: MemoryItem[]): string {
  if (!memories.length) return '- (이 주제로 불러온 기억 없음)';
  return memories
    .map((m) => `- [${m.status}] ${m.title} — ${clip(m.body, 260)}${m.tags.length ? ` (태그: ${m.tags.join(', ')})` : ''}`)
    .join('\n');
}

function transcript(messages: ChatMessage[], displayName: string): string {
  const rows = messages
    .filter((m) => !m.deleted && m.text.trim())
    .slice(-12)
    .map((m) => {
      const who = m.authorId === 'system' ? '규칙엔진' : authorName(m.authorId, displayName);
      const src = m.source === 'manual' ? ' (수동 입력)' : m.source === 'api' ? ' (API)' : '';
      return `${who}${src} [${formatTime(m.createdAt)}]: ${clip(m.text, 400)}`;
    });
  return rows.length ? rows.join('\n') : '(아직 대화 없음)';
}

/**
 * 수동 릴레이용 턴 프롬프트.
 * 게스트 AI는 무상태이므로 앱이 회의 맥락(역할·기억·최근 대화·이번 지시)을 매번 다시 넣는다.
 */
export function buildTurnPrompt(
  meeting: Meeting,
  target: AiId,
  memories: MemoryItem[],
  displayName = '나',
): string {
  const role = meeting.roles[target];

  const last = meeting.messages.filter((m) => !m.deleted).slice(-1)[0];
  const lastIsUser = last?.authorId === 'me';
  const mentioned = lastIsUser ? parseMentions(last.text) : { targets: [], all: false };
  const userText = lastIsUser ? stripMentions(last.text) : '';

  const instruction = lastIsUser
    ? `사용자가 방금 말했다: "${clip(userText, 600)}"${
        mentioned.targets.length ? ` (지정 대상: ${mentioned.targets.map((t) => PARTICIPANTS[t].name).join(', ')})` : ''
      }\n→ 이 메시지에 최우선으로 답한 뒤, 네 역할 관점에서 회의 흐름으로 자연스럽게 돌아가라.`
    : last
      ? `직전 발언(${last.authorId === 'system' ? '규칙 엔진' : authorName(last.authorId, displayName)})을 읽고, 동의·반박·근거 요청·대안 중 네 역할에 맞는 방식으로 이어가라.`
      : '회의 첫 발언이다. 주제를 네 역할 관점에서 정의하고, 쟁점 2~3개와 확인이 필요한 것을 제시하라.';

  return [
    `너는 'AI Roundtable' 회의 참가자 ${PARTICIPANTS[target].name}이다. 지금 역할: ${role}.`,
    '이 회의는 ChatGPT·Gemini·Pickle·사용자 4명이 한 단체 채팅방에서 반말로 토론한다. 너는 이전 대화를 기억하지 못하는 새 세션이므로, 앱이 저장한 아래 맥락만 근거로 판단하라.',
    '',
    `[회의 주제] ${meeting.topic}`,
    `[분야] ${meeting.domain}`,
    '[참가자 역할]',
    `- 나(사용자): 회의를 소유한 사람. 언제든 끼어들 수 있고 그 말이 최우선이다.`,
    `- ChatGPT: ${meeting.roles.chatgpt}`,
    `- Gemini: ${meeting.roles.gemini}`,
    `- Pickle: ${meeting.roles.pickle}`,
    '',
    '[불러온 기억]',
    memoryBlock(memories),
    '',
    '[최근 대화 — 앱이 저장한 실제 발언]',
    transcript(meeting.messages, displayName),
    '',
    '[이번 턴]',
    instruction,
    '',
    '[답변 규칙]',
    '- 카카오톡 단체방에서 친구에게 말하듯 자연스러운 반말. 의미 없는 인사·잡담 금지.',
    '- 네 역할 관점을 유지하고, 다른 참가자 이름을 직접 부르며 동의/반박할 수 있다.',
    '- 확인된 사실과 추측을 구분해서 말하고, 모르는 수치·성능·비용을 지어내지 마라.',
    '- 300~600자로 압축. 마지막 줄에 `지식후보: 유형|한 줄` 1개(유형=사실/기술/반증/조건/아이디어/실패/중복). 없으면 `지식후보: 없음`.',
    '- 이 프롬프트는 사용자가 게스트 웹에 붙여넣기 위한 것이다. 앱이 자동 호출한 것이 아니며, 답변은 사용자가 앱에 붙여넣어 등록한다.',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}

export function buildSummaryPrompt(meeting: Meeting, memories: MemoryItem[], displayName = '나'): string {
  return [
    '아래는 카카오톡형 AI 회의 앱에 저장된 실제 발언 기록이다. 이 기록만 근거로 회의를 정리하라.',
    '기록에 없는 내용을 만들지 말고, 확인된 사실과 추측을 구분하라.',
    '',
    `[주제] ${meeting.topic}`,
    `[참가자 역할] ChatGPT: ${meeting.roles.chatgpt} / Gemini: ${meeting.roles.gemini} / Pickle: ${meeting.roles.pickle}`,
    '[불러온 기억]',
    memoryBlock(memories),
    '',
    '[전체 대화]',
    transcript(meeting.messages, displayName),
    '',
    '[출력]',
    '1. 결론 한 문장',
    '2. 합의된 것',
    '3. 아직 갈린 쟁점',
    '4. 확인이 필요한 것(근거 없는 수치는 쓰지 말 것)',
    '5. 사용자가 지금 할 1가지',
  ].join('\n');
}
