# AI Roundtable 4.0 — 자동 AI 회의 (별도 브랜치 `feat/auto-meeting`)

카카오톡 같은 **AI 단체 채팅방**에서 GPT-OSS · Gemini · AI 사회자 · 내가 실제로 토론하는 모바일 PWA.
회의 진행은 앱이 맡고, API 키는 Cloudflare Worker Secret 에만 둔다.

- 스택: React 18 + TypeScript + Vite 5 + Cloudflare Workers(무료) + IndexedDB
- 실제 호출 대상(**화면에도 이대로 표기**)
  | 역할 | 모델 | 제공업체 |
  |---|---|---|
  | GPT-OSS | `openai/gpt-oss-120b` | GroqCloud (OpenAI 오픈웨이트 모델. ChatGPT 아님) |
  | Gemini | `gemini-3.5-flash-lite` | Google AI Studio |
  | 사회자 | `gemini-3.5-flash-lite` (별도 시스템 프롬프트) | Google AI Studio |
- 배포 상태: **이 브랜치는 배포하지 않았다.** 운영 중인 `https://ace1693-coder.github.io/ai-roundtable/` 는 여전히 **v1 수동 버전**이다.

## 무엇이 자동인가

1. **사회자가 순서를 정한다** — 매 발언 뒤 사회자(Gemini)가 `NEXT: gptoss|gemini|moderator|done` 을 돌려주고, 앱이 그 발언자에게 실제 호출한다.
2. **고정 라운드 제한이 없다** — 멈추는 조건은 ① 사용자 정지 ② 사회자의 `done` ③ 회의당 호출 예산(기본 20회) ④ 같은 발언 3회 반복 감지 ⑤ 실패·민감정보 차단.
3. **끼어들기 최우선** — 사용자 발언은 `userDirective` 로 다음 요청에 실린다. 전달 완료 표시(`directiveSentId`)를 남겨, 이미 나가 있던 요청의 답이 도착해도 그 말을 잃지 않는다.
4. **AI별 일시 제외** — 참가자 시트에서 GPT-OSS·Gemini·사회자를 각각 끄고 켤 수 있다. 꺼진 AI는 **실제 호출 0회**, 대화 기록은 유지, 사회자가 꺼지면 기본 교대 규칙으로 폴백.
5. **민감정보 차단(양쪽)** — 프런트 전송 전 + Worker 수신 후 같은 규칙으로 검사. 걸린 값은 되돌려주지 않고 종류만 알린다.
6. **저장 분리** — 설정·최근 세션은 localStorage, 회의록·공동 기억은 IndexedDB(예전 localStorage 데이터는 1회 이전).

## 실행

```bash
npm install
npm run dev        # 개발 서버
npm run typecheck  # 앱 + Worker 타입 검사
npm test           # 단위 테스트(vitest) — 현재 97개
npm run build      # dist/ (GitHub Pages 하위경로 상대경로)
npm run test:e2e   # 모바일 실측(Playwright 390x844 DPR3) — build 후 실행
```

Chromium 시스템 라이브러리가 없는 환경에서는 `LD_LIBRARY_PATH` 로 추출한 라이브러리 경로를 지정한다.
E2E 는 검증용 가짜 Worker(`e2e/auto_meeting.py` 안에서만 뜸)를 쓰며, 실제 외부 API 를 부르지 않는다.

## Worker 준비(배포는 사용자 승인 후)

```bash
cd worker
npx wrangler deploy                       # 무료 플랜
npx wrangler secret put GROQ_API_KEY      # GroqCloud 키
npx wrangler secret put GEMINI_API_KEY    # Google AI Studio 키
npx wrangler secret put APP_ACCESS_TOKEN  # 앱에서 넣을 개인 패스코드
```

`wrangler.toml` 의 `[vars]` 에서 모델 ID·일일 상한을 바꾼다. 키는 절대 `[vars]`·프런트·깃에 넣지 않는다.

## 폴더

```
shared/          프런트·Worker 공용: protocol(요청 계약·NEXT 파서), thinking(9가지 사고 기법), sensitive(민감정보)
src/config/      모델 표기(models.ts), 회의 운영값·예산(meeting.ts), 사고 프롬프트 진입점(thinkingPrompts.ts)
src/lib/         meetingEngine(순서·예산·반복·지시), workerClient, db(IndexedDB), storage, memory, mentions, topics, repetition, summary
src/components/  RoomScreen(채팅방·토글), HomeScreen, DataSheets, Sheet, Avatar, Icon
worker/          Cloudflare Worker: app(라우팅·인증·제한), providers(Groq/Gemini), prompt, guard(CORS·토큰), store(쿼터)
e2e/             auto_meeting.py(모바일 실측) + report, 옛 3.0 스크립트(e2e.py·live_check.py, 기록용)
```

## 정직성 원칙

- 실제로 호출하지 않은 AI 의 답을 만들지 않는다. 실패하면 실패를 남기고 멈춘다.
- 모든 말풍선에 출처 배지(`사용자 / 수동 입력 / 실제 API / 앱`)와 실제 모델·제공업체·응답시간을 남긴다.
- 읽음 수·접속 중·입력 중 같은 확인할 수 없는 상태는 UI 에 없다.
- 로컬 요약에는 `기록 요약 · AI 요약 아님` 머리를 붙인다.
