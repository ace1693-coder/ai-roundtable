# AI Roundtable 4.0 — 검증 기록 (2026-11-22, 브랜치 `feat/auto-meeting`)

실행해서 확인한 값만 적는다. 실행하지 않았거나 외부 키가 필요한 항목은 **미검증**으로 둔다.
> 3.0 기록(e2e/e2e.py, report.json, 12/12)은 **수동 복붙 버전**의 과거 기록이다. 4.0은 이 문서를 따른다.

## 1. 정적 검사·단위 테스트·빌드

| 항목 | 명령 | 결과 |
|---|---|---|
| 앱 타입 검사 | `npx tsc --noEmit` | 통과(오류 0) |
| Worker 타입 검사 | `npx tsc -p worker/tsconfig.json` | 통과(오류 0) |
| 단위 테스트 | `npx vitest run` | **10파일 97개 통과 / 실패 0** |
| 프로덕션 빌드 | `npm run build` | 통과 · JS 208.3KB(gzip 69.9KB) · CSS 15.4KB(gzip 4.1KB) |

테스트 파일: `worker/index`(19), `worker/prompt`(7), `meetingEngine`, `memory`, `mentions`, `repetition`, `topics`,
`shared/thinking`, `shared/sensitive`, `shared/protocol`.

핵심 단위 검증
- 사회자 결정(`NEXT:` 파서): 표식 제거·done 인식·후보 밖 발언자 폐기.
- 순서 제어: 결정 → 발언 → 재결정 / 사회자 꺼짐 시 교대 폴백 / 꺼진 AI는 결정·교대 어디서도 발언자 아님.
- 종료 조건: 사회자 done, 호출 예산, 같은 발언 3회 반복, 전원 꺼짐.
- 끼어들기: 전달 전에는 재사용, 전달 후(`directiveSentId`)에는 재전송 안 함, 이미 나간 요청의 답이 와도 유실 없음.
- Worker: 401, 503(토큰 미설정), CORS 미허용, 민감정보 422(값 미반환), 429(제공사·IP·세션), 일일 상한, 결정 턴 역할 고정.

## 2. 모바일 실측 E2E (`e2e/auto_meeting.py`)

- 환경: Chromium(headless) · **390×844, DPR 3, mobile+touch** · `dist/` 정적 서빙 + 검증용 가짜 Worker(앱 산출물 아님)
- 결과: **24/24 통과** · 원본 `e2e/auto_meeting_report.json` · 스크린샷 `screenshots/auto-01~06`
- E2E 전용 조정: `localStorage.airt3.test.gapMs=1200`, `airt3.test.budget=40` (실사용 기본값은 간격 20초/5초, 예산 20회)

| # | 검증 | 결과·근거 |
|---|---|---|
| 1 | 자동 회의 루프 | 첫 호출 `moderator/decide` → 사회자가 고른 `gptoss` 호출 → 반복. callIndex 최대 21까지 진행(고정 라운드 없음) |
| 2 | 사회자 순서 제어 | 요청 로그의 `decision.next` 와 그다음 호출 role 일치 |
| 3 | 사용자 중간 개입 | 끼어든 문장이 다음 요청 `userDirective` 로 전달 |
| 4 | AI 일시 제외 | GPT-OSS 끔 → 이후 4건 중 gptoss 호출 0건, 회의는 계속 / 다시 켬 → 다시 호출됨 |
| 5 | 일시정지·재개 | 정지 중 요청 14→14(증가 0), 재개 후 다시 진행 |
| 6 | IndexedDB 저장·복원 | `indexedDB` meetings=1, memories=1 · 새로고침 후 회의방·메시지 19→21 복원 |
| 7 | 공동 기억 | 메시지→기억 저장 후 memories=1 |
| 8 | 응답시간 실측 | 말풍선 `gemini-3.5-flash-lite · Google AI Studio · 1.2s`, 상단 `평균 응답` 표시 |
| 9 | 종료 처리 | 사용자 종료 시 사회자 최종 정리(결론·행동 포함) 저장, ended-bar 표시 |
| 10 | 무결성 | 콘솔 에러 0 · 페이지 에러 0 |

## 3. 실행하지 못한 것 (미검증)

