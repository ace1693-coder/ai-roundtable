"""필수 8개 환경 검증(로컬 dist, 390×844 Android Chrome 흉내).

장애: `Cannot read properties of undefined (reading 'gptoss')`
  원인 — 저장된 회의(IndexedDB/3.0 localStorage)를 정규화 없이 화면에 넣어
  `meeting.enabledAi['gptoss']`(RoomScreen 참가자 목록)에서 죽었다.
이 스크립트는 그 8개 환경에서 첫 화면 + 회의방(생성·기존 회의 열기)이
콘솔 오류 0 / 페이지 오류 0 으로 뜨는지 실제로 확인한다.

실행: python3 e2e/verify_schema8.py
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
VP = {"width": 390, "height": 844}
NOW = int(time.time() * 1000)
OUT = {"scenarios": [], "passed": 0, "failed": 0}


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Handler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}/"


def new_page(browser):
    ctx = browser.new_context(viewport=VP, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=UA)
    page = ctx.new_page()
    logs = {"console": [], "pageerror": []}
    page.on("console", lambda m: logs["console"].append(f"{m.type}: {m.text[:300]}") if m.type == "error" else None)
    page.on("pageerror", lambda e: logs["pageerror"].append(str(e)[:300]))
    return ctx, page, logs


def idb_meetings(page):
    return page.evaluate(
        """async () => {
      const open = () => new Promise((res, rej) => { const r = indexedDB.open('ai-roundtable', 1);
        r.onupgradeneeded = () => { const d = r.result;
          if (!d.objectStoreNames.contains('meetings')) d.createObjectStore('meetings', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('memories')) d.createObjectStore('memories', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const db = await open();
      const rows = await new Promise((res, rej) => { const q = db.transaction('meetings','readonly').objectStore('meetings').getAll();
        q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
      db.close();
      return rows.map(r => ({ id: r.id, title: r.title, enabledAi: r.enabledAi, messages: (r.messages||[]).length,
        authors: [...new Set((r.messages||[]).map(m => m.authorId))], auto: r.auto }));
    }"""
    )


def seed_indexeddb(page, rows):
    page.evaluate(
        """async (rows) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('ai-roundtable', 1);
        r.onupgradeneeded = () => { const d = r.result;
          if (!d.objectStoreNames.contains('meetings')) d.createObjectStore('meetings', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('memories')) d.createObjectStore('memories', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      await new Promise((res, rej) => { const tx = db.transaction('meetings','readwrite');
        for (const row of rows) tx.objectStore('meetings').put(row);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      db.close();
    }""",
        rows,
    )


def check(name, page, logs, expects):
    """expects: [(설명, bool)] — 실패 사유를 그대로 남긴다."""
    crash = page.locator(".crash").count()
    body = page.inner_text("body")[:200].replace("\n", " | ")
    rows = [{"check": d, "ok": bool(v)} for d, v in expects]
    rows.append({"check": "복구 화면(.crash)이 뜨지 않았다", "ok": crash == 0})
    rows.append({"check": "콘솔 오류 0건", "ok": len(logs["console"]) == 0, "detail": logs["console"][:3]})
    rows.append({"check": "페이지 오류 0건", "ok": len(logs["pageerror"]) == 0, "detail": logs["pageerror"][:3]})
    ok = all(r["ok"] for r in rows)
    OUT["scenarios"].append({"name": name, "ok": ok, "rows": rows, "body": body})
    OUT["passed" if ok else "failed"] += 1
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        for r in rows:
            if not r["ok"]:
                print("   - 실패:", r)


LEGACY_V3_MEETING = {
    "id": "mt_v3",
    "title": "3.0 코팅 불량 회의",
    "topic": "코팅 불량 개선",
    "domain": "manufacturing",
    "createdAt": NOW - 90_000_000,
    "updatedAt": NOW - 3_600_000,
    "roles": {"chatgpt": "공정혁신 전문가", "gemini": "설비·품질·안전 검증 전문가", "pickle": "생산성·원가절감 사회자"},
    "status": "ended",
    "queue": ["chatgpt"],
    "usedMemoryIds": [],
    "repeatWarnings": 0,
    "summary": "3.0 요약: 온도 편차를 2주간 기록한다.",
    "messages": [
        {"id": "v3m1", "authorId": "chatgpt", "text": "3.0 첫 발언 — 온도 편차부터 보자", "createdAt": NOW - 90_000_000, "source": "api", "roleAtTime": "공정혁신 전문가"},
        {"id": "v3m2", "authorId": "pickle", "text": "3.0 사회자 — 기록 주기를 정하자", "createdAt": NOW - 89_000_000, "source": "api", "roleAtTime": "생산성·원가절감 사회자"},
    ],
}

BROKEN_V4_MEETING = {
    "id": "mt_nofields",
    "title": "필드 빠진 회의",
    "topic": "필드 빠진 회의",
    "domain": "general",
    "createdAt": NOW - 500_000,
    "updatedAt": NOW - 5_000,
    "roles": {"gptoss": "전략 분석가"},
    "status": "active",
    "queue": [],
    "usedMemoryIds": [],
    "repeatWarnings": 0,
    "messages": [
        {"id": "bm1", "authorId": "gptoss", "text": "GPT-OSS 발언 — 이 방이 예전에 죽던 지점", "createdAt": NOW - 400_000, "source": "api", "roleAtTime": "전략 분석가"}
    ],
}

LEGACY_SETTINGS = {
    "displayName": "낙균",
    "avatarEmoji": "",
    "apiKeys": {"openai": "", "gemini": ""},
    "autoApi": False,
    "models": {"openai": "gpt-4o-mini", "gemini": "gemini-2.5"},
}


def open_room_sheets(page, sheet_buttons=("participants", "menu")):
    """회의방에서 참가자·메뉴 시트를 열고 닫는다(장애가 나던 실제 화면)."""
    for name in sheet_buttons:
        page.locator(f"[data-testid={name}-btn]").first.click()
        page.wait_for_timeout(500)
        close_sheet(page)


def close_sheet(page):
    page.locator("[data-testid=sheet-close]").last.click()
    page.wait_for_timeout(250)


def main():
    httpd, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ── 1. 저장 데이터가 전혀 없는 새 사용자 ─────────────────────────────
        ctx, page, logs = new_page(browser)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(2200)
        home = page.locator(".home").count()
        page.fill("[data-testid=new-topic]", "새 사용자 테스트 회의")
        page.click("[data-testid=create-room]")
        page.wait_for_timeout(1200)
        page.fill("[data-testid=composer-input]", "첫 질문입니다")
        page.click("[data-testid=send-button]")
        page.wait_for_timeout(800)
        msgs1 = page.locator("[data-testid=message]").count()
        open_room_sheets(page)
        page.reload(wait_until="load")
        page.wait_for_timeout(2000)
        msgs2 = page.locator("[data-testid=message]").count()
        page.locator("[data-testid=participants-btn]").click()
        page.wait_for_timeout(500)
        participants1 = page.locator("[data-testid=participant-item]").count()
        close_sheet(page)
        check("1. 데이터 없는 새 사용자 — 첫 화면·회의 생성·새로고침 유지", page, logs, [
            ("첫 화면(.home)이 그려졌다", home == 1),
            ("회의방이 열렸다", page.locator(".room").count() == 1),
            ("보낸 메시지가 보인다", msgs1 >= 1),
            ("새로고침 후에도 회의방·메시지가 남는다", msgs2 >= msgs1),
            ("참가자 목록에 3명이 나온다", participants1 >= 3),
        ])
        page.screenshot(path="screenshots/schema-1-new-user.png")
        ctx.close()

        # ── 2. 이전 버전(3.0) 설정·회의가 저장된 사용자 ──────────────────────
        ctx, page, logs = new_page(browser)
        page.goto(base, wait_until="load")
        page.evaluate(
            """(data) => {
              localStorage.setItem('airt3.v1.settings', JSON.stringify(data.settings));
              localStorage.setItem('airt3.v1.meetings', JSON.stringify([data.meeting]));
              localStorage.setItem('airt3.v1.memories', JSON.stringify([{ id:'mem1', title:'온도 편차', body:'2주간 기록', status:'검증된 사실', type:'사실', tags:['코팅'], createdAt: 1, updatedAt: 2 }]));
            }""",
            {"settings": LEGACY_SETTINGS, "meeting": LEGACY_V3_MEETING},
        )
        page.reload(wait_until="load")
        page.wait_for_timeout(2200)
        home2 = page.locator(".home").count()
        list_text = page.inner_text("[data-testid=meeting-list]") if page.locator("[data-testid=meeting-list]").count() else ""
        page.locator("[data-testid=meeting-item] .meeting-open").first.click()
        page.wait_for_timeout(1000)
        room = page.locator(".room").count()
        msg_text = page.inner_text("[data-testid=msg-list]") if room else ""
        page.locator("[data-testid=participants-btn]").click()
        page.wait_for_timeout(500)
        participants2 = page.locator("[data-testid=participant-item]").count()
        sheet_text2 = page.inner_text("[data-testid=participants-sheet]")
        close_sheet(page)
        page.locator("[data-testid=menu-btn]").click()
        page.wait_for_timeout(300)
        page.locator("[data-testid=summary-open]").first.click()
        page.wait_for_timeout(400)
        summary = page.locator("[data-testid=summary-text]").inner_text() if page.locator("[data-testid=summary-text]").count() else ""
        close_sheet(page)
        migrated = idb_meetings(page)
        legacy_kept = page.evaluate("() => !!localStorage.getItem('airt3.v1.meetings')")
        check("2. 3.0 저장 데이터 사용자 — 마이그레이션·기존 회의 열기", page, logs, [
            ("첫 화면이 그려졌다", home2 == 1),
            ("예전 회의가 목록에 나온다", "3.0 코팅 불량 회의" in list_text),
            ("작성자 이름이 새 참가자로 표시된다", "GPT-OSS" in list_text or "사회자" in list_text),
            ("기존 회의방이 열린다", room == 1),
            ("예전 발언 본문이 보존됐다", "3.0 첫 발언" in msg_text and "3.0 사회자" in msg_text),
            ("참가자 목록이 정상 표시된다", participants2 >= 3),
            ("예전 역할명이 참가자 목록에 보인다", "공정혁신 전문가" in sheet_text2),
            ("3.0 요약문이 보존됐다", "3.0 요약" in summary),
            ("IndexedDB 로 옮긴 기록에 enabledAi 가 채워졌다", bool(migrated) and all(m.get("enabledAi") for m in migrated)),
            ("예전 localStorage 원본도 그대로 남아 있다", legacy_kept),
        ])
        page.screenshot(path="screenshots/schema-2-legacy-v3.png")
        ctx.close()

        # ── 3. gptoss 설정/중첩 객체가 빠진 사용자 ───────────────────────────
        ctx, page, logs = new_page(browser)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(1200)
        seed_indexeddb(page, [BROKEN_V4_MEETING])
        page.evaluate(
            "(s) => { localStorage.setItem('airt3.v1.settings', JSON.stringify(s)); }",
            {"displayName": "낙균", "avatarEmoji": "", "workerUrl": "", "accessCode": "", "maxTurns": 5},
        )
        page.reload(wait_until="load")
        page.wait_for_timeout(2200)
        home3 = page.locator(".home").count()
        page.locator("[data-testid=meeting-item] .meeting-open").first.click()
        page.wait_for_timeout(1000)
        room3 = page.locator(".room").count()
        open_room_sheets(page)
        page.locator("[data-testid=participants-btn]").click()
        page.wait_for_timeout(500)
        participants3 = page.locator("[data-testid=participant-item]").count()
        close_sheet(page)
        page.locator("[data-testid=open-settings-missing]").first.click()  # Worker 미설정 → 설정 시트 안내
        page.wait_for_timeout(700)
        body3 = page.inner_text("body")
        close_sheet(page)
        fixed = idb_meetings(page)
        check("3. enabledAi(중첩 객체) 누락 회의 — 장애 지점 복구", page, logs, [
            ("첫 화면이 그려졌다", home3 == 1),
            ("회의방이 열린다", room3 == 1),
            ("참가자 목록(장애 지점)이 정상 표시된다", participants3 >= 3),
            ("빠진 enabledAi 가 채워져 저장됐다", bool(fixed) and all(m.get("enabledAi") for m in fixed)),
            ("Worker 미설정 안내가 나온다", "설정" in body3 or "Worker" in body3),
        ])
        page.screenshot(path="screenshots/schema-3-missing-fields.png")
        ctx.close()

        # ── 4. localStorage 접근 차단 ────────────────────────────────────────
        ctx, page, logs = new_page(browser)
        page.add_init_script(
            """Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Access is denied for this document.','SecurityError');}});"""
        )
        page.goto(base, wait_until="load")
        page.wait_for_timeout(2500)
        home4 = page.locator(".home").count()
        page.fill("[data-testid=new-topic]", "차단 환경 회의")
        page.click("[data-testid=create-room]")
        page.wait_for_timeout(1000)
        page.fill("[data-testid=composer-input]", "차단 상태에서도 입력")
        page.click("[data-testid=send-button]")
        page.wait_for_timeout(700)
        check("4. localStorage 차단 환경", page, logs, [
            ("첫 화면이 그려졌다", home4 == 1),
            ("회의방이 열린다", page.locator(".room").count() == 1),
            ("메시지를 보낼 수 있다", page.locator("[data-testid=message]").count() >= 1),
        ])
        page.screenshot(path="screenshots/schema-4-storage-blocked.png")
        ctx.close()

        # ── 5. 손상된 JSON 설정 ──────────────────────────────────────────────
        ctx, page, logs = new_page(browser)
        page.goto(base, wait_until="load")
        page.evaluate(
            """() => {
              localStorage.setItem('airt3.v1.settings', '{broken json');
              localStorage.setItem('airt3.v1.meetings', '{broken json');
              localStorage.setItem('airt3.v1.session', 'not-json');
              localStorage.setItem('airt3.v1.memories', '[{"title":');
            }"""
        )
        page.reload(wait_until="load")
        page.wait_for_timeout(2200)
        home5 = page.locator(".home").count()
        page.fill("[data-testid=new-topic]", "손상 JSON 이후 회의")
        page.click("[data-testid=create-room]")
        page.wait_for_timeout(1000)
        room_created = page.locator("[data-testid=room-title]").count()
        page.reload(wait_until="load")
        page.wait_for_timeout(2000)
        room_restored = page.locator("[data-testid=room-title]").count()
        page.locator("[data-testid=back-button]").click()
        page.wait_for_timeout(500)
        page.locator("[data-testid=home-settings]").click()
        page.wait_for_timeout(500)
        default_name = page.input_value("[data-testid=settings-name]")
        default_worker = page.input_value("[data-testid=settings-worker-url]")
        close_sheet(page)
        check("5. 깨진 JSON 설정·회의 데이터", page, logs, [
            ("첫 화면이 그려졌다", home5 == 1),
            ("회의를 만들 수 있다", room_created == 1),
            ("새로고침 후 회의가 유지된다", room_restored == 1),
            ("설정이 기본값(이름=나, Worker 빈값)으로 복구됐다", default_name == "나" and default_worker == ""),
        ])
        page.screenshot(path="screenshots/schema-5-broken-json.png")
        ctx.close()

        # ── 6. 구버전 Service Worker(airt3-v1) 잔존 ──────────────────────────
        # 돌아온 사용자처럼 '앱이 처음 뜨기 전에' 구캐시가 있는 상태를 만든다. activate 가 지우는지 본다.
        ctx, page, logs = new_page(browser)
        ctx.add_init_script(
            """async () => { try { const c = await caches.open('airt3-v1');
              await c.put('./index.html', new Response('<html>old 3.0 shell</html>', {headers:{'Content-Type':'text/html'}}));
              await c.put('./assets/old.js', new Response('old')); } catch (e) {} }"""
        )
        page.goto(base, wait_until="load")
        page.wait_for_timeout(4500)
        caches1 = page.evaluate("async () => await caches.keys()")
        sw_ver = page.evaluate(
            "async () => { const r = await fetch('./sw.js', {cache:'no-store'}); const t = await r.text(); const m = t.match(/airt\\d-v\\d+/); return m ? m[0] : null; }"
        )
        home6 = page.locator(".home").count()
        page.fill("[data-testid=new-topic]", "구워커 환경 회의")
        page.click("[data-testid=create-room]")
        page.wait_for_timeout(1000)
        check("6. 구버전 Service Worker(airt3-v1) 잔존", page, logs, [
            ("구캐시 airt3-v1 이 삭제됐다", "airt3-v1" not in caches1),
            ("현재 SW 버전이 airt4 이상이다", bool(sw_ver) and not str(sw_ver).startswith("airt3")),
            ("첫 화면·회의방이 정상이다", home6 == 1 and page.locator(".room").count() == 1),
        ])
        page.screenshot(path="screenshots/schema-6-old-sw.png")
        ctx.close()

        # ── 7. API 키 / Worker 미연결 ────────────────────────────────────────
        ctx, page, logs = new_page(browser)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(2000)
        page.fill("[data-testid=new-topic]", "Worker 미연결 회의")
        page.click("[data-testid=create-room]")
        page.wait_for_timeout(1000)
        chips = page.inner_text("[data-testid=status-chips]")
        page.locator("[data-testid=participants-btn]").click()
        page.wait_for_timeout(500)
        sheet_text = page.inner_text("[data-testid=participants-sheet]")
        close_sheet(page)
        page.locator("[data-testid=menu-btn]").click()
        page.wait_for_timeout(300)
        page.locator("[data-testid=open-settings]").click()
        page.wait_for_timeout(300)
        page.fill("[data-testid=settings-worker-url]", "")
        page.click("[data-testid=settings-test]")
        page.wait_for_timeout(600)
        settings_msg = page.inner_text("[data-testid=settings-status]")
        check("7. Worker/API 키 미연결 — 모델 '미연결' 표시", page, logs, [
            ("회의방이 열린다", page.locator(".room").count() == 1),
            ("상단 칩에 미연결이 표시된다", "미연결" in chips),
            ("참가자 목록에 미연결이 표시된다", "미연결" in sheet_text),
            ("Worker 미연결 안내 바가 보인다", page.locator("[data-testid=worker-missing-bar]").count() == 1),
            ("연결 확인이 실패를 알려 준다", "실패" in settings_msg or "비어" in settings_msg),
        ])
        page.screenshot(path="screenshots/schema-7-no-worker.png")
        ctx.close()

        # ── 8. Android Chrome 모바일 뷰포트(390×844) 전체 흐름 ───────────────
        ctx, page, logs = new_page(browser)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(1500)
        page.evaluate(
            "(data) => { localStorage.setItem('airt3.v1.meetings', JSON.stringify([data.meeting])); localStorage.setItem('airt3.v1.settings', JSON.stringify(data.settings)); localStorage.setItem('airt3.v1.memories', JSON.stringify([{ id:'mem8', title:'코팅 온도', body:'2주 기록', status:'가설', type:'사실', tags:['코팅'], createdAt: 1, updatedAt: 2 }])); }",
            {"meeting": {**LEGACY_V3_MEETING, "id": "mt_v3_active", "title": "3.0 진행 중이던 회의", "status": "active"},
             "settings": LEGACY_SETTINGS},
        )
        page.reload(wait_until="load")
        page.wait_for_timeout(2000)
        page.locator("[data-testid=meeting-item] .meeting-open").first.click()
        page.wait_for_timeout(800)
        page.fill("[data-testid=composer-input]", "@GPT-OSS 다음은 뭐야?")
        page.click("[data-testid=send-button]")
        page.wait_for_timeout(600)
        page.locator("[data-testid=search-btn]").click()
        page.fill("[data-testid=search-input]", "3.0")
        page.wait_for_timeout(400)
        found = page.locator("[data-testid=search-result]").count()
        close_sheet(page)
        page.locator("[data-testid=menu-btn]").click()
        page.locator("[data-testid=open-memory]").click()
        page.wait_for_timeout(400)
        mem_count = page.locator(".memory-item").count()
        close_sheet(page)
        page.reload(wait_until="load")
        page.wait_for_timeout(2000)
        viewport = page.evaluate("() => `${innerWidth}x${innerHeight}`")
        check("8. Android Chrome 390×844 — 전체 흐름", page, logs, [
            ("뷰포트가 390×844 이다", viewport.startswith("390")),
            ("기존 회의방이 열린다", page.locator(".room").count() == 1),
            ("대화 검색이 동작한다", found >= 1),
            ("기억 저장소 시트가 열린다", mem_count >= 1),
            ("새로고침 후에도 회의가 유지된다", page.locator("[data-testid=room-title]").count() == 1),
            ("추가한 사용자 발언이 남아 있다", "@GPT-OSS 다음은 뭐야?" in page.inner_text("[data-testid=msg-list]")),
        ])
        page.screenshot(path="screenshots/schema-8-mobile-flow.png")
        ctx.close()

        browser.close()

    httpd.shutdown()
    print(f"\n{OUT['passed']}/{OUT['passed'] + OUT['failed']} 시나리오 통과")
    with open("e2e/schema8_report.json", "w", encoding="utf-8") as f:
        json.dump(OUT, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
