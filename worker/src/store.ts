import type { KVLike } from './providers';

/** 사용량 카운터 저장소. KV가 붙어 있으면 인스턴스가 바뀌어도 유지된다. */
export interface QuotaStore {
  /** 값을 1 올리고 새 값을 돌려준다. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
}

/** KV가 없을 때 쓰는 메모리 저장소 — 인스턴스(아이솔레이트) 수명까지만 유지된다. */
export function createMemoryStore(now: () => number = Date.now): QuotaStore {
  const map = new Map<string, { value: number; expiresAt: number }>();
  function alive(key: string): number {
    const row = map.get(key);
    if (!row) return 0;
    if (row.expiresAt <= now()) {
      map.delete(key);
      return 0;
    }
    return row.value;
  }
  return {
    async incr(key, ttlSeconds) {
      const next = alive(key) + 1;
      map.set(key, { value: next, expiresAt: now() + ttlSeconds * 1000 });
      return next;
    },
    async get(key) {
      return alive(key);
    },
  };
}

/**
 * KV 저장소. KV에는 원자적 증가 연산이 없어 동시 요청에서 1~2건 오차가 날 수 있다.
 * 그래서 상한은 실제 무료 한도보다 낮게 잡고, 제공업체의 429를 최종 방어선으로 둔다.
 */
export function createKvStore(kv: KVLike): QuotaStore {
  return {
    async incr(key, ttlSeconds) {
      const prev = Number((await kv.get(key)) ?? '0') || 0;
      const next = prev + 1;
      await kv.put(key, String(next), { expirationTtl: Math.max(60, ttlSeconds) });
      return next;
    },
    async get(key) {
      return Number((await kv.get(key)) ?? '0') || 0;
    },
  };
}

export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function utcMinuteKey(date = new Date()): string {
  return date.toISOString().slice(0, 16);
}
