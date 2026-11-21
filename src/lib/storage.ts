import type { AppData, Meeting, MemoryItem, Settings } from './types';
import { DEFAULT_SETTINGS } from './memory';

/**
 * localStorage 키를 분리한다. 한 키에 몰면 한 번의 손상으로 회의·기억·설정을 전부 잃는다.
 * (회의 2026-11-22 피클 보강 4)
 */
export const KEYS = {
  meetings: 'airt3.v1.meetings',
  memories: 'airt3.v1.memories',
  settings: 'airt3.v1.settings',
  session: 'airt3.v1.session',
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

export function loadData(): AppData {
  const meetings = readJson<Meeting[]>(KEYS.meetings, []);
  const memories = readJson<MemoryItem[]>(KEYS.memories, []);
  const settings = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(KEYS.settings, {}) };
  settings.apiKeys = { ...DEFAULT_SETTINGS.apiKeys, ...(settings.apiKeys ?? {}) };
  settings.models = { ...DEFAULT_SETTINGS.models, ...(settings.models ?? {}) };
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
