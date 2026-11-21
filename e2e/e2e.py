#!/usr/bin/env python3
"""AI Roundtable 3.0 — 모바일 실측 E2E (Playwright Python, Chromium).

- 빌드(dist)를 GitHub Pages 하위 경로와 같은 /ai-roundtable/ 아래에 올려 검증한다(base './' 실측).
- 뷰포트 390x844, DPR 3, 터치(mobile) 기준 + 360/430 레이아웃 확인.
- 14번 항목 11개를 전수 확인하고, 콘솔/페이지 에러 0건·외부 요청 0건을 함께 검사한다.

실행: python3 e2e/e2e.py   (먼저 npm run build)
결과: e2e/report.json, 프로젝트 screenshots/*.png
"""
from __future__ import annotations

import json
import shutil
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent          # projects/ai-roundtable
DIST = ROOT / "dist"
SERVE_ROOT = ROOT / "e2e" / "_site"
SHOTS = ROOT / "screenshots"
PORT = 4188
BASE = f"http://127.0.0.1:{PORT}/ai-roundtable/"

results: list[dict] = []
console_errors: list[str] = []
page_errors: list[str] = []
external_requests: list[str] = []


def close_sheets(page) -> None:
    for _ in range(4):
        btns = page.locator('[data-testid="sheet-close"]')
        if btns.count() == 0:
            return
        try:
            btns.first.click(timeout=1500)
        except Exception:  # noqa: BLE001
            page.locator(".sheet-backdrop").first.click(force=True, timeout=1500)
        page.wait_for_timeout(120)


def check(name: str, fn) -> None:
    try:
        detail = fn() or ""
        results.append({"item": name, "ok": True, "detail": str(detail)[:400]})
        print(f"PASS  {name}  {detail}")
    except Exception as e:  # noqa: BLE001
        results.append({"item": name, "ok": False, "detail": f"{type(e).__name__}: {e}"[:600]})
        print(f"FAIL  {name}  {type(e).__name__}: {e}")
        traceback.print_exc(limit=2)


def prepare_site() -> None:
    if not (DIST / "index.html").exists():
        sys.exit("dist/index.html 없음 — 먼저 `npm run build`")
    if SERVE_ROOT.exists():
        shutil.rmtree(SERVE_ROOT)
    target = SERVE_ROOT / "ai-roundtable"
    target.mkdir(parents=True)
    shutil.copytree(DIST, target, dirs_exist_ok=True)
    (SERVE_ROOT / "index.html").write_text('<a href="./ai-roundtable/">AI Roundtable</a>', encoding="utf-8")


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401
        pass


def start_server() -> ThreadingHTTPServer:
    handler = lambda *a, **kw: Quiet(*a, directory=str(SERVE_ROOT), **kw)  # noqa: E731
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def shot(page, name: str) -> str:
    SHOTS.mkdir(exist_ok=True)
    path = SHOTS / f"{name}.png"
    page.screenshot(path=str(path))
    return str(path.relative_to(ROOT))


def last_message(page, author: str | None = None):
    sel = '[data-testid="message"]'
    if author:
        sel += f'[data-author="{author}"]'
    return page.locator(sel).last


def box_within_viewport(page, sel: str) -> bool:
    box = page.locator(sel).first.bounding_box()
    vp = page.viewport_size
    if not box or not vp:
        return False
    return box["x"] >= -1 and box["x"] + box["width"] <= vp["width"] + 1


