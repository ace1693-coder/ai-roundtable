import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { appRendered, installGlobalErrorScreen } from './lib/fatalScreen';
import './styles.css';

const rootEl = document.getElementById('root');

if (!rootEl) {
  // index.html 이 깨져 #root 조차 없는 경우까지 대비한다.
  document.body.textContent = 'AI Roundtable: 화면을 준비하지 못했습니다. 새로고침해 주세요.';
} else {
  // 전역 오류(모듈 평가 실패·처리되지 않은 거부)까지 화면에 남긴다.
  installGlobalErrorScreen();

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );

  /**
   * React 가 실제로 무언가를 그린 뒤에만 준비 표시를 남긴다.
   * index.html 의 인라인 워치독이 이 값을 보고, 번들이 아예 실행되지 않았을 때 안내 화면을 띄운다.
   */
  const markReady = (attempt = 0): void => {
    if (appRendered()) {
      document.documentElement.dataset.airt = 'ready';
      document.getElementById('airt-fatal')?.remove();
      return;
    }
    if (attempt < 180) window.requestAnimationFrame(() => markReady(attempt + 1));
  };
  window.requestAnimationFrame(() => markReady());
}

/**
 * 오프라인 앱셸 캐시. 프로덕션 빌드에서만 등록하고, 경로는 문서 기준 상대경로(하위 경로 배포 대응).
 * 캐시가 꼬여 예전 화면이 남지 않도록, 새 워커가 준비되면 즉시 활성화하고 한 번만 다시 연다.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 첫 방문(등록 직후 claim)에는 새로고침하지 않는다. 이미 워커가 있던 경우에만 한 번 갈아탄다.
    if (!hadController || reloaded) return;
    reloaded = true;
    try {
      location.reload();
    } catch {
      /* 무시 */
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        const activate = () => reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        activate();
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            // 새 워커가 설치 완료됐고 이미 제어 중인 페이지가 있으면 바로 교체한다.
            if (next.state === 'installed' && navigator.serviceWorker.controller) activate();
          });
        });
        // 배포 직후 열린 탭도 다음 접속 때 새 버전을 확인한다.
        void reg.update().catch(() => undefined);
      })
      .catch(() => {
        /* 등록 실패는 앱 사용을 막지 않는다(온라인 상태로 동작). */
      });
  });
}
