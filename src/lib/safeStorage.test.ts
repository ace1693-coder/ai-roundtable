import { afterEach, describe, expect, it } from 'vitest';
import { canUseLocalStorage, storageGet, storageRemove, storageSet } from './safeStorage';

/**
 * 검은 화면 회귀 방지(2026-11-23): 저장소가 막힌 브라우저에서도 이 모듈은 절대 예외를 내지 않아야 한다.
 * node 환경에는 window 가 없고, 아래 테스트는 접근 자체가 throw 하는 인앱 웹뷰를 흉내 낸다.
 */
const g = globalThis as unknown as { window?: unknown };

afterEach(() => {
  delete g.window;
});

describe('safeStorage', () => {
  it('window 가 없어도 읽기/쓰기가 예외 없이 동작하고 메모리에 남는다', () => {
    expect(() => storageSet('k', 'v1')).not.toThrow();
    expect(storageGet('k')).toBe('v1');
    storageRemove('k');
    expect(storageGet('k')).toBeNull();
    expect(canUseLocalStorage()).toBe(false);
  });

  it('localStorage 접근이 SecurityError 를 던져도 앱이 죽지 않는다(웹뷰 재현)', () => {
    Object.defineProperty(g, 'window', {
      configurable: true,
      value: {
        get localStorage(): Storage {
          throw new DOMException('Access is denied for this document.', 'SecurityError');
        },
      },
    });

    expect(() => canUseLocalStorage()).not.toThrow();
    expect(canUseLocalStorage()).toBe(false);
    // 읽기: null, 쓰기: 메모리 폴백(false 반환) — 어느 쪽도 throw 하지 않는다.
    expect(storageGet('gap')).toBeNull();
    expect(() => storageSet('gap', '1200')).not.toThrow();
    expect(storageSet('gap', '1200')).toBe(false);
    expect(storageGet('gap')).toBe('1200');
  });

  it('동작하는 localStorage 가 있으면 그 값을 그대로 쓴다', () => {
    const store = new Map<string, string>();
    Object.defineProperty(g, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            store.set(k, v);
          },
          removeItem: (k: string) => {
            store.delete(k);
          },
        },
      },
    });

    expect(canUseLocalStorage()).toBe(true);
    expect(storageSet('a', '1')).toBe(true);
    expect(storageGet('a')).toBe('1');
    storageRemove('a');
    expect(storageGet('a')).toBeNull();
  });
});
