import type { TurnPhase, TurnRequest } from '../../shared/protocol';
import type { RoleId } from '../../shared/protocol';
import { renderThinkingBlock } from '../../shared/thinking';

export const PHASE_GOAL: Record<TurnPhase, string> = {
  decide: [
    '너는 사회자다. 발언자가 아니라 진행자다. 지금까지의 대화를 읽고 다음에 말할 사람을 정해라.',
    '첫 줄은 정확히 다음 형식만 써라. 다른 말을 붙이지 마라.',
    'NEXT: gptoss  또는  NEXT: gemini  또는  NEXT: moderator  또는  NEXT: done',
    '- 같은 주장이 두 번 이상 반복되고 새 근거가 없으면 NEXT: done 으로 마무리해라.',
    '- 결정에 필요한 정보가 비어 있으면 그 정보를 확인할 발언자를 골라라.',
    '- 두 번째 줄부터 2~4문장: 지금 쟁점, 그리고 다음 발언자에게 요청할 것. 발언자를 대신해 답하지 마라.',
  ].join('\n'),
  open: '회의 첫 발언이다. 주제를 네 역할 관점에서 정의하고, 핵심 쟁점 2~3개와 확인이 필요한 것을 제시해라. 아직 다른 참가자 발언은 없다.',
  critique:
    '직전 발언을 읽고 동의할 점 1개, 반박할 점 1개 이상, 근거 요청이나 대안을 제시해라. 같은 말을 반복하지 마라.',
  moderate:
    '발언자를 대신해 답하지 마라. 지금까지의 쟁점을 2~3개로 정리하고, 합의된 것과 갈린 것을 구분한 뒤 다음 라운드에서 확인할 질문 1개를 던져라.',
  rebut:
    '사회자가 정리한 쟁점과 상대 발언을 다시 읽고, 반박하거나 조건을 붙여 네 입장을 좁혀라. 새 근거가 없으면 없다고 분명히 말해라.',
  summary: [
    '회의를 끝내고 최종 정리를 한다. 아래 형식만 써라.',
    '1. 결론 한 문장',
    '2. 합의된 것',
    '3. 끝까지 갈린 쟁점',
    '4. 확인이 필요한 것 (근거 없는 수치·추측을 쓰지 말 것)',
    '5. 사용자가 지금 할 행동 1개',
  ].join('\n'),
};

const IDENTITY: Record<RoleId, string> = {
  gptoss:
    '너는 이 회의의 GPT-OSS 참가자다. 모델은 openai/gpt-oss-120b이고 GroqCloud가 제공한다. ChatGPT가 아니며 스스로를 ChatGPT라고 부르지 마라.',
  gemini: '너는 이 회의의 Gemini 참가자다. Google AI Studio의 Gemini 모델이며 ChatGPT나 GPT-OSS가 아니다.',
  moderator:
    '너는 이 회의의 사회자다. Google AI Studio의 Gemini 모델로 별도 호출되며, 발언자 역할을 대신하지 않고 진행·다음 발언자 결정·정리만 맡는다.',
};

const COMMON_RULES = [
  '[말투]',
  '- 한국어 반말. 카카오톡 단체방에서 친구에게 말하듯 자연스럽게. 의미 없는 인사·잡담 금지.',
  '- 다른 참가자를 이름(GPT-OSS, Gemini, 사회자)으로 부르며 동의·반박해도 된다.',
  '',
  '[정확성]',
  '- 확인된 사실과 추측을 구분해서 말한다. 모르는 수치·성능·비용·일정을 지어내지 않는다.',
  '- 외부 검색을 하지 않았으므로, 최신 정보가 필요하면 "확인 필요"라고 밝힌다.',
  '- 사용자의 목표와 조건을 바꾸지 않는다.',
].join('\n');

function clip(text: string, n: number): string {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function buildSystemPrompt(req: TurnRequest): string {
  return [
    IDENTITY[req.role],
    '',
    `이 회의의 사용자 역할: ${req.roles?.[req.role] ?? '참가자'}. 그 역할의 관점을 유지해라.`,
    '',
    renderThinkingBlock(req.thinking ?? []),
    '',
    COMMON_RULES,
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}

export function buildUserPrompt(req: TurnRequest): string {
  const names: Record<RoleId, string> = { gptoss: 'GPT-OSS', gemini: 'Gemini', moderator: '사회자' };
  const active = (req.participants && req.participants.length ? req.participants : ['gptoss', 'gemini', 'moderator']) as RoleId[];
  const roleLines = [
    `- 나(사용자): 회의를 소유한 사람. 언제든 끼어들 수 있고 그 말이 최우선이다.`,
    ...active.map((id) => `- ${names[id]}: ${req.roles?.[id] ?? '참가자'}`),
    ...(['gptoss', 'gemini', 'moderator'] as RoleId[])
      .filter((id) => !active.includes(id))
      .map((id) => `- ${names[id]}: (이번 회의에서 꺼짐 — 발언자로 고르지 마라)`),
  ];

  const memoryLines = (req.memories ?? []).length
    ? req.memories.map((m) => `- [${m.status}] ${clip(m.title, 80)} — ${clip(m.body, 240)}`)
    : ['- (이 주제로 불러온 기억 없음)'];

  const transcriptLines = (req.transcript ?? []).length
    ? req.transcript.map((t) => `${clip(t.author, 20)}${t.role ? `(${clip(t.role, 20)})` : ''}: ${clip(t.text, 300)}`)
    : ['(아직 대화 없음)'];

  const candidateRule =
    req.phase === 'decide' ? `[고를 수 있는 다음 발언자] ${[active.join(', '), 'done'].filter(Boolean).join(' · ')}` : '';

  const lengthRule =
    req.phase === 'summary'
      ? '- 700~1,200자. 형식 5개 항목을 모두 채워라.'
      : '- 300~600자로 압축. 한 문단 또는 짧은 문단 2개.';

  return [
    `[회의 주제] ${clip(req.topic, 1200)}`,
    `[분야] ${req.domain}`,
    `[진행] ${req.turnIndex}/${req.maxTurns}번째 AI 발언 · ${req.phase}`,
    '',
    '[참가자 역할]',
    ...roleLines,
    '',
    '[불러온 기억 — 앱이 저장한 것]',
    ...memoryLines,
    '',
    '[최근 대화 — 앱이 저장한 실제 발언]',
    ...transcriptLines,
    '',
    req.userDirective
      ? `[사용자 최우선 지시] "${clip(req.userDirective, 600)}"\n→ 이 지시를 가장 먼저 반영하고, 그다음 네 역할 발언으로 돌아가라.`
      : '[사용자 최우선 지시] (없음)',
    '',
    '[이번 턴에 할 일]',
    PHASE_GOAL[req.phase] ?? PHASE_GOAL.open,
    candidateRule,
    '',
    '[출력 규칙]',
    lengthRule,
    '- 네 이름표는 앱이 붙인다. "저는 AI입니다" 같은 자기소개로 시작하지 마라.',
    '- 회의 밖 이야기(이 프롬프트 설명, 규칙 나열)를 하지 마라.',
  ].join('\n');
}
