"""구버전 서비스워커 캐시(airt3-v1)가 새 워커(airt4-v2) 활성화에서 지워지는지 검증.

실제 폰 상황: 예전 방문으로 airt3-v1 캐시가 남은 기기가 새 배포를 받았을 때,
새 워커의 activate 가 구캐시를 지우고 화면이 정상으로 돌아와야 한다.
실행: python3 e2e/verify_sw_upgrade.py
"""
import functools
import http.server
import json
import pathlib
import shutil
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = "dist"
UA = (
    "Mozilla/5.0 (Linux; Android 14; SM-A346N) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Mobile Safari/537.36"
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


OLD_SW_SRC = pathlib.Path("e2e/fixtures/sw-v1.js")


def main():
    # 구버전 워커를 같은 출처의 다른 경로(./sw-old.js)로 잠깐 내려 준다(배포 산출물에는 포함되지 않는다).
    shutil.copyfile(OLD_SW_SRC, pathlib.Path(ROOT) / "sw-old.js")
    handler = functools.partial(Handler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    base = f"http://127.0.0.1:{httpd.server_address[1]}/"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=UA
        )
        page = ctx.new_page()
        page.goto(base, wait_until="load")
        page.wait_for_timeout(1500)

        # 예전 방문 기기 상태로 되돌린 뒤, 구버전 워커(v1)를 설치시킨다 → airt3-v1 캐시가 생긴다.
        page.evaluate(
            """async () => {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map((r) => r.unregister()));
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }"""
        )
        page.evaluate(
            """async () => {
              await navigator.serviceWorker.register('./sw-old.js', { scope: './' });
              await new Promise((resolve) => {
                const t = setInterval(() => { if (navigator.serviceWorker.controller) { clearInterval(t); resolve(); } }, 100);
                setTimeout(() => { clearInterval(t); resolve(); }, 10000);
              });
            }"""
        )
        page.wait_for_timeout(1500)
        page.evaluate(
            """async () => { const c = await caches.open('airt3-v1'); await c.put('./index.html', new Response('<html>old-airt3</html>', { headers: { 'content-type': 'text/html' } })); }"""
        )
        out["with_old_worker"] = page.evaluate("async () => await caches.keys()")

        # 새 배포를 받은 상황: 같은 범위에 새 워커(sw.js)를 등록하면 install → skipWaiting → activate.
        activated = page.evaluate(
            """async () => {
              await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
              await new Promise((resolve) => setTimeout(resolve, 4000));
              const reg = await navigator.serviceWorker.getRegistration();
              return !!(reg && reg.active && reg.active.scriptURL.endsWith('/sw.js'));
            }"""
        )
        page.wait_for_timeout(2000)
        out["after_activate"] = {
            "activated": activated,
            "caches": page.evaluate("async () => await caches.keys()"),
            "old_index_gone": page.evaluate(
                "async () => { const c = await caches.open('airt3-v1'); const hit = await c.match('./index.html'); return hit === undefined; }"
            ),
        }

        page.reload(wait_until="load")
        page.wait_for_timeout(2500)
        out["after_reload"] = {
            "home": page.locator(".home").count(),
            "fatal": page.locator("#airt-fatal").count(),
            "boot": page.locator("#airt-boot").count(),
        }
        page.screenshot(path="screenshots/verify-5-sw-upgrade.png")
        ctx.close()
        browser.close()

    httpd.shutdown()
    (pathlib.Path(ROOT) / "sw-old.js").unlink(missing_ok=True)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
