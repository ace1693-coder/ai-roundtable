"""실서버(GitHub Pages) 검증 — `Cannot read properties of undefined (reading 'gptoss')` 복구 확인.

대상: https://ace1693-coder.github.io/ai-roundtable/
  A. 신규 설치(저장 데이터 없음) — 첫 화면·회의 생성·참가자 목록
  B. 3.0 시절 localStorage 기록을 가진 사용자 — 이전 회의 열기·마이그레이션
  C. IndexedDB 회의에 enabledAi(중첩 객체)가 빠진 사용자 — 장애 지점
  D. 구버전 캐시(airt3-v1)가 남은 사용자 — 새 SW 가 지우는지

실행: python3 e2e/live_schema_check.py
"""
import json
import time

from playwright.sync_api import sync_playwright

URL = "https://ace1693-coder.github.io/ai-roundtable/"
UA = (
    "Mozilla/5.0 (Linux; Android 14; SM-A346N) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Mobile Safari/537.36"
)
VP = {"width": 390, "height": 844}
NOW = int(time.time() * 1000)
OUT = {"url": URL, "scenarios": [], "passed": 0, "failed": 0}

LEGACY_V3_MEETING = {
    "id": "mt_live_v3",
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
        {"id": "lv1", "authorId": "chatgpt", "text": "3.0 첫 발언 — 온도 편차부터 보자", "createdAt": NOW - 90_000_000, "source": "api", "roleAtTime": "공정혁신 전문가"},
        {"id": "lv2", "authorId": "pickle", "text": "3.0 사회자 — 기록 주기를 정하자", "createdAt": NOW - 89_000_000, "source": "api", "roleAtTime": "생산성·원가절감 사회자"},
    ],
}

BROKEN_V4_MEETING = {
    "id": "mt_live_broken",
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
        {"id": "lb1", "authorId": "gptoss", "text": "GPT-OSS 발언 — 예전에 앱이 죽던 지점", "createdAt": NOW - 400_000, "source": "api", "roleAtTime": "전략 분석가"}
    ],
}


def new_page(browser):
    ctx = browser.new_context(viewport=VP, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=UA)
    page = ctx.new_page()
    logs = {"console": [], "pageerror": [], "bundle": []}
    page.on("console", lambda m: logs["console"].append(f"{m.type}: {m.text[:300]}") if m.type == "error" else None)
    page.on("pageerror", lambda e: logs["pageerror"].append(str(e)[:300]))
    page.on(
        "response",
        lambda r: logs["bundle"].append(r.url.split("/")[-1])
        if "/assets/index-" in r.url and r.request.resource_type == "script"
        else None,
    )
    return ctx, page, logs


def idb_meetings(page):
    return page.evaluate(
        """async () => { const db = await new Promise((res, rej) => { const r = indexedDB.open('ai-roundtable', 1);
        r.onupgradeneeded = () => { const d = r.result;
          if (!d.objectStoreNames.contains('meetings')) d.createObjectStore('meetings', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('memories')) d.createObjectStore('memories', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const rows = await new Promise((res, rej) => { const q = db.transaction('meetings','readonly').objectStore('meetings').getAll();
        q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
      db.close();
      return rows.map(r => ({ id: r.id, enabledAi: r.enabledAi, messages: (r.messages||[]).length })); }"""
    )


def seed_indexeddb(page, rows):
    page.evaluate(
        """async (rows) => { const db = await new Promise((res, rej) => { const r = indexedDB.open('ai-roundtable', 1);
        r.onupgradeneeded = () => { const d = r.result;
          if (!d.objectStoreNames.contains('meetings')) d.createObjectStore('meetings', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('memories')) d.createObjectStore('memories', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      await new Promise((res, rej) => { const tx = db.transaction('meetings','readwrite');
        for (const row of rows) tx.objectStore('meetings').put(row);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      db.close(); }""",
        rows,
    )


