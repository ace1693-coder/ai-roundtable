import type { AppData, Meeting, MemoryItem, Settings } from './types';
import { storageGet, storageSet } from './safeStorage';
import { normalizeMeetings, normalizeMemories, normalizeSettings } from './schema';

/**
 * localStorage 키를 분리한다. 한 키에 몰면 한 번의 손상으로 회의·기억·설정을 전부 잃는다.
 * (회의 2026-11-22 피클 보강 4)
 *
 * 키 이름(airt3.v1.*)은 4.0 에서도 그대로 쓴다. 이름을 바꾸면 3.0 사용자의 저장 데이터를
 * 찾지 못해 회의 기록이 사라진 것처럼 보이기 때문이다.
 */
export const KEYS = {
  meetings: 'airt3.v1.meetings',
  memories: 'airt3.v1.memories',
  settings: 'airt3.v1.settings',
  session: 'airt3.v1.session',
  client: 'airt3.v1.client',
} as const;

/**
 * JSON 읽기. 저장소 접근 차단·깨진 JSON(`"{broken json"`)·타입 불일치(배열/문자열/숫자)에서도
 * 예외 없이 fallback 을 돌려준다.
 */
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storageGet(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  // 저장이 막힌 브라우저(웹뷰·사생활 모드)에서도 예외를 내지 않는다.
  // 실패해도 화면은 계속 동작하고 JSON 내보내기로 백업할 수 있다.
  storageSet(key, JSON.stringify(value));
}

/** 설정만 localStorage 에서 읽는다(회의·기억은 IndexedDB). 어떤 값이 와도 Settings 를 만든다. */
export function loadSettings(): Settings {
  return normalizeSettings(readJson<unknown>(KEYS.settings, {}));
}

export function loadActiveMeetingId(): string | null {
  const session = readJson<unknown>(KEYS.session, {});
  const id = typeof session === 'object' && session !== null ? (session as { activeMeetingId?: unknown }).activeMeetingId : null;
  return typeof id === 'string' && id ? id : null;
}

/** 예전 버전이 localStorage 에 남긴 회의·기억. IndexedDB 로 한 번만 옮긴다(정규화 후). */
export function collectLegacyData(): { meetings: Meeting[]; memories: MemoryItem[] } {
  return {
    meetings: normalizeMeetings(readJson<unknown>(KEYS.meetings, [])).items,
    memories: normalizeMemories(readJson<unknown>(KEYS.memories, [])).items,
  };
}

/** 3.0 시절 화면이 쓰던 통합 로더(지금은 App 이 IndexedDB 경로를 쓴다). */
export function loadData(): AppData {
  const meetings = collectLegacyData().meetings;
  const memories = collectLegacyData().memories;
  const settings = loadSettings();
  const activeMeetingId = loadActiveMeetingId();
  return {
    meetings,
    memories,
    settings,
    activeMeetingId: activeMeetingId && meetings.some((m) => m.id === activeMeetingId) ? activeMeetingId : null,
  };
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
  const existing = storageGet(KEYS.client);
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const fresh = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  // 저장이 막혀 있으면 storageSet 이 메모리에만 남긴다(이번 실행 동안 같은 ID).
  storageSet(KEYS.client, fresh);
  return fresh;
}

export function saveSession(activeMeetingId: string | null): void {
  writeJson(KEYS.session, { activeMeetingId });
}

export function exportAll(data: AppData): string {
  return JSON.stringify(
    {
      app: 'ai-roundtable',
      version: 4,
      exportedAt: new Date().toISOString(),
      meetings: data.meetings,
      memories: data.memories,
    },
    null,
    2,
  );
}
