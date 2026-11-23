"""검은 화면 재발 방지 검증(로컬 dist).

시나리오
 1. 정상 로드(390×844) — 홈이 그려지고 콘솔 오류 0
 2. localStorage 차단(인앱 웹뷰 흉내) — 예전에는 검은 화면, 지금은 홈이 그려져야 함
 3. localStorage + indexedDB 모두 차단 — 역시 홈이 그려져야 함
 4. 앱 번들(JS) 404 — 인라인 워치독이 안내+캐시 초기화 버튼을 띄워야 함
 5. 서비스워커 — 캐시 airt4-v2 로 등록되고 예전 캐시(airt3-v1)가 삭제되는지
실행: python3 e2e/verify_resilience.py
"""
import functools
import http.server
import json
import socketserver
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = "dist"
UA = (
    "Mozilla/5.0 (Linux; Android 14; SM-A346N) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Mobile Safari/537.36"
)
results = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # 조용히
        pass


def serve():
    handler = functools.partial(Handler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}/"


def new_page(browser, init_script=None):
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=UA
    )
    page = ctx.new_page()
    if init_script:
        page.add_init_script(init_script)
    logs = {"console": [], "pageerror": [], "failed": []}
    page.on("console", lambda m: logs["console"].append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: logs["pageerror"].append(str(e)[:200]))
    page.on("requestfailed", lambda r: logs["failed"].append(r.url))
    return ctx, page, logs


BLOCK_LOCAL = """
Object.defineProperty(window, 'localStorage', { configurable: true,
  get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });
"""
BLOCK_ALL = """
for (const k of ['localStorage','sessionStorage','indexedDB']) {
  Object.defineProperty(window, k, { configurable: true,
    get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });
}
"""


def main():
    httpd, base = serve()
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 1. 정상
        ctx, page, logs = new_page(browser)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(2500)
        home = page.locator(".home").count()
        out["1_normal"] = {
            "home": home,
            "bodyText": page.inner_text("body")[:80],
            "errors": logs["console"] + logs["pageerror"],
            "bootLeft": page.locator("#airt-boot").count(),
        }
        page.screenshot(path="screenshots/verify-1-normal.png")
        ctx.close()

        # 2. localStorage 차단
        ctx, page, logs = new_page(browser, BLOCK_LOCAL)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(3000)
        out["2_localstorage_blocked"] = {
            "home": page.locator(".home").count(),
            "fatal": page.locator("#airt-fatal").count(),
            "bodyText": page.inner_text("body")[:80],
            "errors": logs["console"] + logs["pageerror"],
        }
        page.screenshot(path="screenshots/verify-2-localstorage-blocked.png")
        ctx.close()

        # 3. 전부 차단
        ctx, page, logs = new_page(browser, BLOCK_ALL)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(3000)
        out["3_all_storage_blocked"] = {
            "home": page.locator(".home").count(),
            "fatal": page.locator("#airt-fatal").count(),
            "bodyText": page.inner_text("body")[:80],
            "errors": logs["console"] + logs["pageerror"],
        }
        page.screenshot(path="screenshots/verify-3-all-blocked.png")
        ctx.close()

        # 4. JS 번들 404 → 인라인 워치독
        ctx, page, logs = new_page(browser)
        page.route("**/assets/index-*.js", lambda route: route.fulfill(status=404, body="not found"))
        page.goto(base, wait_until="domcontentloaded")
        page.wait_for_timeout(10000)  # 워치독 9초
        out["4_js_missing"] = {
            "fatal": page.locator("#airt-fatal").count(),
            "button": page.locator("#airt-fatal button").count(),
            "text": page.inner_text("body")[:120],
        }
        page.screenshot(path="screenshots/verify-4-js-missing.png")
        ctx.close()

        # 5. 서비스워커 버전·구캐시 정리 (같은 컨텍스트 재사용: 첫 로드에서 등록 → 두 번째 로드에서 정리 확인)
        ctx, page, logs = new_page(browser)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(1500)
        sw_after_first = page.evaluate(
            "async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, caches: await caches.keys() })"
        )
        # 옛 캐시를 흉내: airt3-v1 에 아무 값이나 넣고 다시 열어 activate 가 지우는지 본다.
        page.evaluate(
            """async () => { const c = await caches.open('airt3-v1'); await c.put('./old.html', new Response('old')); }"""
        )
        page.reload(wait_until="load")
        page.wait_for_timeout(2500)
        sw_after_reload = page.evaluate(
            "async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, caches: await caches.keys(), controlled: !!navigator.serviceWorker.controller })"
        )
        out["5_service_worker"] = {"first": sw_after_first, "after_reload": sw_after_reload}
        # 구캐시 항목을 지우려면 워커가 한 번 더 활성화되어야 한다: 재등록 트리거(새 워커 없음) → activate 는 이미 실행됨
        page.evaluate("async () => { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { await reg.update(); } }")
        page.wait_for_timeout(2000)
        out["5_service_worker"]["caches_final"] = page.evaluate("async () => await caches.keys()")
        ctx.close()

        browser.close()

    httpd.shutdown()
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
