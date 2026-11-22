import type { Domain, Meeting, MemoryItem, MemoryStatus, MemoryType, Settings } from './types';
import { MEMORY_STATUSES, MEMORY_TYPES } from './types';
import { wordTokens } from './repetition';
import { MEETING_TUNING } from '../config/meeting';

/** 설정 화면에서 고를 수 있는 AI 발언 수. 저장된 값이 이 밖이면 가까운 값으로 맞춘다. */
export const MAX_TURN_CHOICES: readonly number[] = [3, 5, 7];

export function normalizeMaxTurns(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : MEETING_TUNING.defaultMaxTurns;
  return MAX_TURN_CHOICES.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), MAX_TURN_CHOICES[1]);
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function createMemory(input: {
  title: string;
  body: string;
  status: MemoryStatus;
  type: MemoryType;
  tags?: string[];
  sourceMeetingId?: string;
}): MemoryItem {
  const now = Date.now();
  return {
    id: newId('mem'),
    title: input.title.trim(),
    body: input.body.trim(),
    status: input.status,
    type: input.type,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    sourceMeetingId: input.sourceMeetingId,
    createdAt: now,
    updatedAt: now,
  };
}

export interface MemoryMatch {
  item: MemoryItem;
  score: number;
  reasons: string[];
}

/** 새 회의 주제와 관련된 기억만 골라 온다. 폐기된 정보는 참고용으로만 넣고 점수를 낮춘다. */
export function matchMemories(topic: string, memories: MemoryItem[], limit = 5): MemoryMatch[] {
  const topicTokens = new Set(wordTokens(topic));
  const charSource = topic.replace(/\s/g, '');
  if (topicTokens.size === 0 && charSource.length === 0) return [];

  const scored: MemoryMatch[] = memories.map((item) => {
    let score = 0;
    const reasons: string[] = [];
    for (const tag of item.tags) {
      const t = tag.toLowerCase().replace(/\s/g, '');
      if (!t) continue;
      if (charSource.includes(t) || topicTokens.has(tag.toLowerCase())) {
        score += 3;
        reasons.push(`태그 ${tag}`);
      }
    }
    const bodyTokens = new Set(wordTokens(`${item.title} ${item.body}`));
    let overlap = 0;
    topicTokens.forEach((tok) => {
      if (bodyTokens.has(tok)) overlap += 1;
    });
    if (overlap > 0) {
      score += Math.min(overlap, 4);
      reasons.push(`본문 키워드 ${overlap}개`);
    }
    if (item.status === '폐기된 정보') score -= 2;
    if (item.status === '검증된 사실') score += 1;
    return { item, score, reasons };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .slice(0, limit);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** JSON 가져오기 전 검사. 하나라도 형식이 틀리면 전체를 거부하고 기존 데이터를 그대로 둔다. */
export function parseMemoryImport(raw: string): MemoryItem[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('JSON 형식이 아닙니다.');
  }
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.memories) ? data.memories : null;
  if (!list) throw new Error('기억 목록(memories 배열)을 찾지 못했습니다.');
  return list.map((row, i) => {
    if (!isObj(row)) throw new Error(`${i + 1}번째 항목이 객체가 아닙니다.`);
    const { title, body, status, type } = row;
    if (typeof title !== 'string' || !title.trim()) throw new Error(`${i + 1}번째 항목의 title이 비었습니다.`);
    if (typeof body !== 'string') throw new Error(`${i + 1}번째 항목의 body가 문자열이 아닙니다.`);
    if (!MEMORY_STATUSES.includes(status as MemoryStatus)) throw new Error(`${i + 1}번째 항목의 status 값이 허용되지 않습니다.`);
    if (!MEMORY_TYPES.includes(type as MemoryType)) throw new Error(`${i + 1}번째 항목의 type 값이 허용되지 않습니다.`);
    const tags = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [];
    return {
      id: typeof row.id === 'string' && row.id ? row.id : newId('mem'),
      title: title.trim(),
      body,
      status: status as MemoryStatus,
      type: type as MemoryType,
      tags,
      sourceMeetingId: typeof row.sourceMeetingId === 'string' ? row.sourceMeetingId : undefined,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
    };
  });
}

export function parseMeetingsImport(raw: string): Meeting[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('JSON 형식이 아닙니다.');
  }
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.meetings) ? data.meetings : null;
  if (!list) throw new Error('회의 목록(meetings 배열)을 찾지 못했습니다.');
  return list.map((row, i) => {
    if (!isObj(row)) throw new Error(`${i + 1}번째 회의가 객체가 아닙니다.`);
    if (typeof row.title !== 'string' || !row.title.trim()) throw new Error(`${i + 1}번째 회의의 제목이 비었습니다.`);
    if (!Array.isArray(row.messages)) throw new Error(`${i + 1}번째 회의에 messages 배열이 없습니다.`);
    const roles = isObj(row.roles) ? row.roles : {};
    return {
      id: typeof row.id === 'string' && row.id ? row.id : newId('mt'),
      title: row.title.trim(),
      topic: typeof row.topic === 'string' ? row.topic : row.title.trim(),
      domain: (['manufacturing', 'business', 'appdev', 'health', 'general'] as Domain[]).includes(row.domain as Domain)
        ? (row.domain as Domain)
        : 'general',
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
      roles: {
        // 예전 버전(chatgpt/pickle)으로 저장된 회의도 새 참가자 이름으로 옮긴다.
        gptoss: pickRole(roles, 'gptoss', 'chatgpt', '전략 분석가'),
        gemini: pickRole(roles, 'gemini', 'gemini', '검증 담당'),
        moderator: pickRole(roles, 'moderator', 'pickle', '사회자'),
      },
      maxTurns: normalizeMaxTurns(row.maxTurns),
      auto: row.auto !== false,
      status: row.status === 'paused' || row.status === 'ended' ? row.status : 'active',
      messages: row.messages as Meeting['messages'],
      queue: Array.isArray(row.queue) ? (row.queue as Meeting['queue']) : [],
      directiveSentId: typeof row.directiveSentId === 'string' ? row.directiveSentId : undefined,
      enabledAi: {
        gptoss: (row.enabledAi as Meeting['enabledAi'])?.gptoss !== false,
        gemini: (row.enabledAi as Meeting['enabledAi'])?.gemini !== false,
        moderator: (row.enabledAi as Meeting['enabledAi'])?.moderator !== false,
      },
      nextSpeaker:
        row.nextSpeaker === 'gptoss' || row.nextSpeaker === 'gemini' || row.nextSpeaker === 'moderator' || row.nextSpeaker === 'done'
          ? row.nextSpeaker
          : undefined,
      awaitingDecision: row.awaitingDecision !== false,
      lastDecision: (row.lastDecision as Meeting['lastDecision']) ?? undefined,
      callCount: typeof row.callCount === 'number' && row.callCount >= 0 ? row.callCount : 0,
      endedReason: typeof row.endedReason === 'string' ? (row.endedReason as Meeting['endedReason']) : undefined,
      lastSpeaker: typeof row.lastSpeaker === 'string' ? (row.lastSpeaker as Meeting['lastSpeaker']) : undefined,
      usedMemoryIds: Array.isArray(row.usedMemoryIds) ? row.usedMemoryIds.filter((x): x is string => typeof x === 'string') : [],
      repeatWarnings: typeof row.repeatWarnings === 'number' ? row.repeatWarnings : 0,
      summary: typeof row.summary === 'string' ? row.summary : undefined,
    };
  });
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: '나',
  avatarEmoji: '',
  workerUrl: '',
  accessCode: '',
  maxTurns: MEETING_TUNING.defaultMaxTurns,
};

/** 새 키가 없으면 예전 키(chatgpt/pickle)에서 역할명을 가져온다. */
function pickRole(roles: Record<string, unknown>, key: string, legacy: string, fallback: string): string {
  const v = roles[key];
  if (typeof v === 'string' && v) return v;
  const old = roles[legacy];
  return typeof old === 'string' && old ? old : fallback;
}
