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


## 7. `Cannot read properties of undefined (reading 'gptoss')` 장애 원인·수정·8환경 검증 (2026-11-23 저녁)

### 7-1. 증상과 재현

증상: 저장된 회의방을 열거나 참가자 목록을 그릴 때 앱이 복구 화면(ErrorBoundary)으로 넘어가고
`Cannot read properties of undefined (reading 'gptoss')` 가 표시된다.

재현(수정 전 번들, `e2e/diag_gptoss.py`, 로컬 dist · 390×844):

| 주입한 저장 데이터 | 결과 |
|---|---|
| IndexedDB 회의에 `enabledAi` 없음(4.0 형태에서 중첩 객체만 빠진 기록) | 회의방 렌더 즉시 `TypeError: Cannot read properties of undefined (reading 'gptoss')` — 참가자 목록 map 안 |
| 3.0 localStorage 회의(작성자 `chatgpt`/`pickle`, `enabledAi` 없음) | 첫 화면에서 `Cannot read properties of undefined (reading 'name')` |

### 7-2. 근본 원인 (파일·함수·줄 — 수정 전 `fc3e78e` 기준)

회의·기억은 저장소에서 **정규화 없이 그대로** 읽어 화면 상태에 넣고 있었다.

| 위치 | 코드 | 왜 죽는가 |
|---|---|---|
| `src/lib/db.ts` `loadWorkspace()` | `getAll<Meeting>('meetings')` 결과를 그대로 반환 | 저장된 회의를 스키마 검사 없이 사용. 3.0 기록은 `enabledAi`·`maxTurns`·`auto`·`callCount` 자체가 없다 |
| `src/lib/storage.ts` `collectLegacyData()` | `readJson<Meeting[]>(KEYS.meetings, [])` 그대로 반환 | 3.0 localStorage 회의를 정규화 없이 IndexedDB 로 옮겼다(첫 4.0 실행 때) |
| `src/components/RoomScreen.tsx:548` | `const on = meeting.enabledAi[id] !== false;` (참가자 목록 map, 첫 id가 `gptoss`) | **`enabledAi` 가 undefined → 문자 그대로 `reading 'gptoss'`.** 회의방을 열면 시트가 닫혀 있어도 자식이 렌더되어 즉시 발생 |
| `src/components/RoomScreen.tsx:165` | `m.roleAtTime \|\| meeting.roles[m.authorId]` | `roles` 가 없으면 `reading 'gptoss'`(작성자가 gptoss 인 메시지) |
| `src/components/RoomScreen.tsx:196,257,554,557` | `PARTICIPANTS[id].name`, `meeting.roles[id]` | 3.0 id(`chatgpt`/`pickle`)면 `reading 'name'`, `roles` 없으면 `reading 'gptoss'` |
| `src/App.tsx:381` | `still.enabledAi[plan.speaker] === false` | 자동 회의 스텝에서 같은 예외(발언자가 gptoss 일 때) |
| `src/App.tsx:256,632-639` | `meeting.enabledAi.moderator`, `meeting.enabledAi[id]` | 회의 종료·AI 켜기/끄기에서 같은 예외 |
| `src/App.tsx:402` | `roleAtTime: meeting.roles[plan.speaker]` | `roles` 없으면 같은 예외 |
| `src/components/HomeScreen.tsx:124`, `src/lib/summary.ts:25` | `PARTICIPANTS[last.authorId as 'gptoss'].name` | 3.0 작성자 id 면 `reading 'name'` — 첫 화면(이전 회의 목록)에서 죽는다 |

부수 원인: `src/App.tsx` 의 자동 저장 effect 가 **읽기 실패 직후에도** 빈 배열을 IndexedDB 에 쓸 수 있었다(기존 기록을 지울 위험).
Service Worker 캐시는 `airt4-v2` 로 구캐시는 지우고 있었으나, 배포본 교체를 확실히 하려고 `airt4-v3` 로 올렸다.

### 7-3. 수정한 파일