def run() -> None:
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--enable-features=NetworkService"])
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
            permissions=["clipboard-read", "clipboard-write"],
        )
        page = context.new_page()
        page.on(
            "console",
            lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type == "error" else None,
        )
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on(
            "request",
            lambda r: external_requests.append(r.url)
            if not r.url.startswith(f"http://127.0.0.1:{PORT}") and not r.url.startswith(("data:", "blob:"))
            else None,
        )

        # ------------------------------------------------ 1) 채팅방 생성 + 역할 자동 배정
        page.goto(BASE, wait_until="load")

        def step1():
            expect(page.get_by_test_id("new-topic")).to_be_visible()
            shot(page, "01_home")
            page.get_by_test_id("new-topic").fill("코팅 공정 불량 개선 회의")
            expect(page.get_by_test_id("role-preview")).to_contain_text("제조 공정 개선")
            text = page.get_by_test_id("role-preview").inner_text()
            assert "공정혁신 전문가" in text and "설비·품질·안전 검증 전문가" in text and "생산성·원가절감 사회자" in text, text
            page.get_by_test_id("create-room").click()
            expect(page.get_by_test_id("room-title")).to_have_text("코팅 공정 불량 개선 회의")
            expect(page.get_by_test_id("participant-count")).to_contain_text("참가자 4명")
            shot(page, "02_room_created")
            return "주제 키워드 → 제조 역할 3종 자동 배정 확인"

        check("1) 채팅방 생성 + 주제별 역할 자동 배정", step1)

        # ------------------------------------------------ 2) 프로필 SVG 구분
        def step2():
            close_sheets(page)
            page.get_by_test_id("participants-btn").click()
            expect(page.get_by_test_id("participants-sheet")).to_be_visible()
            sheet = page.get_by_test_id("participants-sheet")
            for pid in ("chatgpt", "gemini", "pickle", "me"):
                expect(sheet.get_by_test_id(f"avatar-{pid}")).to_be_visible()
            data = page.evaluate(
                """() => {
                const root = document.querySelector('[data-testid="participants-sheet"]');
                const get = (id) => root.querySelector(`[data-testid="avatar-${id}"] svg`);
                const cg = get('chatgpt'), gm = get('gemini'), pk = get('pickle'), me = get('me');
                return {
                  chatgptFill: cg.querySelector('circle').getAttribute('fill'),
                  geminiStops: [...gm.querySelectorAll('linearGradient stop')].map(s => s.getAttribute('stop-color')),
                  geminiGrad: gm.querySelector('circle').getAttribute('fill'),
                  geminiShape: gm.querySelectorAll('path').length,
                  pickleFill: pk.querySelector('circle').getAttribute('fill'),
                  pickleText: pk.textContent,
                  mePath: me.querySelectorAll('path').length,
                  names: [...root.querySelectorAll('[data-testid="participant-item"] b')].map(e => e.textContent.trim())
                };
              }"""
            )
            assert data["chatgptFill"] == "#10A37F", data
            assert data["geminiStops"] == ["#4285F4", "#9B72CB"], data
            assert data["geminiGrad"].startswith("url(#grad-gemini)"), data
            assert data["geminiShape"] >= 1, data
            assert data["pickleFill"] == "#FF7A00", data
            assert data["mePath"] >= 1, data
            joined = " | ".join(data["names"])
            assert "ChatGPT · 공정혁신 전문가" in joined and "Gemini · 설비·품질·안전 검증 전문가" in joined, joined
            shot(page, "03_participants")
            close_sheets(page)
            return f"fill={data['chatgptFill']}/gradient {data['geminiStops']}/{data['pickleFill']} · 참가자 4명 이름·역할 표시"

        check("2) ChatGPT/Gemini/Pickle 프로필 SVG 구분 + 이름·역할 표시", step2)

        # ------------------------------------------------ 3) 사용자 메시지 오른쪽 말풍선
        close_sheets(page)

        def step3():
            page.get_by_test_id("composer-input").fill("지금 설비부터 바꾸지 말고, 먼저 불량 원인을 측정하는 게 맞지 않아?")
            page.get_by_test_id("send-button").click()
            msg = last_message(page, "me")
            expect(msg.get_by_test_id("msg-text")).to_contain_text("먼저 불량 원인을 측정")
            expect(msg.get_by_test_id("msg-source")).to_have_text("출처: 사용자")
            bubble = msg.locator('[data-testid="msg-bubble"]')
            box = bubble.bounding_box()
            vp = page.viewport_size
            assert box and box["x"] + box["width"] / 2 > vp["width"] / 2, f"오른쪽 정렬 아님 {box}"
            assert box and box["x"] + box["width"] <= vp["width"] + 1
            assert "오전" in msg.get_by_test_id("msg-time").inner_text() or "오후" in msg.get_by_test_id("msg-time").inner_text()
            shot(page, "04_user_message")
            return f"말풍선 x={box['x']:.0f}, 오른쪽 정렬·시간·출처 표시"

        check("3) 사용자 메시지 전송 + 오른쪽 말풍선/시간/출처", step3)

        # ------------------------------------------------ 4) 다음 발언 제안 + 프롬프트 + 붙여넣기 응답
        close_sheets(page)

        def step4():
            expect(page.get_by_test_id("turn-bar")).to_be_visible()
            target = page.get_by_test_id("turn-target").inner_text()
            assert target in ("ChatGPT", "Gemini", "Pickle"), target
            page.get_by_test_id("copy-prompt").click()
            expect(page.get_by_test_id("toast")).to_be_visible()
            clip = page.evaluate("async () => await navigator.clipboard.readText()")
            assert "코팅 공정 불량 개선 회의" in clip, clip[:200]
            assert "먼저 불량 원인을 측정" in clip, "프롬프트에 사용자 메시지가 없음"
            assert "지식후보" in clip
            page.get_by_test_id("open-paste").click()
            expect(page.get_by_test_id("paste-sheet")).to_be_visible()
            page.get_by_test_id("paste-textarea").fill(
                "측정부터 하자는 데 동의해. 다만 측정 항목을 지금 정하자. 불량 유형·발생 지점·재작업 사유를 2주간 기록하면 병목이 보일 거야."
            )
            page.get_by_test_id("paste-submit").click()
            ai = last_message(page, "chatgpt") if target == "ChatGPT" else last_message(page)
            expect(ai.get_by_test_id("msg-source")).to_have_text("출처: 수동 입력")
            expect(ai.get_by_test_id("msg-text")).to_contain_text("2주간 기록")
            shot(page, "05_prompt_and_answer")
            return f"대상 {target} · 프롬프트 {len(clip)}자에 사용자 메시지·역할·지식후보 포함 · 붙여넣기 등록 성공"

        check("4) 사용자 메시지 반영 프롬프트 생성 + 수동 응답 등록", step4)

        # ------------------------------------------------ 5) 멘션
        close_sheets(page)

        def step5():
            inp = page.get_by_test_id("composer-input")
            inp.click()
            inp.type("@")
            expect(page.get_by_test_id("mention-popup")).to_be_visible()
            for opt in ("chatgpt", "gemini", "pickle", "all"):
                expect(page.get_by_test_id(f"mention-option-{opt}")).to_be_visible()
            page.get_by_test_id("mention-option-gemini").click()
            inp.type("이 안에서 위험한 부분만 짚어줘")
            sent = page.get_by_test_id("composer-input").input_value()
            assert sent.strip() == "@Gemini 이 안에서 위험한 부분만 짚어줘", f"멘션 삽입 위치 오류: {sent!r}"
            page.get_by_test_id("send-button").click()
            expect(page.get_by_test_id("turn-target")).to_have_text("Gemini")

            page.get_by_test_id("composer-input").fill("@전체 지금까지 나온 의견 다시 정리해봐")
            page.get_by_test_id("send-button").click()
            expect(page.get_by_test_id("turn-target")).to_have_text("ChatGPT")
            shot(page, "06_mentions")
            return "@Gemini → Gemini 우선 / @전체 → 3명 대기열(ChatGPT부터) 확인"

        check("5) @ChatGPT·@Gemini·@Pickle·@전체 멘션", step5)

        # ------------------------------------------------ 6) 끼어들기 최우선
        close_sheets(page)

        def step6():
            # 앞선 @전체로 ChatGPT 대기 중. 사용자가 @Pickle로 끼어들면 즉시 Pickle이 최우선이어야 한다.
            page.get_by_test_id("composer-input").fill("@Pickle 잠깐, 지금까지 결론만 먼저 정리해줘")
            page.get_by_test_id("send-button").click()
            expect(page.get_by_test_id("turn-target")).to_have_text("Pickle")
            expect(page.get_by_test_id("turn-bar")).to_contain_text("멘션·사용자 지시 우선")
            shot(page, "07_interrupt")
            return "대기 중이던 ChatGPT 턴을 밀어내고 Pickle이 최우선"

        check("6) 회의 중 사용자 끼어들기 최우선 반영", step6)

        # ------------------------------------------------ 8) 검색·고정·지식 저장 (7번보다 먼저: 저장 상태 확인용)
        close_sheets(page)

        def step8():
            page.get_by_test_id("search-btn").click()
            page.get_by_test_id("search-input").fill("측정")
            expect(page.get_by_test_id("search-results")).to_contain_text("측정")
            n = page.get_by_test_id("search-result").count()
            assert n >= 2, n
            page.get_by_test_id("search-result").first.click()
            expect(page.get_by_test_id("search-sheet")).to_have_count(0)
            # 메시지 고정
            bubble = page.locator('[data-testid="message"][data-author="me"] [data-testid="msg-bubble"]').first
            bubble.click()
            page.get_by_test_id("msg-pin").click()
            expect(page.get_by_test_id("pin-banner")).to_be_visible()
            # 지식 저장소 등록
            ai_bubble = page.locator('[data-testid="message"][data-author="chatgpt"] [data-testid="msg-bubble"]').first
            ai_bubble.click()
            page.get_by_test_id("msg-save-memory").click()
            page.get_by_test_id("save-memory-status").select_option("검증된 사실")
            page.get_by_test_id("save-memory-type").select_option("아이디어")
            page.get_by_test_id("save-memory-tags").fill("측정, 공정")
            page.get_by_test_id("save-memory-submit").click()
            expect(page.locator(".saved-note").first).to_be_visible()
            page.get_by_test_id("menu-btn").click()
            page.get_by_test_id("open-memory").click()
            expect(page.get_by_test_id("memory-item").first).to_be_visible()
            expect(page.get_by_test_id("memory-item").first).to_contain_text("2주간 기록")
            shot(page, "08_memory")
            page.get_by_test_id("sheet-close").click()
            return f"검색 {n}건 · 핀 배너 · 지식 저장 및 저장 표시"

        check("8) 대화 검색·메시지 고정·지식 저장소", step8)

        # ------------------------------------------------ 7) 저장/불러오기 + 새로고침 유지
        def step7():
            before = page.get_by_test_id("message").count()
            assert before >= 5, before
            page.reload(wait_until="load")
            expect(page.get_by_test_id("room-title")).to_have_text("코팅 공정 불량 개선 회의")
            assert page.get_by_test_id("message").count() == before
            expect(page.get_by_test_id("pin-banner")).to_be_visible()
            shot(page, "09_after_reload")
            # 뒤로 가서 이전 회의 목록에서 다시 열기
            page.get_by_test_id("back-button").click()
            expect(page.get_by_test_id("meeting-item").first).to_be_visible()
            page.get_by_test_id("meeting-item").first.locator(".meeting-open").click()
            expect(page.get_by_test_id("room-title")).to_have_text("코팅 공정 불량 개선 회의")
            return f"새로고침 후 메시지 {page.get_by_test_id('message').count()}개·핀 유지, 이전 회의 목록에서 재진입"

        check("7) 회의 저장/불러오기 + 새로고침 유지", step7)

        # ------------------------------------------------ 9) 일시정지/종료/요약
        close_sheets(page)

        def step9():
            page.get_by_test_id("menu-btn").click()
            page.get_by_test_id("pause-btn").click()
            expect(page.get_by_test_id("pause-bar")).to_be_visible()
            page.get_by_test_id("resume-btn").click()
            expect(page.get_by_test_id("turn-bar")).to_be_visible()
            page.get_by_test_id("menu-btn").click()
            page.get_by_test_id("end-btn").click()
            expect(page.get_by_test_id("summary-sheet")).to_be_visible()
            text = page.get_by_test_id("summary-text").inner_text()
            assert "출처: 로컬 규칙 엔진" in text and "발언 수" in text, text
            assert "나 " in text
            shot(page, "10_summary")
            page.get_by_test_id("sheet-close").click()
            expect(page.get_by_test_id("ended-bar")).to_be_visible()
            page.get_by_test_id("reopen-btn").click()
            expect(page.get_by_test_id("turn-bar")).to_be_visible()
            return "일시정지→재개→종료(로컬 요약 생성)→이어가기"

        check("9) 일시정지/종료 및 회의 요약 생성", step9)

        # ------------------------------------------------ 기억 자동 불러오기 (보조 확인)
        def step_mem():
            page.get_by_test_id("back-button").click()
            page.get_by_test_id("new-topic").fill("코팅 공정 측정 항목 정리")
            expect(page.get_by_test_id("role-preview")).to_contain_text("관련 기억 1건")
            page.get_by_test_id("create-room").click()
            expect(page.get_by_test_id("turn-bar")).to_be_visible()
            page.get_by_test_id("back-button").click()
            return "새 회의에서 관련 기억 1건 자동 매칭"

        check("보조) 새 회의에 관련 기억 자동 불러오기", step_mem)

        # ------------------------------------------------ 10) 360/390/430 레이아웃
        def step10():
            detail = []
            page.get_by_test_id("meeting-item").first.locator(".meeting-open").click()
            for w in (360, 390, 430):
                page.set_viewport_size({"width": w, "height": 844})
                page.wait_for_timeout(250)
                m = page.evaluate(
                    """() => ({
                      sw: document.scrollingElement.scrollWidth,
                      iw: window.innerWidth,
                      body: document.body.scrollWidth
                    })"""
                )
                assert m["sw"] <= m["iw"] + 1 and m["body"] <= m["iw"] + 1, f"{w}px 가로 스크롤 {m}"
                for sel in ("msg-list", "composer-input"):
                    assert box_within_viewport(page, f'[data-testid="{sel}"]'), f"{w}px {sel} 벗어남"
                shot(page, f"11_width_{w}")
                detail.append(f"{w}px: scrollWidth {m['sw']}/{m['iw']}")
            page.set_viewport_size({"width": 390, "height": 844})
            return " / ".join(detail)

        check("10) 360·390·430px 가로 스크롤 0·레이아웃 유지", step10)

        # ------------------------------------------------ 11) PWA·에러·외부요청
        def step11():
            man = page.request.get(BASE + "manifest.webmanifest")
            assert man.status == 200, man.status
            data = man.json()
            assert data["start_url"] == "./" and data["display"] == "standalone"
            assert any(i["sizes"] == "192x192" for i in data["icons"])
            sw = page.request.get(BASE + "sw.js")
            assert sw.status == 200 and "airt3" in sw.text()
            for icon in ("icon-192.png", "icon-512.png", "icon.svg"):
                assert page.request.get(BASE + icon).status == 200, icon
            page.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=8000)
            assert page.evaluate("() => !!navigator.serviceWorker.controller")
            assert not page_errors, f"페이지 에러: {page_errors}"
            assert not console_errors, f"콘솔 에러: {console_errors[:3]}"
            assert not external_requests, f"외부 요청: {external_requests[:3]}"
            shot(page, "12_pwa")
            return f"manifest/ sw.js/ 아이콘 200 · SW 제어 중 · 콘솔 {len(console_errors)}·페이지 {len(page_errors)}·외부 {len(external_requests)}"

        check("11) PWA 로드·콘솔/페이지 에러 0·외부 요청 0", step11)

        # ------------------------------------------------ 추가: 390 모바일 스크린샷(대표 1장 더)
        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_test_id("menu-btn").click()
        shot(page, "13_menu")
        page.get_by_test_id("sheet-close").click()

        browser.close()


def main() -> None:
    prepare_site()
    srv = start_server()
    try:
        run()
    finally:
        srv.shutdown()
    ok = sum(1 for r in results if r["ok"])
    report = {
        "base": BASE,
        "viewport": "390x844 DPR3 mobile/touch (+360/430 레이아웃)",
        "passed": ok,
        "failed": len(results) - ok,
        "items": results,
        "console_errors": console_errors,
        "page_errors": page_errors,
        "external_requests": external_requests,
        "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (ROOT / "e2e" / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{ok}/{len(results)} 통과 · report: e2e/report.json")
    if ok != len(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
