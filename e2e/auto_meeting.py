#!/usr/bin/env python3
"""로컬 자동 회의 E2E — 실제 브라우저에서 앱의 자동 회의를 끝까지 확인한다.

확인 항목
- 자동 회의 루프: 사회자 결정 → 발언 → 다시 결정 … 이 실제 API 호출 기록으로 이어짐
- 사회자가 정한 순서가 실제 발언자와 일치
- 사용자 끼어들기가 다음 요청에 최우선 지시로 실림
- AI 일시 제외: 끈 AI는 이후 API 호출 0회, 다시 켜면 다시 호출됨
- IndexedDB 저장: 새로고침 후 회의·메시지만 복원
- 응답 시간 실측 표시(모델 줄 · 평균 응답)
- 고정 라운드 없이 종료(사용자 종료) 및 요약

검증용 가짜 Worker 는 이 스크립트 안에서만 뜬다. 앱 산출물에는 포함되지 않는다.
결과: e2e/auto_meeting_report.json, screenshots/auto-*.png
"""

from __future__ import annotations

import json
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SHOTS = ROOT / "screenshots"
APP_PORT = 4180
WORKER_PORT = 8791
APP_URL = f"http://127.0.0.1:{APP_PORT}/"
WORKER_URL = f"http://127.0.0.1:{WORKER_PORT}"
LATENCY_MS = 1200

report: dict = {"appUrl": APP_URL, "workerUrl": WORKER_URL, "checks": [], "requests": [], "consoleErrors": [], "pageErrors": []}
lock = threading.Lock()


