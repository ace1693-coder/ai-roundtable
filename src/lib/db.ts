import type { Meeting, MemoryItem } from './types';

/**
 * 회의 기록·공동 지식은 IndexedDB, 설정은 localStorage (전략회의 C1 확정 하이브리드).
 *
 * 왜 나누는가: 설정은 몇 줄이라 localStorage 가 즉시 읽기 좋고, 회의록은 길어져
 * localStorage 5MB 한도에 걸린다. IndexedDB 는 수십 MB 를 다룰 수 있고 비동기다.
 *
 * 이 파일은 브라우저 API 가 없는 곳(vitest node)에서도 import 만으로 죽지 않아야 한다.
 */

const DB_NAME = 'ai-roundtable';
const DB_VERSION = 1;
const STORE_MEETINGS = 'meetings';
const STORE_MEMORIES = 'memories';
const STORE_META = 'meta';

export interface WorkspaceSnapshot {
  meetings: Meeting[];
  memories: MemoryItem[];
  /** DB 를 처음 열어 localStorage 에서 옮겼는지 */
  migrated: boolean;
}

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** 테스트·구형 브라우저에서 IndexedDB 대신 쓸 메모리 저장소. */
export function createMemoryWorkspace() {
  let meetings: Meeting[] = [];
  let memories: MemoryItem[] = [];
  return {
    async load(): Promise<WorkspaceSnapshot> {
      return { meetings, memories, migrated: true };
    },
    async save(next: { meetings: Meeting[]; memories: MemoryItem[] }) {
      meetings = next.meetings;
      memories = next.memories;
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MEETINGS)) db.createObjectStore(STORE_MEETINGS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_MEMORIES)) db.createObjectStore(STORE_MEMORIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB를 열지 못했습니다.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 저장 실패'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'));
  });
}

function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

function getMeta(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve) => {
    const req = db.transaction(STORE_META, 'readonly').objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => resolve(undefined);
  });
}

/** 저장된 회의·기억을 읽는다. IndexedDB가 없으면 migrated=true 로 빈 값을 준다. */
export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  if (!hasIndexedDb()) return { meetings: [], memories: [], migrated: true };
  try {
    const db = await openDb();
    const [meetings, memories, migrated] = await Promise.all([
      getAll<Meeting>(db, STORE_MEETINGS),
      getAll<MemoryItem>(db, STORE_MEMORIES),
      getMeta(db, 'migratedFromLocalStorage'),
    ]);
    db.close();
    return {
      meetings: meetings.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
      memories: memories.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
      migrated: migrated === true,
    };
  } catch {
    return { meetings: [], memories: [], migrated: true };
  }
}

/** 회의·기억을 통째로 맞춘다(삭제도 반영). 실패해도 앱은 계속 동작한다. */
export async function saveWorkspace(next: { meetings: Meeting[]; memories: MemoryItem[] }): Promise<boolean> {
  if (!hasIndexedDb()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction([STORE_MEETINGS, STORE_MEMORIES, STORE_META], 'readwrite');
    const mStore = tx.objectStore(STORE_MEETINGS);
    const memStore = tx.objectStore(STORE_MEMORIES);
    mStore.clear();
    memStore.clear();
    for (const m of next.meetings) mStore.put(m);
    for (const mem of next.memories) memStore.put(mem);
    tx.objectStore(STORE_META).put({ key: 'migratedFromLocalStorage', value: true });
    await txDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** 개별 저장(턴마다 즉시). 브라우저가 중간에 닫혀도 마지막 발언까지 남긴다. */
export async function saveMeetingRow(meeting: Meeting): Promise<boolean> {
  if (!hasIndexedDb()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MEETINGS, 'readwrite');
    tx.objectStore(STORE_MEETINGS).put(meeting);
    await txDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function saveMemoryRow(memory: MemoryItem): Promise<boolean> {
  if (!hasIndexedDb()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MEMORIES, 'readwrite');
    tx.objectStore(STORE_MEMORIES).put(memory);
    await txDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** E2E·점검용: 저장된 회의 수와 최신 회의 제목. */
export async function debugDbSummary(): Promise<{ meetings: number; memories: number; latestTitle: string | null }> {
  const snap = await loadWorkspace();
  return { meetings: snap.meetings.length, memories: snap.memories.length, latestTitle: snap.meetings[0]?.title ?? null };
}
