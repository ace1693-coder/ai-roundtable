import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 오프라인 앱셸 캐시. 프로덕션 빌드에서만 등록하고, 경로는 문서 기준 상대경로(하위 경로 배포 대응).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 등록 실패는 앱 사용을 막지 않는다(온라인 상태로 동작). */
    });
  });
}
