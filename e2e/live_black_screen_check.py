"""라이브 배포 실서버 검증(390×844 · Android UA).

1) 정상 로드 — 홈 렌더, 콘솔/페이지 오류 0, 서비스워커 캐시 airt4-v2
2) localStorage 차단(인앱 브라우저 흉내) — 수정 전에는 검은 화면이던 조건
결과: downloads/ai-roundtable-mobile-fixed.png, downloads/ai-roundtable-live-storage-blocked.png
실행: python3 e2e/live_black_screen_check.py
"""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "https://ace1693-coder.github.io/ai-roundtable/"
SHOTS = Path("/workspace/downloads")
UA = (
    "Mozilla/5.0 (Linux; Android 14; SM-A346N) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Mobile Safari/537.36"
)
BLOCK_LOCAL = """
Object.defineProperty(window, 'localStorage', { configurable: true,
  get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });
"""

out = {}
with sync_playwright() as p:
    browser = p.chromium.launch()

    def run(init, shot):
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=UA
        )
        page = ctx.new_page()
        if init:
            page.add_init_script(init)
        logs = {"console": [], "pageerror": [], "failed": []}
        page.on("console", lambda m: logs["console"].append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: logs["pageerror"].append(str(e)[:200]))
        page.on("requestfailed", lambda r: logs["failed"].append(r.url))
        page.goto(URL, wait_until="load", timeout=60000)
        page.wait_for_timeout(3500)
        data = {
            "home": page.locator(".home").count(),
            "fatal": page.locator("#airt-fatal").count(),
            "boot": page.locator("#airt-boot").count(),
            "text": page.inner_text("body")[:90].replace("\n", " / "),
            "bg": page.evaluate("() => getComputedStyle(document.body).backgroundColor"),
            "innerH": page.evaluate("() => window.innerHeight"),
            "homeH": page.evaluate("() => { const el = document.querySelector('.home'); return el ? Math.round(el.getBoundingClientRect().height) : null; }"),
            "sw": page.evaluate("async () => ({ caches: await caches.keys(), controller: !!navigator.serviceWorker.controller })"),
            "errors": logs["console"] + logs["pageerror"],
            "failedReq": logs["failed"],
        }
        page.screenshot(path=str(shot))
        ctx.close()
        return data

    out["normal"] = run(None, SHOTS / "ai-roundtable-mobile-fixed.png")
    out["storage_blocked"] = run(BLOCK_LOCAL, SHOTS / "ai-roundtable-live-storage-blocked.png")
    browser.close()

print(json.dumps(out, ensure_ascii=False, indent=2))
