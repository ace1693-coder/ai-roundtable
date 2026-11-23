/* AI Roundtable 4.0 — 앱셸 캐시 서비스워커 (v2)
   상대경로만 쓴다(GitHub Pages 하위 경로 /ai-roundtable/ 배포 대응).
   - 탐색(HTML): 네트워크 우선(HTTP 캐시도 건너뜀), 실패 시에만 캐시된 index.html
   - 정적 자산: stale-while-revalidate(캐시를 먼저 주고 뒤에서 새 파일로 교체)
   - 캐시 이름에 버전을 넣고 activate 에서 이전 캐시를 전부 지운다.
   배포 후 예전 index.html 과 새 JS/CSS 가 섞여 검은 화면이 되던 문제(2026-11-23)의 재발 방지. */
const VERSION = 'airt4-v2';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const HTML_KEY = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        // 한 파일이 없어도 설치는 끝낸다(전부 실패로 묶으면 앱셸이 통째로 사라진다).
        Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))),
      )
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      // 열려 있는 예전 탭도 새 워커가 바로 제어하게 한다.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function cachePut(request, response) {
  if (!response || !response.ok) return;
  // opaque(교차 출처) 응답은 캐시하지 않는다.
  if (response.type !== 'basic' && response.type !== 'default') return;
  const copy = response.clone();
  caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 요청(Worker API 등)은 가로채지 않는다
  if (url.pathname.endsWith('/sw.js')) return; // 서비스워커 자신은 캐시하지 않는다

  // 화면(HTML): 항상 새 것을 먼저 받는다. 그래야 새 배포가 바로 반영된다.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(req.url, { cache: 'reload', credentials: 'same-origin' }))
        .then((res) => {
          cachePut(HTML_KEY, res.clone());
          return res;
        })
        .catch(() =>
          caches
            .match(HTML_KEY)
            .then((hit) => hit || caches.match('./'))
            .then((hit) => hit || new Response('<!doctype html><meta charset="utf-8"><body style="background:#0b0d10;color:#e9ecf1;font-family:system-ui;padding:24px">오프라인 상태입니다. 인터넷에 연결한 뒤 다시 열어 주세요.</body>', { headers: { 'content-type': 'text/html; charset=utf-8' } })),
        ),
    );
    return;
  }

  // 정적 자산: 캐시를 먼저 주고, 뒤에서 새 파일로 갱신한다. 캐시에 없으면 네트워크 → 캐시 저장.
  event.respondWith(
    caches.match(req).then((hit) => {
      const revalidate = fetch(req)
        .then((res) => {
          cachePut(req, res.clone());
          return res;
        })
        .catch(() => undefined);

      if (hit) {
        event.waitUntil(revalidate);
        return hit;
      }
      return revalidate.then((res) => res || new Response('', { status: 504, statusText: 'offline' }));
    }),
  );
});
