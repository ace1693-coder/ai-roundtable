/**
 * 저장소 접근 안전 래퍼.
 *
 * 왜 필요한가(2026-11-23 검은 화면 사고): 안드로이드 인앱 브라우저·쿠키 차단 웹뷰에서는
 * `typeof localStorage` 조차 SecurityError 를 던진다. 모듈 최상단에서 한 번 던지면 번들 평가가
 * 멈춰 React 가 마운트되지 않고, 사용자에게는 배경색만 남은 검은 화면이 보인다.
 * 그래서 저장소 접근은 전부 이 파일을 거치고, 절대 예외를 밖으로 내보내지 않는다.
 */

const memoryStore = new Map<string, string>();

function safeLocalStorage(): Storage | null {
  try {
    // 접근 자체가 throw 하는 환경(웹뷰·사파리 프라이빗·쿠키 차단)이 있다.
    const store = typeof window !== 'undefined' ? window.localStorage : undefined;
    return store ?? null;
  } catch {
    return null;
  }
}

/** 이 브라우저에서 localStorage 를 실제로 읽고 쓸 수 있는지(예외 없이 검사). */
export function canUseLocalStorage(): boolean {
  const store = safeLocalStorage();
  if (!store) return false;
  try {
    const probe = '__airt_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** 읽기. 저장소가 막혀 있으면 이번 실행 동안만 유지되는 메모리 값을 돌려준다. */
export function storageGet(key: string): string | null {
  const store = safeLocalStorage();
  if (store) {
    try {
      return store.getItem(key);
    } catch {
      /* 아래 메모리 폴백 */
    }
  }
  return memoryStore.get(key) ?? null;
}

/** 쓰기. 저장에 실패하면 메모리에만 남기고 false 를 준다(앱 동작은 계속). */
export function storageSet(key: string, value: string): boolean {
  const store = safeLocalStorage();
  if (store) {
    try {
      store.setItem(key, value);
      return true;
    } catch {
      /* 용량 초과·사생활 모드 → 메모리 폴백 */
    }
  }
  memoryStore.set(key, value);
  return false;
}

export function storageRemove(key: string): void {
  const store = safeLocalStorage();
  if (store) {
    try {
      store.removeItem(key);
    } catch {
      /* 무시 */
    }
  }
  memoryStore.delete(key);
}