| 파일 | 변경 |
|---|---|
| `src/lib/schema.ts` (신규) | `normalizeMeeting` / `normalizeMessage` / `normalizeMemoryItem` / `normalizeSettings` / `normalizeMeetings` / `normalizeMemories`. 빠진 중첩 필드는 기본값으로 채우고(`enabledAi` 3종 true, `maxTurns` 5, `auto` false, `callCount` 0, `roles` 기본 역할), 3.0 의 `chatgpt`/`pickle` 을 `gptoss`/`moderator` 로 옮긴다. **내용(발언·요약·기억·태그)은 그대로 두고 모르는 필드도 보존**한다. 어떤 입력(undefined·문자열·숫자·깨진 객체)에도 예외를 던지지 않는다 |
| `src/lib/turns.ts` (신규) | `normalizeMaxTurns` 를 memory 에서 분리(순환 import 방지). `memory.ts` 는 재export |
| `src/lib/db.ts` | `loadWorkspace()` 가 읽은 값을 정규화해 반환. `readFailed`(읽기 실패)·`repaired`·`skipped` 추가 |
| `src/lib/storage.ts` | `loadSettings`→`normalizeSettings`, `collectLegacyData`→정규화, `loadActiveMeetingId` 타입 방어. 깨진 JSON·타입 불일치 폴백 유지 |
| `src/App.tsx` | 정규화된 스냅샷 사용 + 복구 결과를 IndexedDB 에 한 번 되써 마이그레이션 완료. **읽기 실패 시 자동 저장 중단**(기존 기록 보호). `enabledAi`/`roles` 접근 전부 옵셔널 체이닝·기본값 |
| `src/lib/memory.ts` | `parseMeetingsImport` 가 `normalizeMeeting` 을 거치도록 통일(중복 정규화 코드 제거) |
| `src/lib/participants.ts` | `authorName`/`authorColor` 가 모르는 작성자에도 이름을 돌려준다 |
| `src/components/HomeScreen.tsx`, `src/lib/summary.ts` | 작성자 이름을 `authorName()` 으로(3.0 id 에서 죽지 않게) |
| `src/components/RoomScreen.tsx` | `enabledAi?.[id]`, `roles?.[id] ?? '역할 미지정'`, `PARTICIPANTS[...]?.name`, 상태 칩·참가자 목록에 **미연결** 표시 |
| `src/components/Avatar.tsx` | 모르는 id 면 기본 사람 아바타 |
| `src/components/DataSheets.tsx` | 연결 확인 응답에 `models`/`configured` 가 빠져도 죽지 않게 |
| `src/lib/meetingEngine.ts` | 프롬프트 조립 시 `roles` 기본값 |
| `public/sw.js` | `airt4-v3` |

### 7-4. 필수 8환경 실제 검증 (`e2e/verify_schema8.py`, 로컬 dist · 390×844 · Android UA)

원본: `e2e/schema8_report.json` · 스크린샷 `screenshots/schema-1~8-*.png`

| # | 환경 | 결과 | 확인한 것 |
|---|---|---|---|
| 1 | 저장 데이터 없는 새 사용자 | 통과 | 첫 화면 → 회의 생성 → 메시지 전송 → 새로고침 후 회의·메시지 유지, 참가자 3명 |
| 2 | 3.0 설정·회의 저장 사용자 | 통과 | 목록에 예전 회의·새 참가자 이름, 기존 회의방 열기, 발언 2건·요약문 보존, IndexedDB 로 옮긴 기록에 `enabledAi` 생성, localStorage 원본 유지 |
| 3 | `enabledAi` 등 중첩 객체 누락 | 통과 | 회의방·참가자 목록 정상(장애 지점), 채운 값이 IndexedDB 에 저장, Worker 미설정 안내 |
| 4 | localStorage 접근 차단 | 통과 | 첫 화면·회의 생성·메시지 전송 |
| 5 | 손상 JSON(`"{broken json"` 등) | 통과 | 첫 화면, 회의 생성·새로고침 유지, 설정이 기본값(이름=나, Worker 빈값)으로 복구 |
| 6 | 구버전 SW(`airt3-v1`) 잔존 | 통과 | activate 가 구캐시 삭제, SW `airt4-v3`, 화면 정상 |
| 7 | Worker/API 키 미연결 | 통과 | 상태 칩·참가자 목록 '미연결', 안내 바, 연결 확인 실패 안내 |
| 8 | Android Chrome 390×844 전체 흐름 | 통과 | 기존 회의 열기, 멘션 입력, 대화 검색, 기억 시트, 새로고침 유지 |

각 시나리오 공통: 복구 화면 0건 · 콘솔 오류 0건 · 페이지 오류 0건.

회귀 확인: `npm run typecheck` 통과 · `npm test` **122개 통과(schema 22개 추가)** · `npm run build` 통과 ·
`e2e/auto_meeting.py` **24/24**(실제 자동 회의 루프 그대로) · `e2e/verify_resilience.py` 정상(검은 화면 5종).
