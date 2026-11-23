"""검은 화면 진단: 라이브 사이트를 모바일 뷰포트로 열어 화면에 실제로 그려진 요소와 오류를 수집한다."""
import json
import sys
from playwright.sync_api import sync_playwright

URL = "https://ace1693-coder.github.io/ai-roundtable/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "screenshots/diag-clean.png"

report = {"url": URL, "console": [], "pageerrors": [], "failed": []}

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
        user_agent="Mozilla/5.0 (Linux; Android 14; SM-A346N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    )
    page = ctx.new_page()
    page.on("console", lambda m: report["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: report["pageerrors"].append(str(e)))
    page.on("requestfailed", lambda r: report["failed"].append(f"{r.url} :: {r.failure}"))
    resp = page.goto(URL, wait_until="load", timeout=45000)
    report["status"] = resp.status if resp else None
    page.wait_for_timeout(3000)

    report["body"] = page.evaluate(
        """() => {
      const cs = getComputedStyle(document.body);
      const root = document.getElementById('root');
      const rc = root ? getComputedStyle(root) : null;
      return {
        bodyBg: cs.backgroundColor, bodyH: document.body.getBoundingClientRect().height,
        scrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight, innerW: window.innerWidth, dpr: window.devicePixelRatio,
        rootHTml: root ? root.innerHTML.slice(0, 400) : null,
        rootRect: root ? root.getBoundingClientRect().toJSON() : null,
        rootH: rc ? rc.height : null,
        sw: !!navigator.serviceWorker,
        swCtrl: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        swRegs: 0,
      };
    }"""
    )
    report["sw_regs"] = page.evaluate("async () => (await navigator.serviceWorker.getRegistrations()).length")
    report["cache_names"] = page.evaluate("async () => await caches.keys()")
    # 화면에 실제로 보이는 요소들의 박스
    report["visible"] = page.evaluate(
        """() => {
      const out = [];
      const walk = (el, depth) => {
        if (depth > 4) return;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') {
          out.push({tag: el.tagName, cls: el.className && el.className.toString().slice(0,60),
                    txt: (el.innerText||'').slice(0,60).replace(/\\n/g,' | '),
                    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                    border: cs.borderTopWidth + ' ' + cs.borderTopColor, radius: cs.borderRadius, bg: cs.backgroundColor});
        }
        for (const c of el.children) walk(c, depth + 1);
      };
      walk(document.body, 0);
      return out.slice(0, 40);
    }"""
    )
    page.screenshot(path=OUT, full_page=False)
    report["screenshot"] = OUT
    browser.close()

print(json.dumps(report, ensure_ascii=False, indent=2))
