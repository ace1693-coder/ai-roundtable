/**
 * 저장된 데이터 정규화(스키마 복구).
 *
 * 왜 필요한가(2026-11-23 `Cannot read properties of undefined (reading 'gptoss')` 사고):
 * 회의·기억은 IndexedDB, 설정은 localStorage 에 저장되는데, 읽을 때 **정규화 없이 그대로** 화면에 넣었다.
 * 3.0 시절 기록은 `enabledAi`·`maxTurns`·`auto`·`callCount` 가 없고 참가자 키도 `chatgpt`/`pickle` 이다.
 * 그 상태에서 회의방 참가자 목록이 `meeting.enabledAi['gptoss']` 를 읽으면 곧바로 앱이 죽는다.
 *
 * 원칙
 * - **기존 데이터는 지우지 않는다.** 내용이 있는 값은 전부 보존하고, 빠진 필드만 기본값으로 채운다.
 * - 어떤 입력(undefined·null·문자열·숫자·깨진 객체)이 와도 예외를 던지지 않는다.
 * - 모르는 필드는 그대로 남긴다(이후 버전이 쓴 값을 이 버전이 지우지 않도록).
 */
import type {
  AiId,
  Attachment,
  ChatMessage,
  Domain,
  EndedReason,
  Meeting,
  MeetingStatus,
  MemoryItem,
  MemoryStatus,
  MemoryType,
  MessageAuthor,
  MessageSource,
  Settings,
} from './types';
import { AI_IDS, MEMORY_STATUSES, MEMORY_TYPES } from './types';
import { normalizeMaxTurns } from './turns';
import { GENERAL_ANALYSIS } from './topics';
import { MEETING_TUNING } from '../config/meeting';

type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

const DOMAINS: readonly Domain[] = ['manufacturing', 'business', 'appdev', 'health', 'general'];
const SOURCES: readonly MessageSource[] = ['user', 'manual', 'api', 'local'];
const ENDED_REASONS: readonly EndedReason[] = [
  'user',
  'moderator_done',
  'budget',
  'repeat',
  'all_disabled',
  'error',
  'sensitive',
];

/** 예전 참가자 이름(chatgpt/pickle)과 표기 흔들림을 지금 키로 옮긴다. */
const AI_ALIASES: Record<string, AiId> = {
  gptoss: 'gptoss',
  'gpt-oss': 'gptoss',
  gpt: 'gptoss',
  chatgpt: 'gptoss',
  'chat-gpt': 'gptoss',
  openai: 'gptoss',
  'open-ai': 'gptoss',
  gemini: 'gemini',
  google: 'gemini',
  moderator: 'moderator',
  pickle: 'moderator',
  피클: 'moderator',
  사회자: 'moderator',
};

export const DEFAULT_ROLES: Record<AiId, string> = { ...GENERAL_ANALYSIS.roles };

/** 어떤 표기가 와도 AI 키로 바꾼다. 모르는 값이면 undefined. */
export function toAiId(v: unknown): AiId | undefined {
  if (typeof v !== 'string') return undefined;
  const key = v.trim().toLowerCase();
  return AI_ALIASES[key] ?? (AI_IDS.includes(key as AiId) ? (key as AiId) : undefined);
}

/** 메시지 작성자. 모르는 이름은 'system'(앱 알림)으로 안전하게 떨어뜨린다. */
export function toAuthorId(v: unknown): MessageAuthor {
  const ai = toAiId(v);
  if (ai) return ai;
  if (typeof v === 'string') {
    const k = v.trim().toLowerCase();
    if (k === 'me' || k === 'user' || k === '나') return 'me';
  }
  return 'system';
}

/** 역할 이름 3종. 예전 키(chatgpt/pickle)도 읽는다. */
export function normalizeRoles(raw: unknown): Record<AiId, string> {
  const out: Record<AiId, string> = { ...DEFAULT_ROLES };
  if (!isObj(raw)) return out;
  const found: Partial<Record<AiId, string>> = {};
  for (const [key, value] of Object.entries(raw)) {
    const id = toAiId(key);
    if (!id || found[id]) continue;
    const name = str(value);
    if (name) found[id] = name;
  }
  for (const id of AI_IDS) if (found[id]) out[id] = found[id] as string;
  return out;
}

/** AI별 켜짐/꺼짐. 없으면 모두 켬(3.0 에는 이 개념이 없었다). */
export function normalizeEnabledAi(raw: unknown, legacyDisabled?: unknown): Record<AiId, boolean> {
  const src = isObj(raw) ? raw : {};
  const disabled = new Set(
    (Array.isArray(legacyDisabled) ? legacyDisabled : [])
      .map((v) => toAiId(v))
      .filter((v): v is AiId => Boolean(v)),
  );
  const out = {} as Record<AiId, boolean>;
  for (const id of AI_IDS) {
    const own = bool(src[id]);
    out[id] = own === undefined ? !disabled.has(id) : own;
  }
  return out;
}

