"""인앱 브라우저에서 흔한 '저장소 차단' 상황을 흉내 내 검은 화면을 재현한다."""
import json
import sys
from playwright.sync_api import sync_playwright

URL = "https://ace1693-coder.github.io/ai-roundtable/"
mode = sys.argv[1] if len(sys.argv) > 1 else "localStorage"
OUT = sys.argv[2] if len(sys.argv) > 2 else f"screenshots/diag-{mode}.png"

INIT = {
    "localStorage": """
      Object.defineProperty(window, 'localStorage', { configurable: true,
        get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });
    """,
    "indexedDB": """
      Object.defineProperty(window, 'indexedDB', { configurable: true,
        get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });
    """,
    "both": """
      for (const k of ['localStorage','sessionStorage','indexedDB']) {
        Object.defineProperty(window, k, { configurable: true,
          get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });
      }
    """,
    "none": "",
}

report = {"mode": mode, "console": [], "pageerrors": [], "failed": []}
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
        user_agent="Mozilla/5.0 (Linux; Android 14; SM-A346N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    )
    page = ctx.new_page()
    if INIT[mode]:
        page.add_init_script(INIT[mode])
    page.on("console", lambda m: report["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: report["pageerrors"].append(str(e)[:300]))
    page.on("requestfailed", lambda r: report["failed"].append(f"{r.url} :: {r.failure}"))
    page.goto(URL, wait_until="load", timeout=45000)
    page.wait_for_timeout(3500)
    report["rootHTML"] = page.evaluate("() => document.getElementById('root').innerHTML.slice(0, 300)")
    report["bodyText"] = page.evaluate("() => document.body.innerText.slice(0, 200)")
    page.screenshot(path=OUT)
    report["screenshot"] = OUT
    browser.close()
print(json.dumps(report, ensure_ascii=False, indent=2))
