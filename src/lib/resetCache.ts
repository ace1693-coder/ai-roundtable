/**
 * 서비스워커 캐시·등록을 지우고 새로고침한다.
 * 캐시가 꼬여 화면이 비었을 때 사용자가 스스로 빠져나올 수 있는 유일한 버튼이 이 동작이다.
 * 어떤 단계가 실패해도 다음 단계로 넘어가고, 마지막에는 반드시 새로고침을 시도한다.
 */
export async function resetAppCache(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
    }
  } catch {
    /* 등록 해제 실패는 무시하고 캐시 삭제로 넘어간다 */
  }
  try {
    if (typeof caches !== 'undefined' && caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
    }
  } catch {
    /* 캐시 삭제 실패도 무시 */
  }
  try {
    // 저장된 회의·설정은 지우지 않는다(캐시만 비운다).
    location.reload();
  } catch {
    /* 최후: replace 로 다시 시도 */
    try {
      location.replace(location.href);
    } catch {
      /* 아무것도 할 수 없으면 화면 안내만 남긴다 */
    }
  }
}