def check(name: str, ok: bool, detail: str = "") -> None:
    report["checks"].append({"name": name, "ok": ok, "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


class QuietStatic(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def speech(role: str, index: int) -> str:
    if role == "gptoss":
        return (
            f"{index}번째 GPT-OSS: 코팅 노즐 막힘은 점검 주기를 2주로 줄이면 줄어든다. "
            "근거는 아직 없다. 불량률 로그를 2주만 모아 비교하자."
        )
    if role == "gemini":
        return (
            f"{index}번째 Gemini: 점검 주기를 줄이면 라인 정지가 늘어난다. 먼저 불량률과 정지 시간을 "
            "같이 기록해야 판단할 수 있다. 확인이 필요한 것은 실제 수치다."
        )
    return f"{index}번째 사회자 정리: 쟁점은 점검 주기와 데이터 확보 시점 두 가지다."


def decide_text(next_role: str, index: int) -> str:
    return f"NEXT: {next_role}\n{index}번째 사회자: 지금까지 쟁점은 점검 주기와 데이터 시점이다. {next_role}에게 근거를 더 요구한다."


class MockWorker(SimpleHTTPRequestHandler):
    """실제 Worker 대신 응답 모양만 흉내 내는 검증 서버. 모든 요청을 기록한다."""

    def log_message(self, *args):
        pass

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, x-app-token, x-session-id")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/api/health"):
            self._send(
                200,
                {
                    "ok": True,
                    "app": "ai-roundtable",
                    "version": "4.0.0-e2e",
                    "models": {
                        "gptoss": "openai/gpt-oss-120b",
                        "gemini": "gemini-3.5-flash-lite",
                        "moderator": "gemini-3.5-flash-lite",
                    },
                    "configured": {"groq": True, "gemini": True, "accessToken": True},
                    "allowedOrigin": True,
                },
            )
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            req = {}
        if not self.headers.get("x-app-token"):
            self._send(401, {"ok": False, "code": "unauthorized", "message": "no token"})
            return
        role = req.get("role") or "gptoss"
        phase = req.get("phase") or "open"
        index = int(req.get("turnIndex") or 1)
        with lock:
            report["requests"].append(
                {
                    "role": role,
                    "phase": phase,
                    "path": self.path,
                    "turnIndex": index,
                    "callIndex": req.get("callIndex"),
                    "participants": req.get("participants"),
                    "userDirective": req.get("userDirective"),
                    "decidedNext": None,
                }
            )
            slot = len(report["requests"]) - 1

        if phase == "summary":
            body = {
                "ok": True,
                "text": (
                    "1. 결론: 점검 주기를 2주로 줄이고 불량률·정지 시간을 함께 기록한다.\n"
                    "2. 합의된 것: 데이터 없이 설비를 바꾸지 않는다.\n"
                    "3. 갈린 쟁점: 교체 시점.\n"
                    "4. 확인이 필요한 것: 실제 불량률 수치.\n"
                    "5. 사용자가 지금 할 행동: 3라인 점검표를 만든다."
                ),
                "model": "gemini-3.5-flash-lite",
                "provider": "Google AI Studio",
                "latencyMs": LATENCY_MS,
            }
        elif phase == "decide":
            # 사회자는 늘 gptoss 를 지목한다. 앱이 꺼진 AI를 지목받았을 때 교대로 대체하는지 보기 위한 값.
            body = {
                "ok": True,
                "text": decide_text("gptoss", index),
                "model": "gemini-3.5-flash-lite",
                "provider": "Google AI Studio",
                "latencyMs": LATENCY_MS,
                "decision": {"next": "gptoss"},
            }
            with lock:
                report["requests"][slot]["decidedNext"] = "gptoss"
        else:
            body = {
                "ok": True,
                "text": speech(role, index),
                "model": "openai/gpt-oss-120b" if role == "gptoss" else "gemini-3.5-flash-lite",
                "provider": "GroqCloud" if role == "gptoss" else "Google AI Studio",
                "latencyMs": LATENCY_MS,
                "usage": {"inputTokens": 900, "outputTokens": 300},
            }
        body["session"] = self.headers.get("x-session-id")
        self._send(200, body)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve():
    static = ThreadingHTTPServer(("127.0.0.1", APP_PORT), partial(QuietStatic, directory=str(DIST)))
    worker = ThreadingHTTPServer(("127.0.0.1", WORKER_PORT), MockWorker)
    threading.Thread(target=static.serve_forever, daemon=True).start()
    threading.Thread(target=worker.serve_forever, daemon=True).start()
    return static, worker


def requests_snapshot() -> list[dict]:
    with lock:
        return list(report["requests"])


def wait_requests(n: int, timeout_s: float = 60) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if len(requests_snapshot()) >= n:
            return True
        time.sleep(0.2)
    return False


def pause_meeting(page) -> bool:
    """자동 회의를 멈춘다. 실행 중이면 상단 바, 이미 끝났으면 메뉴를 쓴다."""
    if page.locator("[data-testid=pause-btn]").count():
        page.get_by_test_id("pause-btn").click()
        page.wait_for_timeout(400)
        return True
    if page.locator("[data-testid=menu-btn]").count():
        page.get_by_test_id("menu-btn").click()
        page.wait_for_timeout(250)
        if page.locator("[data-testid=pause-menu-btn]").count():
            label = page.get_by_test_id("pause-menu-btn").inner_text()
            page.get_by_test_id("pause-menu-btn").click()
            page.wait_for_timeout(400)
            return "일시정지" in label
        page.keyboard.press("Escape")
    return False


def idb_counts(page) -> dict:
    js = """
    () => new Promise((resolve) => {
      const req = indexedDB.open('ai-roundtable');
      req.onerror = () => resolve({ error: 'open-failed' });
      req.onsuccess = () => {
        const db = req.result;
        const names = Array.from(db.objectStoreNames);
        if (!names.includes('meetings')) { resolve({ meetings: 0, memories: 0 }); db.close(); return; }
        const tx = db.transaction(['meetings', 'memories'], 'readonly');
        const m = tx.objectStore('meetings').count();
        const mem = tx.objectStore('memories').count();
        tx.oncomplete = () => { resolve({ meetings: m.result, memories: mem.result }); db.close(); };
      };
    })
    """
    return page.evaluate(js)


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist/가 없습니다. 먼저 npm run build")
        return 2
    SHOTS.mkdir(exist_ok=True)
    static, worker = serve()
    time.sleep(0.5)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(
                viewport={"width": 390, "height": 844},
                device_scale_factor=3,
                is_mobile=True,
                has_touch=True,
            )
            page = ctx.new_page()
            page.on("console", lambda m: report["consoleErrors"].append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: report["pageErrors"].append(str(e)))
            page.goto(APP_URL, wait_until="networkidle")
            # E2E 전용: 무료 한도 간격(20초)을 줄여 자동 루프를 빠르게 돌린다.
            page.evaluate("localStorage.setItem('airt3.test.gapMs', '1200'); localStorage.setItem('airt3.test.budget', '40')")
            page.reload(wait_until="networkidle")

            check("홈 화면 렌더", page.locator("text=AI Roundtable").first.is_visible())
            page.screenshot(path=str(SHOTS / "auto-01-home.png"))

            # Worker 설정
            page.get_by_test_id("home-settings").click()
            page.get_by_test_id("settings-worker-url").fill(WORKER_URL)
            page.get_by_test_id("settings-access-code").fill("test-token")
            page.get_by_test_id("settings-test").click()
            page.wait_for_timeout(1000)
            status = page.get_by_test_id("settings-status").inner_text()
            check("연결 확인이 실제 모델명을 보여 준다", "openai/gpt-oss-120b" in status, status[:120])
            page.get_by_test_id("settings-save").click()
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)

            # 회의 생성
            page.get_by_test_id("new-topic").fill("코팅 공정 불량 개선")
            page.get_by_test_id("create-room").click()
            page.wait_for_timeout(400)
            check("회의방 진입", page.get_by_test_id("room-title").is_visible())

            # 1) 사회자 결정 → 발언 순서
            wait_requests(3, 40)
            reqs = requests_snapshot()
            check("첫 호출이 사회자의 다음 발언자 결정이다", bool(reqs) and reqs[0]["role"] == "moderator" and reqs[0]["phase"] == "decide", json.dumps(reqs[:2], ensure_ascii=False))
            check(
                "사회자가 고른 발언자에게 그다음 호출이 간다",
                len(reqs) >= 2 and reqs[0].get("decidedNext") == reqs[1]["role"] and reqs[1]["phase"] != "decide",
                json.dumps(reqs[1], ensure_ascii=False),
            )
            check("참가자 목록을 서버에 함께 보낸다", bool(reqs[0].get("participants")), str(reqs[0].get("participants")))
            page.screenshot(path=str(SHOTS / "auto-02-decided.png"))

            # 2) 응답 시간 실측 표시
            model_lines = page.get_by_test_id("msg-model").all_inner_texts()
            check(
                "말풍선에 실제 모델·제공업체·응답시간 표기",
                any("openai/gpt-oss-120b · GroqCloud" in m for m in model_lines) and any("1.2s" in m for m in model_lines),
                str(model_lines[:3]),
            )
            check("상단에 평균 응답 시간이 보인다", "평균 응답" in page.get_by_test_id("auto-bar").inner_text())

            # 3) 끼어들기 최우선
            page.get_by_test_id("composer-input").fill("라인 정지 위험을 먼저 따져 줘")
            page.get_by_test_id("send-button").click()
            deadline = time.time() + 30
            directed = []
            while time.time() < deadline:
                directed = [r for r in requests_snapshot() if r.get("userDirective")]
                if directed:
                    break
                page.wait_for_timeout(300)
            check(
                "끼어든 말이 다음 요청의 최우선 지시로 실린다",
                bool(directed) and "라인 정지 위험" in (directed[0]["userDirective"] or ""),
                json.dumps(directed[:1], ensure_ascii=False)[:160],
            )
            page.screenshot(path=str(SHOTS / "auto-03-interrupt.png"))

            # 4) AI 일시 제외 — 끈 AI는 호출 0회
            page.get_by_test_id("participants-btn").click()
            page.wait_for_timeout(300)
            page.get_by_test_id("toggle-gptoss").click()
            page.wait_for_timeout(300)
            marker = len(requests_snapshot())
            page.get_by_test_id("sheet-close").click()
            page.wait_for_timeout(4200)
            after_off = requests_snapshot()[marker:]
            gpt_after_off = [r for r in after_off if r["role"] == "gptoss"]
            check("GPT-OSS를 끄면 이후 호출이 0회", len(gpt_after_off) == 0, f"이후 {len(after_off)}건 중 gptoss {len(gpt_after_off)}건")
            check("끈 상태에서도 회의는 계속 돈다", len(after_off) >= 1, f"{len(after_off)}건")
            page.screenshot(path=str(SHOTS / "auto-04-excluded.png"))

            # 다시 켜기
            page.get_by_test_id("participants-btn").click()
            page.wait_for_timeout(300)
            page.get_by_test_id("toggle-gptoss").click()
            page.wait_for_timeout(300)
            page.get_by_test_id("sheet-close").click()
            deadline = time.time() + 25
            revived = False
            while time.time() < deadline:
                tail = requests_snapshot()[marker:]
                if any(r["role"] == "gptoss" for r in tail):
                    revived = True
                    break
                page.wait_for_timeout(300)
            check("다시 켜면 다시 호출된다", revived)

            # 5) 일시정지 → 호출 멈춤, 재개 → 다시 진행
            page.wait_for_timeout(500)
            check("일시정지 버튼을 누를 수 있다", pause_meeting(page))
            paused_at = len(requests_snapshot())
            page.wait_for_timeout(2600)
            still_paused = len(requests_snapshot())
            check("일시정지 중에는 API를 부르지 않는다", paused_at == still_paused, f"{paused_at}→{still_paused}")
            page.get_by_test_id("resume-btn").click()
            deadline = time.time() + 12
            resumed = False
            while time.time() < deadline:
                if len(requests_snapshot()) > still_paused:
                    resumed = True
                    break
                page.wait_for_timeout(300)
            check("재개하면 다시 진행한다", resumed)

            # 5-1) 공동 기억 저장 → IndexedDB
            page.locator("[data-testid=message]").last.click()
            page.wait_for_timeout(200)
            if page.locator("[data-testid=msg-save-memory]").count():
                page.get_by_test_id("msg-save-memory").click()
                page.wait_for_timeout(300)
                page.get_by_test_id("save-memory-submit").click()
                page.wait_for_timeout(600)
            mem_counts = idb_counts(page)
            check("공동 기억이 IndexedDB에 저장된다", mem_counts.get("memories", 0) >= 1, json.dumps(mem_counts))

            # 6) IndexedDB 저장 + 새로고침 복원
            pause_meeting(page)
            page.wait_for_timeout(800)
            before_count = page.locator("[data-testid=message]").count()
            counts = idb_counts(page)
            check("IndexedDB에 회의가 저장된다", counts.get("meetings", 0) >= 1, json.dumps(counts))
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(1500)
            pause_meeting(page)
            check("새로고침해도 회의방이 복원된다", page.get_by_test_id("room-title").is_visible())
            after_count = page.locator("[data-testid=message]").count()
            check("메시지가 IndexedDB에서 그대로 복원된다", after_count >= before_count and before_count > 0, f"{before_count}→{after_count}")
            page.screenshot(path=str(SHOTS / "auto-05-restored.png"))

            # 7) 사용자 종료 → 사회자 최종 정리
            page.get_by_test_id("menu-btn").click()
            page.get_by_test_id("end-btn").click()
            summary = ""
            deadline = time.time() + 30
            while time.time() < deadline:
                summary = page.get_by_test_id("summary-text").inner_text()
                if "결론" in summary:
                    break
                page.wait_for_timeout(400)
            check("사용자 종료 시 사회자 최종 정리가 남는다", "결론" in summary and "행동" in summary, summary[:80])
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            check("종료 상태 표시", page.get_by_test_id("ended-bar").is_visible())
            page.screenshot(path=str(SHOTS / "auto-06-ended.png"))

            # 8) 고정 라운드 없이 진행 — 호출 수가 설정값(5)을 넘을 수 있다
            total_calls = max((r.get("callIndex") or 0) for r in requests_snapshot()) if requests_snapshot() else 0
            check("고정 라운드 상한 없이 예산까지 진행한다", total_calls > 5, f"최대 callIndex {total_calls}")
            report["callIndexMax"] = total_calls
            report["requestCount"] = len(requests_snapshot())
            browser.close()
    finally:
        static.shutdown()
        worker.shutdown()

    check("콘솔 에러 0건", len(report["consoleErrors"]) == 0, str(report["consoleErrors"][:3]))
    check("페이지 에러 0건", len(report["pageErrors"]) == 0, str(report["pageErrors"][:3]))
    report["passed"] = sum(1 for c in report["checks"] if c["ok"])
    report["total"] = len(report["checks"])
    (ROOT / "e2e" / "auto_meeting_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{report['passed']}/{report['total']} 통과")
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
