import type { AiId } from './types';
import { AI_IDS } from './types';

/** "@이름" 멘션 별칭. 문장 어디에 있어도 인식한다. */
const ALIASES: Record<string, AiId | 'all'> = {
  chatgpt: 'chatgpt',
  챗지피티: 'chatgpt',
  챗gpt: 'chatgpt',
  gpt: 'chatgpt',
  gemini: 'gemini',
  제미나이: 'gemini',
  제미니: 'gemini',
  pickle: 'pickle',
  피클: 'pickle',
  전체: 'all',
  모두: 'all',
  all: 'all',
};

/** 어절에 조사가 붙어도(@Gemini가) 별칭을 찾도록 긴 별칭부터 접두 일치로 본다. */
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

function lookupAlias(word: string): AiId | 'all' | undefined {
  const lower = word.toLowerCase();
  for (const key of ALIAS_KEYS) {
    if (lower === key || lower.startsWith(key)) return ALIASES[key];
  }
  return undefined;
}

export interface MentionParse {
  targets: AiId[];
  /** 사용자가 @전체를 썼는지 */
  all: boolean;
}

export function parseMentions(text: string): MentionParse {
  const out: AiId[] = [];
  let all = false;
  const re = /@([A-Za-z가-힣]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const hit = lookupAlias(m[1]);
    if (!hit) continue;
    if (hit === 'all') {
      all = true;
      for (const id of AI_IDS) if (!out.includes(id)) out.push(id);
    } else if (!out.includes(hit)) {
      out.push(hit);
    }
  }
  return { targets: all ? [...AI_IDS] : out, all };
}

/** 커서 바로 앞에 "@질의"가 있으면 자동완성 후보를 띄운다. */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const between = before.slice(at + 1);
  if (/\s/.test(between)) return null;
  return { query: between, start: at };
}

export const MENTION_OPTIONS: { id: AiId | 'all'; label: string; insert: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT', insert: '@ChatGPT ' },
  { id: 'gemini', label: 'Gemini', insert: '@Gemini ' },
  { id: 'pickle', label: 'Pickle', insert: '@Pickle ' },
  { id: 'all', label: '전체', insert: '@전체 ' },
];

export function filterMentionOptions(query: string) {
  const q = query.toLowerCase();
  if (!q) return MENTION_OPTIONS;
  return MENTION_OPTIONS.filter(
    (o) => o.label.toLowerCase().includes(q) || o.id.includes(q) || (q === '전' && o.id === 'all'),
  );
}

/** 멘션된 AI를 지운 본문(프롬프트·표시에 쓸 때) */
export function stripMentions(text: string): string {
  return text.replace(/@([A-Za-z가-힣]+)/g, (whole, word: string) => {
    return lookupAlias(word) ? '' : whole;
  }).replace(/\s{2,}/g, ' ').trim();
}