| 항목 | 상태 | 이유 / 필요한 것 |
|---|---|---|
| 실제 GroqCloud·Google AI Studio 라이브 호출 | **미검증** | 두 무료 키가 없어 실제 응답·실측 지연을 재지 않았다. E2E의 1.2s 는 가짜 Worker 값이다. 키를 넣으면 `npm run dev` + Worker `wrangler dev`로 즉시 확인 가능 |
| Cloudflare Workers 실제 배포·KV 쿼터 유지 | **미실행** | 배포 금지 지시. `wrangler deploy`·secret 설정은 사용자 승인 후 |
| 실기기(안드로이드 폰) 설치·백그라운드 중단 | **미실행** | headless Chromium 으로는 확인 불가. 폰에서 홈 화면 추가 후 1회 완주 필요 |
| SSE 스트리밍 | **미구현** | 전략회의 C5 확정(1차 비스트리밍). 2차 과제 |
| 제공사 폴백(429 시 다른 모델 1회 대체) | **미구현** | 전략회의 N6. 현재는 멈추고 안내만 한다(다음 과제) |

## 4. 상태 요약

- 2026-11-23: `feat/auto-meeting` → `main` 병합(`--no-ff`, 79e8b1b) 후 GitHub Pages에 4.0 배포 완료 — 아래 5절.

## 5. 라이브 배포·실서버 연동 검증 (2026-11-23)

| 항목 | 값 |
|---|---|
| 라이브 URL | https://ace1693-coder.github.io/ai-roundtable/ |
| main 병합 커밋 | `79e8b1b` (merge feat/auto-meeting) |
| gh-pages 배포 커밋 | `051de75` (main 79e8b1b 빌드 산출물) |
| 서빙 번들 | `assets/index-DCxeMt9I.js` (GET 200, 215,322B) · `assets/index-CfetZq5Y.css` (200, 15,421B) |
| Worker | https://ai-roundtable-api.gimnaggyun1.workers.dev (v4.0.0, groq/gemini/accessToken 모두 설정됨) |
| 검증 스크립트 | `e2e/live_pages.py`(전체 흐름) · `e2e/live_console_check.py`(콘솔 청정도) |
| 원본 기록 | `downloads/ai-roundtable-deploy/live_report.json`, `live_console_report.json`, `live-01~06*.png` (390×844, DPR 3) |

실측 결과
- 라이브 페이지 로드 OK, 바닥글에 `AI Roundtable 4.0` 표기, 스크립트는 4.0 빌드 해시.
- 설정에서 Worker 주소 + 개인용 패스코드로 **연결 확인 성공**: `연결됨 · GPT-OSS openai/gpt-oss-120b / Gemini gemini-3.5-flash-lite / 사회자 gemini-3.5-flash-lite`.
- 회의방 생성 시 자동 회의가 바로 시작되고 **실제 API 발언**이 도착: `gemini-3.5-flash-lite · Google AI Studio · 1.6s`, `openai/gpt-oss-120b · GroqCloud · 1.0s`(출처: 실제 API).
- 첫 실행에서 20초 방치 → 20호출 중 19번째부터 Worker 자체 제한 `429`(분당 20회, IP 기준) 1건이 콘솔에 남음. 정상 간격 재검증(`live_console_check.py`, 7/7): **콘솔 오류 0 · 페이지 오류 0 · 실패 요청 0 · Worker 응답 200/200/200**.
- CORS: `Origin: https://ace1693-coder.github.io`로 `/api/health` 200 + `access-control-allow-origin` 반환, `OPTIONS /api/turn` 프리플라이트 204. Worker `ALLOWED_ORIGINS`(guard.ts)에 GitHub Pages 출처가 들어 있어 별도 설정 변경 불필요.

미검증(기존 항목 그대로)
- 실기기(안드로이드 폰) 홈 화면 설치 후 백그라운드 중단, SSE 스트리밍, 429 시 제공사 폴백은 여전히 미검증/미구현.

## 6. 검은 화면 사고 수정·재검증 (2026-11-23)

