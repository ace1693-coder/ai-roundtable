#!/usr/bin/env python3
"""배포된 GitHub Pages 라이브 사이트 검증 — 실제 Cloudflare Worker와 통신한다.

확인
- 라이브 URL이 4.0 화면을 서빙하는지
- 설정에서 Worker 주소 + 개인용 패스코드로 /api/health 연결 확인
- 자동 회의 첫 발언까지 실제 Worker 호출(Groq·Gemini)이 성공하는지
- 콘솔 오류·페이지 오류·CORS 실패 요청이 없는지
결과: downloads/ai-roundtable-deploy/live_report.json, live-01~04.png
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

LIVE_URL = "https://ace1693-coder.github.io/ai-roundtable/"
WORKER_URL = "https://ai-roundtable-api.gimnaggyun1.workers.dev"
ACCESS_CODE = "airt_20261123_knk_7f9a3c"
OUT = Path("/workspace/downloads/ai-roundtable-deploy")

report: dict = {
    "appUrl": LIVE_URL,
    "workerUrl": WORKER_URL,
    "checks": [],
    "consoleErrors": [],
    "consoleWarnings": [],
    "pageErrors": [],
    "failedRequests": [],
    "workerRequests": [],
    "messages": [],
}


def check(name: str, ok: bool, detail: str = "") -> None:
    report["checks"].append({"name": name, "ok": ok, "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = ctx.new_page()

        def on_response(resp):
            if "workers.dev" in resp.url:
                entry = {"url": resp.url, "status": resp.status}
                try:
                    if resp.url.endswith("/api/health"):
                        entry["body"] = resp.text()[:400]
                except Exception:
                    pass
                report["workerRequests"].append(entry)

        page.on("console", lambda m: (report["consoleErrors"].append(m.text) if m.type == "error"
                                      else report["consoleWarnings"].append(m.text) if m.type == "warning" else None))
        page.on("pageerror", lambda e: report["pageErrors"].append(str(e)))
        page.on("requestfailed", lambda r: report["failedRequests"].append({"url": r.url, "failure": str(r.failure)}))
        page.on("response", on_response)

        page.goto(LIVE_URL, wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(1200)
        body = page.inner_text("body")[:300]
        report["homeText"] = body
        check("라이브 페이지 로드(390×844)", "AI Roundtable" in body, body.replace("\n", " | ")[:160])
        page.screenshot(path=str(OUT / "live-01-home.png"))

        # 라이브 번들이 방금 배포한 4.0 산출물인지 (스크립트 파일명 = main 79e8b1b 빌드)
        bundle = page.evaluate("() => Array.from(document.scripts).map(s => s.src).join(',')")
        report["bundle"] = bundle
        check("라이브 번들이 4.0 빌드(index-DCxeMt9I.js)", "index-DCxeMt9I.js" in (bundle or ""), bundle[:120])

        # 설정 → Worker 연결 확인
        page.get_by_test_id("home-settings").click()
        page.wait_for_timeout(300)
        page.get_by_test_id("settings-worker-url").fill(WORKER_URL)
        page.get_by_test_id("settings-access-code").fill(ACCESS_CODE)
        page.get_by_test_id("settings-test").click()
        page.wait_for_timeout(2500)
        status = page.get_by_test_id("settings-status").inner_text()
        report["settingsStatus"] = status
        check("연결 확인 성공(모델명 표시)", "openai/gpt-oss-120b" in status, status[:200])
        check("Worker 비밀키 설정됨(Groq·Gemini·패스코드)", "O" in status and "X" not in status.replace("O", ""), status[:200])
        page.screenshot(path=str(OUT / "live-02-settings.png"))
        page.get_by_test_id("settings-save").click()
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        # 회의 생성 → 자동 회의 시작
        page.get_by_test_id("new-topic").fill("PEO 코팅 설비 점검 주기 단축 검토")
        page.get_by_test_id("create-room").click()
        page.wait_for_timeout(600)
        check("회의방 진입", page.get_by_test_id("room-title").is_visible())
        page.screenshot(path=str(OUT / "live-03-room.png"))

        try:
            page.get_by_test_id("start-auto").click(timeout=5000)
        except Exception as exc:  # 이미 자동 시작된 경우
            report["startAutoNote"] = str(exc)[:120]

        # 첫 AI 발언 대기(최대 150초)
        first_ok = False
        try:
            page.wait_for_function(
                "() => document.querySelectorAll('[data-testid=msg-model]').length > 0",
                timeout=150000,
            )
            first_ok = True
        except Exception as exc:
            report["waitNote"] = str(exc)[:200]

        models = page.get_by_test_id("msg-model").all_inner_texts()
        texts = page.get_by_test_id("msg-text").all_inner_texts()
        roles = page.get_by_test_id("msg-role").all_inner_texts()
        report["messages"] = [
            {"role": roles[i] if i < len(roles) else "", "model": models[i] if i < len(models) else "", "text": t[:400]}
            for i, t in enumerate(texts)
        ]
        check("실제 AI 발언 도착", first_ok and bool(texts), json.dumps(report["messages"][:2], ensure_ascii=False)[:300])
        if models:
            check("모델 줄에 실제 모델 표시", any("gpt-oss" in m or "gemini" in m for m in models), " / ".join(models[:3]))
        auto_bar = page.get_by_test_id("auto-bar").inner_text() if page.get_by_test_id("auto-bar").count() else ""
        report["autoBar"] = auto_bar
        page.screenshot(path=str(OUT / "live-04-meeting.png"))

        # 한 번 더 진행되는지 확인 후 일시정지 (호출 최소화)
        page.wait_for_timeout(20000)
        models2 = page.get_by_test_id("msg-model").all_inner_texts()
        report["callsAfterWait"] = len(models2) - len(models)
        try:
            page.get_by_test_id("pause-btn").click(timeout=3000)
            report["paused"] = True
        except Exception as exc:
            report["paused"] = False
            report["pauseNote"] = str(exc)[:120]
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "live-05-paused.png"))

        check("두 번째 호출도 실제로 진행", report["callsAfterWait"] >= 1, f"추가 발언 {report['callsAfterWait']}건")
        check("콘솔 오류 없음", not report["consoleErrors"], "; ".join(report["consoleErrors"])[:300])
        check("페이지 오류 없음", not report["pageErrors"], "; ".join(report["pageErrors"])[:300])
        cors = [r for r in report["failedRequests"] if "workers.dev" in r["url"]]
        check("Worker 요청 실패/CORS 차단 없음", not cors, json.dumps(cors, ensure_ascii=False)[:300])
        health = [r for r in report["workerRequests"] if r["url"].endswith("/api/health")]
        report["healthStatus"] = health[-1] if health else None
        check("/api/health 200", bool(health) and health[-1]["status"] == 200, json.dumps(health[-1] if health else {}, ensure_ascii=False)[:200])

        ctx.close()
        browser.close()

    (OUT / "live_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    passed = sum(1 for c in report["checks"] if c["ok"])
    print(f"== {passed}/{len(report['checks'])} 통과 ==")
    return 0 if passed == len(report["checks"]) else 1


if __name__ == "__main__":
    sys.exit(main())
