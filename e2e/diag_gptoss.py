"""진단: 저장된 회의가 v4 스키마(enabledAi/roles/maxTurns 등)가 아닐 때 'Cannot read properties of undefined (reading ...)' 재현.

실행: python3 e2e/diag_gptoss.py   (dist/ 정적 서빙, 390x844)
"""
import functools
import http.server
import json
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


def serve():
    handler = functools.partial(Handler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}/"


NOW = 1_766_000_000_000

LEGACY_V3 = """
(() => {
  const now = %d;
  const meeting = {
    id: 'mt_legacy1', title: '옛 3.0 회의', topic: '옛 3.0 회의', domain: 'general',
    createdAt: now - 86400000, updatedAt: now - 3600000,
    roles: { chatgpt: '전략 분석가', gemini: '검증 담당', pickle: '사회자' },
    status: 'ended', queue: [], usedMemoryIds: [], repeatWarnings: 0,
    messages: [
      { id: 'm1', authorId: 'chatgpt', text: '옛 발언 하나', createdAt: now - 7200000, source: 'api', roleAtTime: '전략 분석가' },
      { id: 'm2', authorId: 'pickle', text: '옛 사회자 정리', createdAt: now - 7000000, source: 'api', roleAtTime: '사회자' }
    ]
  };
  localStorage.setItem('airt3.v1.settings', JSON.stringify({ displayName: '나', avatarEmoji: '', apiKeys: { openai: '', gemini: '' }, autoApi: false, models: { openai: '', gemini: '' } }));
  localStorage.setItem('airt3.v1.meetings', JSON.stringify([meeting]));
  localStorage.setItem('airt3.v1.memories', JSON.stringify([]));
  localStorage.setItem('airt3.v1.session', JSON.stringify({ activeMeetingId: null }));
})();
""" % NOW

# v4 처럼 보이지만 신규 중첩 필드(enabledAi/roles.새키)가 빠진 회의를 IndexedDB 에 직접 넣는다.
MISSING_FIELDS = """
(async () => {
  const now = %d;
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('ai-roundtable', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('meetings')) d.createObjectStore('meetings', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('memories')) d.createObjectStore('memories', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const meeting = {
    id: 'mt_nofields', title: '필드 빠진 회의', topic: '필드 빠진 회의', domain: 'general',
    createdAt: now - 100000, updatedAt: now - 5000,
    roles: { gptoss: '전략 분석가' },
    status: 'active', queue: [], usedMemoryIds: [], repeatWarnings: 0,
    messages: [
      { id: 'm1', authorId: 'gptoss', text: 'GPT-OSS 발언', createdAt: now - 90000, source: 'api', roleAtTime: '전략 분석가' }
    ]
  };
  await new Promise((res, rej) => {
    const tx = db.transaction('meetings', 'readwrite');
    tx.objectStore('meetings').put(meeting);
    tx.objectStore('meetings').put({ id: 'mt_ok', title: '정상 v4 회의', topic: '정상', domain: 'general',
      createdAt: now - 200000, updatedAt: now - 3000, roles: { gptoss: 'a', gemini: 'b', moderator: 'c' },
      status: 'ended', queue: [], usedMemoryIds: [], repeatWarnings: 0, enabledAi: { gptoss: true, gemini: true, moderator: true },
      maxTurns: 5, auto: false, awaitingDecision: false, callCount: 0, messages: [] });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close();
  localStorage.setItem('airt3.v1.settings', JSON.stringify({ displayName: '나', avatarEmoji: '', workerUrl: '', accessCode: '', maxTurns: 5 }));
})();
""" % NOW


def run(browser, base, label, init, clicks):
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=UA
    )
    page = ctx.new_page()
    page.add_init_script(init)
    logs = {"console": [], "pageerror": []}
    page.on("console", lambda m: logs["console"].append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: logs["pageerror"].append(str(e)[:300]))
    page.goto(base, wait_until="load")
    page.wait_for_timeout(2500)
    steps = []
    for name, selector in clicks:
        try:
            page.locator(selector).first.click(timeout=4000)
            page.wait_for_timeout(1200)
            steps.append({"click": name, "ok": True, "crash": page.locator(".crash").count(), "body": page.inner_text("body")[:160]})
        except Exception as e:  # noqa: BLE001
            steps.append({"click": name, "ok": False, "err": str(e)[:200], "crash": page.locator(".crash").count(), "body": page.inner_text("body")[:200]})
    out = {
        "label": label,
        "home": page.locator(".home").count(),
        "steps": steps,
        "pageerror": logs["pageerror"],
        "console": logs["console"],
        "crashText": page.inner_text(".crash")[:400] if page.locator(".crash").count() else "",
    }
    page.screenshot(path=f"screenshots/diag-{label}.png")
    ctx.close()
    return out


def main():
    httpd, base = serve()
    res = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        res.append(run(browser, base, "legacy-v3", LEGACY_V3, [
            ("open-meeting", "[data-testid=meeting-item] .meeting-open"),
            ("participants", "[data-testid=participants-btn]"),
        ]))
        res.append(run(browser, base, "missing-fields", MISSING_FIELDS, [
            ("open-meeting", "[data-testid=meeting-item]:has-text('필드 빠진') .meeting-open"),
            ("participants", "[data-testid=participants-btn]"),
            ("start-auto", "[data-testid=start-auto]"),
        ]))
        browser.close()
    httpd.shutdown()
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