증상: 안드로이드 폰 인앱 브라우저에서 앱을 열면 배경색(#0b0d10)만 남고 왼쪽 위에 테두리 일부만 보였다(사용자 스크린샷 `attachments/2026-11-23/1000025138-....jpg`).

원인(실측 재현)
- 라이브 사이트는 200 OK·정상 번들. 390×844 모바일 뷰포트에서 콘솔/페이지 오류 0건으로 정상 렌더 → 서버 문제 아님.
- `localStorage` 접근이 막힌 컨텍스트(인앱 웹뷰·쿠키 차단)를 흉내 내자 `pageerror: "Access is denied for this document." (SecurityError)`, `#root` 내용이 빈 문자열, 화면은 배경색만 남음 → 사용자 스크린샷과 동일 상태.
- 원인 줄: `src/App.tsx` 모듈 최상단 `typeof localStorage !== 'undefined' && … localStorage.getItem('airt3.test.gapMs')`. 저장소가 막힌 웹뷰에서는 **`typeof localStorage` 자체가 SecurityError 를 던진다**(크로미움에서 직접 확인). 모듈 평가가 중단되면 React 가 마운트되지 않는다.
- 부수 원인: `public/sw.js` 캐시 버전이 `airt3-v1` 그대로여서 구버전 캐시가 정리되지 않았다.

수정
| 파일 | 변경 |
|---|---|
| `src/lib/safeStorage.ts` (신규) | localStorage 접근을 try/catch 로 감싼 래퍼. 막히면 메모리 폴백, 예외 없음 |
| `src/lib/storage.ts` | read/write/clientSessionId 를 safeStorage 경유로 교체 |
| `src/App.tsx` | 모듈 최상단 localStorage 직접 접근 제거, 초기 로드 try/catch/finally(실패해도 ready) |
| `src/ErrorBoundary.tsx` (신규) | 렌더 오류 시 원인 + [캐시 초기화 후 새로고침] / [그냥 다시 시도] |
| `src/lib/fatalScreen.ts` (신규) | 전역 error/unhandledrejection 감지 → 화면이 비었을 때만 안내 오버레이 |
| `src/lib/resetCache.ts` (신규) | SW 등록 해제 + caches 전체 삭제 + reload |
| `src/main.tsx` | ErrorBoundary 적용, 전역 오류 설치, React 렌더 확인 후 `html[data-airt=ready]` 표시, SW `updateViaCache:none`·`SKIP_WAITING`·controllerchange 1회 새로고침 |
| `index.html` | 인라인 배경/스피너 CSS, `#root` 안 로딩 문구, `<noscript>`, 9초 인라인 워치독(번들 미실행 시 안내+초기화 버튼) |
| `public/sw.js` | `airt4-v2` · install allSettled · activate 구캐시 전부 삭제+claim · 네비게이션 network-first(cache:reload) · 자산 stale-while-revalidate · sw.js 자기 캐시 금지 |
| `src/styles.css` | `height:100vh; height:100dvh` 폴백, html/body/#root min-height, `.boot` 고정 오버레이, `.crash` 안내 스타일 |

실측 검증 (`e2e/verify_resilience.py`, `e2e/verify_sw_upgrade.py`, 로컬 dist · 390×844 · Chromium)
| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 정상 로드 | `.home` 렌더, 콘솔·페이지 오류 0, 로딩 문구 제거 |
| 2 | localStorage 차단 | `.home` 렌더, 오류 0 (수정 전: 검은 화면) |
| 3 | localStorage+indexedDB 모두 차단 | `.home` 렌더, 오류 0 |
| 4 | 앱 JS 404 | 9초 뒤 인라인 안내 + [캐시 초기화 후 새로고침] 버튼 표시 |
| 5 | 구워커(airt3-v1) → 새 워커 | activate 가 `airt3-v1` 삭제, 캐시는 `airt4-v2` 하나, 새로고침 후 정상 렌더 |

정적·단위·E2E
- `npm run typecheck` 통과(앱·Worker 오류 0)
- `npm test` 11파일 100개 통과(safeStorage 3개 추가)
- `npm run build` 통과 · index.html 6.83KB · JS 213.02KB(gzip 71.8KB) · CSS 16.22KB(gzip 4.16KB)
- `e2e/auto_meeting.py` 24/24 통과(회귀 없음)

미검증
- 사용자 실제 폰 인앱 브라우저에서의 최종 확인(웹뷰 종류·버전 의존). 새 SW 가 구캐시를 지우므로 재방문 시 해소되는지 사용자 확인 필요.

### 6-1. 라이브 재배포 검증 (2026-11-23 17:5x)

| 항목 | 값 |
|---|---|
| main 커밋 | `fc3e78e` (검은 화면 근본 수정) |
| gh-pages 배포 커밋 | `a39e9f0` |
| 서빙 번들 | `assets/index-Bi7oZEmQ.js` · `assets/index-DGajKxzW.css` · `sw.js` VERSION `airt4-v2` |
| 검증 스크립트 | `e2e/live_black_screen_check.py` (390×844 · Android UA) |
| 스크린샷 | `downloads/ai-roundtable-mobile-fixed.png` · `downloads/ai-roundtable-live-storage-blocked.png` |

- 정상 로드: `.home` 렌더, `#root` 콘텐츠 정상, 콘솔·페이지 오류 0, 실패 요청 0, 서비스워커 제어 중(캐시 `airt4-v2` 하나).
- localStorage 차단 상태(수정 전 검은 화면이던 조건): `.home` 렌더, 오류 0 — 수정이 라이브에서도 유효함.
- 새로고침 3회 반복 시 추가 자동 새로고침 없음(무한 새로고침 없음) 확인.

