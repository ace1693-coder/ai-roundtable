# AI Roundtable 3.0 — 검증 기록 (2026-11-22)

빌드·단위테스트·모바일 실측을 실제로 실행한 결과만 적는다. 실행하지 않은 것은 "미실행"으로 둔다.

## 1. 빌드·정적 검사

| 항목 | 명령 | 결과 |
|---|---|---|
| 타입 검사 | `npx tsc --noEmit` | 통과(오류 0) |
| 단위 테스트 | `npx vitest run` | **6파일 49개 통과 / 실패 0** |
| 프로덕션 빌드 | `npm run build` | 통과 · JS 194.7KB(gzip 64.7KB) · CSS 13.6KB(gzip 3.6KB) |
| 상대경로 확인 | `dist/index.html` | `./assets/index-*.js`, `./assets/index-*.css` (절대경로 없음) |

단위 테스트 파일: `topics`(5), `mentions`(10), `repetition`(7), `memory`(8), `turn`(10), `prompt/summary/format`(9).

## 2. 모바일 실측 E2E

- 스크립트: `e2e/e2e.py` · 결과 원본: `e2e/report.json`
- 환경: Chromium(headless), 뷰포트 **390×844, DPR 3, mobile+touch**, 로케일 ko-KR, 시간대 Asia/Seoul
- 서빙: `dist/`를 `e2e/_site/ai-roundtable/`(GitHub Pages 하위 경로와 동일 구조)에 두고 `http://127.0.0.1:4188/ai-roundtable/`로 접속
- 결과: **12/12 통과** (14번 항목 11개 + 보조 1개)

| # | 검증 항목 | 결과 | 근거(실측값) |
|---|---|---|---|
| 1 | 채팅방 생성 + 주제별 역할 자동 배정 | 통과 | "코팅 공정 불량 개선 회의" → 제조 역할 3종(공정혁신/설비·품질·안전 검증/생산성·원가절감) |
| 2 | ChatGPT/Gemini/Pickle 프로필 SVG 표시·구분 | 통과 | ChatGPT `#10A37F` · Gemini 그라데이션 `#4285F4→#9B72CB` + 스파클 · Pickle `#FF7A00` + ㄴ·두 눈 · 이름·역할 4명 표시 |
| 3 | 사용자 메시지 전송 + 오른쪽 말풍선 | 통과 | 말풍선 x=91(390px 뷰포트), `출처: 사용자`, `오전 02:39` |
| 4 | 메시지 입력 시 AI 연결/프롬프트/응답 반응 | 통과 | 다음 발언 대상 제안 + 프롬프트 865자에 사용자 발언·역할·지식후보 포함(클립보드로 확인) + 붙여넣기 등록 → `출처: 수동 입력` 말풍선 |
| 5 | @ChatGPT·@Gemini·@Pickle·@전체 멘션 | 통과 | `@` 입력 시 자동완성 4개 노출, `@Gemini` → 대상 Gemini, `@전체` → 3명 대기열(ChatGPT부터) |
| 6 | 회의 중 사용자 끼어들기 최우선 반영 | 통과 | 대기 중 ChatGPT 턴 → `@Pickle` 발언 즉시 Pickle이 최우선(`대기 1 · 멘션·사용자 지시 우선`) |
| 7 | 회의 저장/불러오기 + 새로고침 유지 | 통과 | `page.reload()` 후 메시지 5개·핀 배너 유지, 이전 회의 목록에서 재진입 |
| 8 | 대화 검색·메시지 고정·지식 저장소 저장/재활용 | 통과 | 검색 2건, 핀 배너, 메시지→지식 저장(상태·유형·태그) 후 기억 목록 표시, 새 회의에서 관련 기억 1건 자동 매칭 |
| 9 | 일시정지/종료 + 회의 요약 생성 | 통과 | 일시정지 바→재개→종료→`출처: 로컬 규칙 엔진` 요약(발언 수 포함)→이어가기 |
| 10 | 360/390/430px 가로 스크롤 0·레이아웃 유지 | 통과 | scrollWidth = innerWidth (360/360, 390/390, 430/430), 입력창·메시지 영역 뷰포트 내 |
| 11 | PWA manifest·sw.js 로드, 콘솔/페이지 에러 0, 무단 외부 요청 0 | 통과 | manifest·sw·아이콘 3종 HTTP 200, `serviceWorker.controller` 존재, console 0 · pageerror 0 · 외부 요청 0 |

스크린샷(390×844 기준, `screenshots/`): `01_home`, `02_room_created`, `03_participants`, `04_user_message`, `05_prompt_and_answer`, `06_mentions`, `07_interrupt`, `08_memory`, `09_after_reload`, `10_summary`, `11_width_360`, `11_width_390`, `11_width_430`, `12_pwa`, `13_menu`.

