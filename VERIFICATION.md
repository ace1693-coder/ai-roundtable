# AI Roundtable 4.0 — 검증 기록 (2026-11-22, 브랜치 `feat/auto-meeting`)

실행해서 확인한 값만 적는다. 실행하지 않았거나 외부 키가 필요한 항목은 **미검증**으로 둔다.
> 3.0 기록(e2e/e2e.py, report.json, 12/12)은 **수동 복붙 버전**의 과거 기록이다. 4.0은 이 문서를 따른다.

## 1. 정적 검사·단위 테스트·빌드

| 항목 | 명령 | 결과 |
|---|---|---|
| 앱 타입 검사 | `npx tsc --noEmit` | 통과(오류 0) |
| Worker 타입 검사 | `npx tsc -p worker/tsconfig.json` | 통과(오류 0) |
| 단위 테스트 | `npx vitest run` | **10파일 97개 통과 / 실패 0** |
| 프로덕션 빌드 | `npm run build` | 통과 · JS 207.5KB(gzip 69.5KB) · CSS 15.4KB(gzip 4.1KB) |

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

- 완료: 브랜치 `feat/auto-meeting` 로컬 커밋 · 위 1~2절 전부 · 배포/푸시 없음
- 운영 URL `https://ace1693-coder.github.io/ai-roundtable/` 은 **여전히 v1 수동 버전**이다.
