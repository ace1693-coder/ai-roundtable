# AI Roundtable 3.0

카카오톡 같은 **AI 단체 채팅방**에서 ChatGPT · Gemini · Pickle · 내가 함께 회의하는 모바일 PWA.
서버·DB 없이 정적 파일로 돌고, 회의·기억·설정은 이 기기 브라우저(localStorage)에만 저장한다.

- 스택: React 18 + TypeScript + Vite 5 (`base: './'`) + 자체 서비스워커
- 배포: **https://ace1693-coder.github.io/ai-roundtable/** (GitHub Pages, `gh-pages` 브랜치) — 하위 경로 기준 상대경로 빌드
- 외부 AI 연결: **기본은 수동 연결**(프롬프트 복사 → ChatGPT/Gemini 게스트 웹 답변 붙여넣기). 선택으로 본인 API 키를 넣으면 실제 호출.

## 실행

```bash
npm install
npm run dev        # 개발 서버
npm run typecheck  # tsc --noEmit
npm test           # 단위 테스트(vitest, 49개)
npm run build      # dist/ 생성
npm run test:e2e   # 모바일 실측(Playwright, 390x844 DPR3) — 빌드 후 실행
```

E2E는 `dist/`를 GitHub Pages와 같은 `/ai-roundtable/` 하위 경로에 올려 확인한다(상대경로 실측).
이 작업 환경처럼 Chromium 시스템 라이브러리가 없는 곳에서는 `LD_LIBRARY_PATH`에 추출한 라이브러리 경로를 지정한다.

## 정직성 원칙 (거짓 동작 금지)

- 실제로 호출하지 않은 AI의 답변을 만들지 않는다. 앱은 **프롬프트만** 생성하고, 답변은 사람이 붙여넣어 등록한다.
- 모든 말풍선에 `출처: 사용자 / 수동 입력 / 실제 API / 로컬 규칙 엔진` 배지를 남긴다.
- 읽음 수·접속 중(초록점)·"입력 중..." 같은 확인할 수 없는 상태는 **UI에 존재하지 않는다**.
- 요약은 로컬 규칙 엔진 초안이며, AI 요약은 별도 프롬프트를 복사해 받아 붙여넣는다.

## 폴더

```
src/lib/        순수 로직(테스트 대상): topics, mentions, repetition, turn, prompt, memory, storage, summary, api
src/components/ Avatar(SVG), RoomScreen(채팅방), HomeScreen, Sheet, DataSheets(설정·기억), Icon
public/         manifest.webmanifest, sw.js, icon.svg/png
e2e/            Playwright 모바일 실측 스크립트 + report.json
screenshots/    모바일 실측 스크린샷
```