function normalizeAttachment(raw: unknown): Attachment | undefined {
  if (!isObj(raw)) return undefined;
  const name = str(raw.name);
  if (!name) return undefined;
  const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : undefined;
  return {
    name,
    type: str(raw.type) ?? '',
    size: num(raw.size) ?? 0,
    ...(dataUrl ? { dataUrl } : {}),
  };
}

/** 말풍선 하나. 내용이 전혀 없으면 null(보여 줄 것이 없는 빈 레코드). */
export function normalizeMessage(raw: unknown, roles: Record<AiId, string>, fallbackAt = Date.now()): ChatMessage | null {
  if (!isObj(raw)) return null;
  const authorId = toAuthorId(raw.authorId);
  const text = typeof raw.text === 'string' ? raw.text : '';
  const attachment = normalizeAttachment(raw.attachment);
  const deleted = raw.deleted === true;
  if (!text && !attachment && !deleted && !str(raw.memoryId) && raw.pinned !== true) return null;

  const roleAtTime =
    str(raw.roleAtTime) ??
    (authorId === 'me' || authorId === 'system' ? (authorId === 'me' ? '나' : '앱') : roles[authorId]);

  const source = SOURCES.includes(raw.source as MessageSource) ? (raw.source as MessageSource) : 'local';
  const out: ChatMessage = {
    id: str(raw.id) ?? `msg_recovered_${fallbackAt.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    authorId,
    text,
    createdAt: num(raw.createdAt) ?? fallbackAt,
    source,
    roleAtTime,
  };
  if (attachment) out.attachment = attachment;
  const editedAt = num(raw.editedAt);
  if (editedAt !== undefined) out.editedAt = editedAt;
  if (deleted) out.deleted = true;
  if (raw.pinned === true) out.pinned = true;
  const memoryId = str(raw.memoryId);
  if (memoryId) out.memoryId = memoryId;
  const model = str(raw.model);
  if (model) out.model = model;
  const provider = str(raw.provider);
  if (provider) out.provider = provider;
  const latencyMs = num(raw.latencyMs);
  if (latencyMs !== undefined) out.latencyMs = latencyMs;
  return out;
}

/** 3.0 등 이전 버전 기록인지(복구 로그·마이그레이션 판단용). */
export function isLegacyMeeting(raw: unknown): boolean {
  if (!isObj(raw)) return false;
  if (!isObj(raw.enabledAi)) return true;
  if (!isObj(raw.roles)) return true;
  const keys = Object.keys(raw.roles);
  if (keys.length === 0) return true;
  if (!keys.some((k) => toAiId(k) === 'gptoss') || keys.some((k) => k === 'chatgpt' || k === 'pickle')) return true;
  if (raw.maxTurns === undefined || raw.auto === undefined || raw.callCount === undefined) return true;
  if (Array.isArray(raw.messages)) {
    return raw.messages.some((m) => isObj(m) && (m.authorId === 'chatgpt' || m.authorId === 'pickle'));
  }
  return false;
}

/** 회의 하나. 내용은 보존하고 빠진 구조만 채운다. 객체가 아니면 null. */
export function normalizeMeeting(raw: unknown, index = 0): Meeting | null {
  if (!isObj(raw)) return null;
  const now = Date.now();
  const roles = normalizeRoles(raw.roles);
  const messagesRaw = Array.isArray(raw.messages) ? raw.messages : [];
  const messages: ChatMessage[] = [];
  for (const m of messagesRaw) {
    const normalized = normalizeMessage(m, roles, now);
    if (normalized) messages.push(normalized);
  }
  const title = str(raw.title) ?? str(raw.topic) ?? '복구한 회의';
  const topic = typeof raw.topic === 'string' ? raw.topic : title;
  const status: MeetingStatus = raw.status === 'paused' || raw.status === 'ended' ? raw.status : 'active';
  const queue = (Array.isArray(raw.queue) ? raw.queue : [])
    .map((v) => toAiId(v))
    .filter((v): v is AiId => Boolean(v));
  const nextSpeakerRaw = raw.nextSpeaker;
  const nextSpeaker =
    nextSpeakerRaw === 'done' ? ('done' as const) : (toAiId(nextSpeakerRaw) as AiId | undefined) ?? undefined;
  const lastSpeakerRaw = toAuthorId(raw.lastSpeaker);
  const hadLastSpeaker = str(raw.lastSpeaker) !== undefined;
  const endedReason = ENDED_REASONS.includes(raw.endedReason as EndedReason)
    ? (raw.endedReason as EndedReason)
    : undefined;
  const lastDecisionRaw = isObj(raw.lastDecision) ? raw.lastDecision : null;
  const decidedRaw = lastDecisionRaw
    ? lastDecisionRaw.next === 'done'
      ? ('done' as const)
      : toAiId(lastDecisionRaw.next)
    : undefined;
  const lastDecision: { next: AiId | 'done'; reason?: string } | undefined = decidedRaw
    ? { next: decidedRaw, reason: str(lastDecisionRaw?.reason) }
    : undefined;

  const out: Meeting = {
    id: str(raw.id) ?? `mt_recovered_${now.toString(36)}_${index}`,
    title,
    topic,
    domain: DOMAINS.includes(raw.domain as Domain) ? (raw.domain as Domain) : 'general',
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? num(raw.createdAt) ?? now,
    roles,
    status,
    messages,
    queue,
    lastSpeaker: hadLastSpeaker ? lastSpeakerRaw : undefined,
    usedMemoryIds: (Array.isArray(raw.usedMemoryIds) ? raw.usedMemoryIds : []).filter(
      (x): x is string => typeof x === 'string',
    ),
    repeatWarnings: num(raw.repeatWarnings) ?? 0,
    maxTurns: normalizeMaxTurns(raw.maxTurns),
    // 3.0 기록은 자동 회의 개념이 없다. auto 가 true 로 저장된 것만 자동으로 이어 간다.
    auto: raw.auto === true,
    enabledAi: normalizeEnabledAi(raw.enabledAi, raw.disabledAi),
    awaitingDecision: raw.awaitingDecision !== false,
    callCount: num(raw.callCount) ?? 0,
  };
  const summary = typeof raw.summary === 'string' ? raw.summary : undefined;
  if (summary !== undefined) out.summary = summary;
  if (nextSpeaker) out.nextSpeaker = nextSpeaker;
  const directiveSentId = str(raw.directiveSentId);
  if (directiveSentId) out.directiveSentId = directiveSentId;
  if (endedReason) out.endedReason = endedReason;
  if (lastDecision) out.lastDecision = lastDecision;

  // 이후 버전이 남긴 모르는 필드는 지우지 않는다.
  const bag = out as unknown as Obj;
  for (const [key, value] of Object.entries(raw)) if (!(key in bag)) bag[key] = value;
  return out;
}

/** 기억 하나. 저장된 본문·태그는 그대로 두고 빠진 메타만 채운다. */
export function normalizeMemoryItem(raw: unknown, index = 0): MemoryItem | null {
  if (!isObj(raw)) return null;
  const title = str(raw.title) ?? str(raw.body)?.slice(0, 40);
  const body = typeof raw.body === 'string' ? raw.body : '';
  if (!title && !body) return null;
  const now = Date.now();
  const status: MemoryStatus = MEMORY_STATUSES.includes(raw.status as MemoryStatus)
    ? (raw.status as MemoryStatus)
    : '확인 필요';
  const type: MemoryType = MEMORY_TYPES.includes(raw.type as MemoryType) ? (raw.type as MemoryType) : '사실';
  const out: MemoryItem = {
    id: str(raw.id) ?? `mem_recovered_${now.toString(36)}_${index}`,
    title: title ?? '',
    body,
    status,
    type,
    tags: (Array.isArray(raw.tags) ? raw.tags : []).filter((t): t is string => typeof t === 'string'),
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? num(raw.createdAt) ?? now,
  };
  const sourceMeetingId = str(raw.sourceMeetingId);
  if (sourceMeetingId) out.sourceMeetingId = sourceMeetingId;
  const bag = out as unknown as Obj;
  for (const [key, value] of Object.entries(raw)) if (!(key in bag)) bag[key] = value;
  return out;
}

/** 설정. 3.0 의 apiKeys·models 같은 옛 필드는 버리고 지금 쓰는 값만 남긴다. */
export function normalizeSettings(raw: unknown): Settings {
  const src = isObj(raw) ? raw : {};
  return {
    displayName: typeof src.displayName === 'string' ? src.displayName : '나',
    avatarEmoji: typeof src.avatarEmoji === 'string' ? src.avatarEmoji : '',
    workerUrl: typeof src.workerUrl === 'string' ? src.workerUrl : '',
    accessCode: typeof src.accessCode === 'string' ? src.accessCode : '',
    maxTurns: normalizeMaxTurns(src.maxTurns ?? MEETING_TUNING.defaultMaxTurns),
  };
}

export interface NormalizeBatch<T> {
  items: T[];
  /** 입력 레코드 수 */
  total: number;
  /** 내용이 없어 버린 레코드 수 */
  dropped: number;
  /** 빠진 필드를 채워 복구한 레코드 수(3.0 형태 등) */
  repaired: number;
}

export function normalizeMeetings(rawList: unknown): NormalizeBatch<Meeting> {
  const list = Array.isArray(rawList) ? rawList : [];
  const items: Meeting[] = [];
  let repaired = 0;
  let dropped = 0;
  list.forEach((raw, i) => {
    const meeting = normalizeMeeting(raw, i);
    if (!meeting) {
      dropped += 1;
      return;
    }
    if (isLegacyMeeting(raw)) repaired += 1;
    items.push(meeting);
  });
  return { items, total: list.length, dropped, repaired };
}

export function normalizeMemories(rawList: unknown): NormalizeBatch<MemoryItem> {
  const list = Array.isArray(rawList) ? rawList : [];
  const items: MemoryItem[] = [];
  let dropped = 0;
  list.forEach((raw, i) => {
    const item = normalizeMemoryItem(raw, i);
    if (!item) {
      dropped += 1;
      return;
    }
    items.push(item);
  });
  return { items, total: list.length, dropped, repaired: 0 };
}