## 3. 실행하지 못한 것 (미실행·사용자 확인 필요)

| 항목 | 상태 | 이유 / 필요한 것 |
|---|---|---|
| 안드로이드 실제 기기(사용자 폰)에서 홈 화면 추가·설치 배너 | **미실행** | 원격 headless Chromium으로는 실기기 설치 UI를 확인할 수 없다. manifest·SW·아이콘 200과 SW 제어까지 확인했고, 사용자가 배포 URL을 폰 크롬으로 열어 "홈 화면에 추가"로 최종 확인해야 한다. |
| 오프라인 재실행(비행기 모드) | **미실행** | 정적 서버를 유지한 상태에서 SW 캐시만으로 재접속하는 실험은 하지 않았다. 앱셸 선캐시+탐색 network-first 구조만 코드로 존재. |
| 실제 OpenAI/Gemini API 자동 응답 | **미실행** | 유료 API 보류 지침 + 키 미보유. 코드 경로(`src/lib/api.ts`)만 있고, 키 미입력 시 버튼이 나타나지 않으며 "API 미연결"로 표시한다. |
| GitHub Pages 실제 배포 URL | **배포 완료(2026-11-22 13:16)** — `https://ace1693-coder.github.io/ai-roundtable/` · 아래 5절 참조 |

## 4. GitHub Pages 실서버 배포 검증 (2026-11-22)

- 저장소: `ace1693-coder/ai-roundtable` (PUBLIC) · `main`(소스) + `gh-pages`(dist 빌드 산출물, `/.nojekyll` 포함)
- Pages 설정: `build_type=legacy`, source `gh-pages` / `/`, `https_enforced=true` — gh-pages 푸시 후 GitHub이 자동 활성화, 빌드 `status=built`
- 접속 URL: **https://ace1693-coder.github.io/ai-roundtable/**
- 스크립트: `e2e/live_check.py` · 결과 원본: `e2e/live_report.json`
- 환경: Chromium(headless), 390×844 · DPR 3 · mobile+touch · ko-KR · Asia/Seoul, 네트워크 = 실제 인터넷

| 검증 항목 | 결과 | 실측값 |
|---|---|---|
| 문서 응답 | 통과 | HTTP 200 (`text/html`) |
| 자산 응답 | 통과 | index.html 1,015B · JS 201,600B · CSS 13,733B · manifest 987B · icon 3종 · sw.js 1,916B — 전부 200, 4xx/5xx 0 |
| 모바일 렌더 | 통과 | #root 자식 존재, clientWidth 390 = scrollWidth 390(가로 스크롤 없음) |
| 채팅방 생성 | 통과 | 주제 입력 → `room-title` "실서버 배포 확인 회의", 참가자 4명 |
| 사용자 메시지 전송 | 통과 | 내 말풍선 1개, `출처: 사용자`, `오후 01:16` |
| PWA | 통과 | `serviceWorker: registered:active`, manifest 파싱(name·standalone·아이콘 4) |
| 콘솔·페이지 에러 | 통과 | console error 0 · pageerror 0 · requestfailed 0 |

스크린샷: `screenshots/live-pages-390x844-home.png`, `screenshots/live-pages-390x844-room.png`

배포 방식 메모: GitHub App 연결에 `workflows` 권한이 없어 `.github/workflows/deploy.yml`(Actions 배포)은 푸시가 거부된다. 그래서 워크플로를 저장소에서 제거하고(원본은 `projects/ai-roundtable-deploy-workflow.yml.bak`) Pocket-tools와 동일한 gh-pages 브랜치 방식으로 배포했다. 재배포는 `dist/` 빌드 후 gh-pages 브랜치에 덮어쓰면 된다.

## 5. 확인된 결함과 수정

| 발견 | 수정 |
|---|---|
| 멘션 자동완성 직후 입력한 글자가 문장 중간에 끼어드는 문제(테스트에서 "@Gemini 위험한 부분만 짚어줘 안에서"로 재현) | `useLayoutEffect`로 삽입 직후 커서 위치를 커밋과 동시에 확정. E2E에 입력값 일치 단언 추가 후 통과 |
| 하단 시트가 열리는 순간 뒤 내용이 비쳐 보임(투명도 애니메이션) | 시트 애니메이션에서 opacity 제거(transform만), 배경 불투명 유지 |
| 토스트가 다음 발언 버튼을 가림 | 토스트를 상단(헤더 아래)으로 이동 |
| 360px에서 버튼 4개가 흩어지며 높이가 들쭉날쭉 | 발언 버튼을 3열 그리드로 고정, 라벨 축약 |
| 이모지 아이콘이 다크 UI와 겉돎 | 검색·참가자·메뉴·전송·닫기 등을 인라인 SVG로 교체 |