def close_sheet(page):
    page.locator("[data-testid=sheet-close]").last.click()
    page.wait_for_timeout(250)


def check(name, page, logs, expects, shot=None):
    rows = [{"check": d, "ok": bool(v)} for d, v in expects]
    rows.append({"check": "복구 화면(.crash)이 뜨지 않았다", "ok": page.locator(".crash").count() == 0})
    rows.append({"check": "콘솔 오류 0건", "ok": len(logs["console"]) == 0, "detail": logs["console"][:3]})
    rows.append({"check": "페이지 오류 0건", "ok": len(logs["pageerror"]) == 0, "detail": logs["pageerror"][:3]})
    ok = all(r["ok"] for r in rows)
    OUT["scenarios"].append({"name": name, "ok": ok, "rows": rows, "bundle": logs["bundle"][:2]})
    OUT["passed" if ok else "failed"] += 1
    print(("PASS " if ok else "FAIL ") + name)
    for r in rows:
        if not r["ok"]:
            print("   - 실패:", r)
    if shot:
        page.screenshot(path=shot, full_page=False)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # A. 신규 설치
        ctx, page, logs = new_page(browser)
        page.goto(URL, wait_until="load")
        page.wait_for_timeout(3500)
        home = page.locator(".home").count()
        page.fill("[data-testid=new-topic]", "실서버 신규 회의")
        page.click("[data-testid=create-room]")
        page.wait_for_timeout(1500)
        page.locator("[data-testid=participants-btn]").click()
        page.wait_for_timeout(600)
        pcount = page.locator("[data-testid=participant-item]").count()
        close_sheet(page)
        page.fill("[data-testid=composer-input]", "실서버에서 보내는 첫 메시지")
        page.click("[data-testid=send-button]")
        page.wait_for_timeout(800)
        msgs = page.locator("[data-testid=message]").count()
        page.reload(wait_until="load")
        page.wait_for_timeout(3000)
        restored = page.locator("[data-testid=room-title]").count()
        check("A. 신규 설치 — 첫 화면·회의 생성·참가자·새로고침 유지", page, logs, [
            ("첫 화면(.home)이 그려졌다", home == 1),
            ("회의방이 열렸다", page.locator(".home").count() + page.locator(".room").count() >= 1),
            ("참가자 3명이 표시된다", pcount >= 3),
            ("메시지가 보인다", msgs >= 1),
            ("새로고침 후 회의가 유지된다", restored == 1),
        ], shot="/workspace/downloads/ai-roundtable-live-A-new.png")
        ctx.close()

        # B. 3.0 localStorage 기록
        ctx, page, logs = new_page(browser)
        page.goto(URL, wait_until="load")
        page.wait_for_timeout(2500)
        page.evaluate(
            """(data) => {
              localStorage.setItem('airt3.v1.settings', JSON.stringify(data.settings));
              localStorage.setItem('airt3.v1.meetings', JSON.stringify([data.meeting]));
              localStorage.setItem('airt3.v1.memories', JSON.stringify([]));
            }""",
            {"settings": {"displayName": "낙균", "avatarEmoji": "", "apiKeys": {"openai": ""}, "autoApi": False, "models": {"openai": "gpt-4o"}}, "meeting": LEGACY_V3_MEETING},
        )
        page.reload(wait_until="load")
        page.wait_for_timeout(3000)
        home2 = page.locator(".home").count()
        list_text = page.inner_text("[data-testid=meeting-list]") if page.locator("[data-testid=meeting-list]").count() else ""
        page.locator("[data-testid=meeting-item] .meeting-open").first.click()
        page.wait_for_timeout(1200)
        msg_text = page.inner_text("[data-testid=msg-list]")
        page.locator("[data-testid=participants-btn]").click()
        page.wait_for_timeout(600)
        pcount2 = page.locator("[data-testid=participant-item]").count()
        sheet_text = page.inner_text("[data-testid=participants-sheet]")
        close_sheet(page)
        migrated = idb_meetings(page)
        check("B. 3.0 기록 사용자 — 이전 회의 열기·마이그레이션", page, logs, [
            ("첫 화면이 그려졌다", home2 == 1),
            ("예전 회의가 목록에 나온다", "3.0 코팅 불량 회의" in list_text),
            ("예전 발언이 보존됐다", "3.0 첫 발언" in msg_text and "3.0 사회자" in msg_text),
            ("참가자 목록이 정상(장애 지점)", pcount2 >= 3),
            ("예전 역할명이 표시된다", "공정혁신 전문가" in sheet_text),
            ("IndexedDB 로 옮긴 기록에 enabledAi 가 생겼다", bool(migrated) and all(m.get("enabledAi") for m in migrated)),
        ], shot="/workspace/downloads/ai-roundtable-live-B-legacy.png")
        ctx.close()

        # C. enabledAi 누락 회의
        ctx, page, logs = new_page(browser)
        page.goto(URL, wait_until="load")
        page.wait_for_timeout(2500)
        seed_indexeddb(page, [BROKEN_V4_MEETING])
        page.evaluate("(s) => localStorage.setItem('airt3.v1.settings', JSON.stringify(s))", {"displayName": "낙균", "avatarEmoji": "", "workerUrl": "", "accessCode": "", "maxTurns": 5})
        page.reload(wait_until="load")
        page.wait_for_timeout(3000)
        page.locator("[data-testid=meeting-item] .meeting-open").first.click()
        page.wait_for_timeout(1200)
        page.locator("[data-testid=participants-btn]").click()
        page.wait_for_timeout(600)
        pcount3 = page.locator("[data-testid=participant-item]").count()
        close_sheet(page)
        fixed = idb_meetings(page)
        check("C. enabledAi 누락 회의 — 장애 지점 복구", page, logs, [
            ("회의방이 열린다", page.locator(".room").count() == 1),
            ("참가자 목록이 정상 표시된다", pcount3 >= 3),
            ("빠진 enabledAi 가 채워졌다", bool(fixed) and all(m.get("enabledAi") for m in fixed)),
            ("메시지가 보인다", "GPT-OSS 발언" in page.inner_text("[data-testid=msg-list]")),
        ], shot="/workspace/downloads/ai-roundtable-live-C-missing-fields.png")
        ctx.close()

        # D. 구버전 캐시 잔존 → 새 SW 가 삭제
        ctx, page, logs = new_page(browser)
        ctx.add_init_script(
            """async () => { try { const c = await caches.open('airt3-v1');
              await c.put('./index.html', new Response('<html>old 3.0</html>', {headers:{'Content-Type':'text/html'}})); } catch (e) {} }"""
        )
        page.goto(URL, wait_until="load")
        page.wait_for_timeout(5000)
        caches_live = page.evaluate("async () => await caches.keys()")
        sw_ver = page.evaluate(
            "async () => { const r = await fetch('./sw.js', {cache:'no-store'}); const t = await r.text(); const m = t.match(/airt\\d-v\\d+/); return m ? m[0] : null; }"
        )
        OUT["sw"] = sw_ver
        OUT["caches"] = caches_live
        check("D. 구버전 캐시(airt3-v1) 정리·SW 버전", page, logs, [
            ("구캐시 airt3-v1 이 없다", "airt3-v1" not in caches_live),
            ("SW 가 airt4-v3 이다", sw_ver == "airt4-v3"),
            ("첫 화면이 정상이다", page.locator(".home").count() == 1),
        ], shot="/workspace/downloads/ai-roundtable-live-D-sw.png")
        ctx.close()

        browser.close()

    print(f"\n{OUT['passed']}/{OUT['passed'] + OUT['failed']} 시나리오 통과 · sw={OUT.get('sw')} · caches={OUT.get('caches')}")
    with open("e2e/live_schema_report.json", "w", encoding="utf-8") as f:
        json.dump(OUT, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
