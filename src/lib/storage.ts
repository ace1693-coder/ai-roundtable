import type { AppData, Meeting, MemoryItem, Settings } from './types';
import { DEFAULT_SETTINGS, normalizeMaxTurns } from './memory';

/**
 * localStorage 키를 분리한다. 한 키에 몰면 한 번의 손상으로 회의·기억·설정을 전부 잃는다.
 * (회의 2026-11-22 피클 보강 4)
 */
export const KEYS = {
  meetings: 'airt3.v1.meetings',
  memories: 'airt3.v1.memories',
  settings: 'airt3.v1.settings',
  session: 'airt3.v1.session',
  client: 'airt3.v1.client',
} as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 용량 초과·사생활 모드에서 저장 실패. 화면은 계속 동작하고 JSON 내보내기로 백업할 수 있다.
  }
}

/** 설정만 localStorage 에서 읽는다(회의·기억은 IndexedDB). */
export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>(KEYS.settings, {});
  return {
    displayName: raw.displayName ?? DEFAULT_SETTINGS.displayName,
    avatarEmoji: raw.avatarEmoji ?? DEFAULT_SETTINGS.avatarEmoji,
    workerUrl: raw.workerUrl ?? DEFAULT_SETTINGS.workerUrl,
    accessCode: raw.accessCode ?? DEFAULT_SETTINGS.accessCode,
    maxTurns: normalizeMaxTurns(raw.maxTurns ?? DEFAULT_SETTINGS.maxTurns),
  };
}

export function loadActiveMeetingId(): string | null {
  const session = readJson<{ activeMeetingId: string | null }>(KEYS.session, { activeMeetingId: null });
  return session.activeMeetingId ?? null;
}

/** 예전 버전이 localStorage 에 남긴 회의·기억. IndexedDB 로 한 번만 옮긴다. */
export function collectLegacyData(): { meetings: Meeting[]; memories: MemoryItem[] } {
  return {
    meetings: readJson<Meeting[]>(KEYS.meetings, []),
    memories: readJson<MemoryItem[]>(KEYS.memories, []),
  };
}

export function loadData(): AppData {
  const meetings = readJson<Meeting[]>(KEYS.meetings, []);
  const memories = readJson<MemoryItem[]>(KEYS.memories, []);
  // 예전 버전이 저장한 apiKeys·models 같은 필드는 버린다(새 Settings에 없는 값은 무시).
  const raw = readJson<Partial<Settings>>(KEYS.settings, {});
  const settings: Settings = {
    displayName: raw.displayName ?? DEFAULT_SETTINGS.displayName,
    avatarEmoji: raw.avatarEmoji ?? DEFAULT_SETTINGS.avatarEmoji,
    workerUrl: raw.workerUrl ?? DEFAULT_SETTINGS.workerUrl,
    accessCode: raw.accessCode ?? DEFAULT_SETTINGS.accessCode,
    maxTurns: normalizeMaxTurns(raw.maxTurns ?? DEFAULT_SETTINGS.maxTurns),
  };
  const session = readJson<{ activeMeetingId: string | null }>(KEYS.session, { activeMeetingId: null });
  const activeMeetingId =
    session.activeMeetingId && meetings.some((m) => m.id === session.activeMeetingId) ? session.activeMeetingId : null;
  return { meetings, memories, settings, activeMeetingId };
}

export function saveMeetings(meetings: Meeting[]): void {
  writeJson(KEYS.meetings, meetings);
}

export function saveMemories(memories: MemoryItem[]): void {
  writeJson(KEYS.memories, memories);
}

export function saveSettings(settings: Settings): void {
  writeJson(KEYS.settings, settings);
}

/**
 * 이 브라우저의 세션 ID. Worker의 세션 단위 요청 제한에 쓴다.
 * 개인 식별 정보가 아니라 요청량을 세는 표식이며, 지우면 새로 발급된다.
 */
export function clientSessionId(): string {
  try {
    const existing = localStorage.getItem(KEYS.client);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const fresh = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEYS.client, fresh);
    return fresh;
  } catch {
    // 사생활 모드 등 저장이 막히면 이번 실행 동안만 쓰는 ID를 쓴다.
    return `e${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
  }
}

export function saveSession(activeMeetingId: string | null): void {
  writeJson(KEYS.session, { activeMeetingId });
}

export function exportAll(data: AppData): string {
  return JSON.stringify(
    {
      app: 'ai-roundtable',
      version: 3,
      exportedAt: new Date().toISOString(),
      meetings: data.meetings,
      memories: data.memories,
    },
    null,
    2,
  );
}
