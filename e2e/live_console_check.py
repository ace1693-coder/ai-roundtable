#!/usr/bin/env python3
"""라이브 사이트 콘솔 청정도 확인 — 4.0은 회의방을 만들면 자동 회의가 바로 시작되므로,
첫 발언이 뜨는 즉시 일시정지해 호출을 2~3회로 묶고 콘솔·CORS 오류를 본다.
(live_pages.py 첫 실행은 20초를 그대로 돌려 분당 20회 IP 제한 429가 콘솔에 1건 남았다.)
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

report: dict = {"checks": [], "consoleErrors": [], "consoleWarnings": [], "pageErrors": [],
                "failedRequests": [], "workerRequests": []}


def check(name: str, ok: bool, detail: str = "") -> None:
    report["checks"].append({"name": name, "ok": ok, "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                                  is_mobile=True, has_touch=True, locale="ko-KR", timezone_id="Asia/Seoul")
        page = ctx.new_page()
        page.on("console", lambda m: (report["consoleErrors"].append(m.text) if m.type == "error"
                                      else report["consoleWarnings"].append(m.text) if m.type == "warning" else None))
        page.on("pageerror", lambda e: report["pageErrors"].append(str(e)))
        page.on("requestfailed", lambda r: report["failedRequests"].append({"url": r.url, "failure": str(r.failure)}))
        page.on("response", lambda r: report["workerRequests"].append({"url": r.url, "status": r.status})
                if "workers.dev" in r.url else None)

        page.goto(LIVE_URL, wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(800)
        page.get_by_test_id("home-settings").click()
        page.wait_for_timeout(300)
        page.get_by_test_id("settings-worker-url").fill(WORKER_URL)
        page.get_by_test_id("settings-access-code").fill(ACCESS_CODE)
        page.get_by_test_id("settings-test").click()
        page.wait_for_timeout(1800)
        status = page.get_by_test_id("settings-status").inner_text()
        check("연결 확인", "openai/gpt-oss-120b" in status, status[:120])
        page.get_by_test_id("settings-save").click()
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        page.get_by_test_id("new-topic").fill("PEO 설비 점검 주기 — 라이브 콘솔 확인")
        page.get_by_test_id("create-room").click()
        page.wait_for_timeout(600)
        check("회의방 진입·자동 회의 시작", page.get_by_test_id("auto-bar").is_visible() or page.get_by_test_id("pause-bar").is_visible())
        page.wait_for_function("() => document.querySelectorAll('[data-testid=msg-model]').length > 0", timeout=120000)
        for _ in range(6):
            try:
                page.get_by_test_id("pause-btn").click(timeout=1500)
                break
            except Exception:
                page.wait_for_timeout(300)
        page.wait_for_timeout(1500)
        models = page.get_by_test_id("msg-model").all_inner_texts()
        report["models"] = models
        check("첫 발언 수신 후 일시정지", bool(models) and page.get_by_test_id("pause-bar").is_visible(), (models[0] if models else "")[:120])
        page.screenshot(path=str(OUT / "live-06-clean-console.png"))

        page.wait_for_timeout(4000)
        check("콘솔 오류 0", not report["consoleErrors"], "; ".join(report["consoleErrors"])[:300])
        check("페이지 오류 0", not report["pageErrors"], "; ".join(report["pageErrors"])[:300])
        check("요청 실패 0", not report["failedRequests"], json.dumps(report["failedRequests"], ensure_ascii=False)[:300])
        codes = [r["status"] for r in report["workerRequests"]]
        report["workerStatuses"] = codes
        check("Worker 응답 전부 200", bool(codes) and all(c == 200 for c in codes), str(codes))
        ctx.close()
        browser.close()

    (OUT / "live_console_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    passed = sum(1 for c in report["checks"] if c["ok"])
    print(f"== {passed}/{len(report['checks'])} 통과 ==")
    return 0 if passed == len(report["checks"]) else 1


if __name__ == "__main__":
    sys.exit(main())
