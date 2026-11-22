#!/usr/bin/env python3
"""실서버(GitHub Pages) 검증 — https://ace1693-coder.github.io/ai-roundtable/

- 모바일 390x844 DPR3(mobile+touch)로 실제 배포 URL 접속
- 문서/JS/CSS/manifest/icon/sw 응답 코드 확인
- 콘솔 에러·페이지 에러·실패 요청 0건 확인
- 첫 화면·채팅방 진입 등 핵심 UI 렌더 확인 + 스크린샷 저장
결과: e2e/live_report.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "https://ace1693-coder.github.io/ai-roundtable/"
ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"

console_errors: list[str] = []
page_errors: list[str] = []
failed_requests: list[str] = []
responses: dict[str, int] = {}
report: dict = {"url": URL, "checks": []}


def rep(s: str) -> str:
    return s.replace("\n", " | ")


def check(name: str, ok: bool, detail: str = "") -> None:
    report["checks"].append({"item": name, "ok": bool(ok), "detail": str(detail)[:500]})
    print(("PASS  " if ok else "FAIL  ") + name + ("  " + str(detail)[:300] if detail else ""))


def main() -> int:
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--enable-features=NetworkService"])
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("requestfailed", lambda r: failed_requests.append(f"{r.url} :: {r.failure}"))

        def on_response(r):
            u = r.url
            if "ace1693-coder.github.io/ai-roundtable" in u or u.endswith((".js", ".css", ".png", ".webmanifest", ".svg")):
                responses[u] = r.status

        page.on("response", on_response)

        resp = page.goto(URL, wait_until="networkidle", timeout=60000)
        check("HTTP 문서 응답 200", resp is not None and resp.status == 200, f"status={resp.status if resp else 'None'}")
        check("최종 URL", page.url.startswith(URL), page.url)

        page.wait_for_timeout(1200)

        # 문서가 참조하는 자산이 모두 200인지
        assets = [u for u in responses if "/assets/" in u or u.endswith(("manifest.webmanifest", "icon.svg", "sw.js"))]
        bad = {u: s for u, s in responses.items() if s >= 400}
        check("자산 응답 200", len(bad) == 0 and len(assets) >= 2, f"자산 {len(assets)}건, 4xx/5xx {bad or '없음'}")

        body = page.inner_text("body")
        check("본문 텍스트 렌더", len(body.strip()) > 20, repr(body[:160]))
        check("#root 자식 존재", page.eval_on_selector("#root", "el => el.children.length > 0"), "")

        # 뷰포트 폭 사용(모바일 레이아웃)
        width = page.evaluate("document.documentElement.clientWidth")
        scroll_w = page.evaluate("document.documentElement.scrollWidth")
        check("가로 스크롤 없음(390px)", scroll_w <= width + 1, f"clientWidth={width}, scrollWidth={scroll_w}")

        page.screenshot(path=str(SHOTS / "live-pages-390x844-home.png"), full_page=False)

        # 서비스워커 등록 여부
        sw = page.evaluate(
            """async () => {
                 if (!('serviceWorker' in navigator)) return 'unsupported';
                 try {
                   const reg = await navigator.serviceWorker.getRegistration();
                   if (reg) return 'registered:' + (reg.active ? 'active' : (reg.installing ? 'installing' : 'waiting'));
                   await new Promise(r => setTimeout(r, 2500));
                   const reg2 = await navigator.serviceWorker.getRegistration();
                   return reg2 ? 'registered:' + (reg2.active ? 'active' : 'pending') : 'none';
                 } catch (e) { return 'error:' + String(e); }
               }"""
        )
        check("서비스워커", str(sw).startswith("registered"), sw)

        # 매니페스트 파싱
        man = page.evaluate(
            """async () => {
                 const l = document.querySelector('link[rel=manifest]');
                 if (!l) return 'no-link';
                 const r = await fetch(l.href);
                 const j = await r.json();
                 return j.name + '|' + j.display + '|' + (j.icons ? j.icons.length : 0);
               }"""
        )
        check("웹 매니페스트 로드", "|" in str(man), man)

        # 채팅방 진입 시도: 홈 화면의 시작 버튼/주제 카드 클릭
        entered = "미시도"
        room_ok = False
        try:
            page.get_by_test_id("new-topic").fill("실서버 배포 확인 회의")
            page.wait_for_timeout(400)
            page.get_by_test_id("create-room").click(timeout=6000)
            page.get_by_test_id("composer-input").wait_for(state="visible", timeout=8000)
            room_ok = True
            title = page.get_by_test_id("room-title").inner_text()
            entered = f"room-title={title}"
            check("채팅방 진입 렌더", title.strip() == "실서버 배포 확인 회의", entered)
            page.screenshot(path=str(SHOTS / "live-pages-390x844-room.png"), full_page=False)
            page.get_by_test_id("composer-input").fill("실서버 배포 확인 인사")
            page.keyboard.press("Enter")
            page.wait_for_timeout(900)
            sent = page.locator('[data-testid=message][data-author=me]').count() > 0 and "실서버 배포 확인 인사" in page.inner_text("body")
            check("사용자 메시지 전송 반영", sent, f"내 말풍선 {page.locator('[data-testid=message][data-author=me]').count()}개")
            page.screenshot(path=str(SHOTS / "live-pages-390x844-room.png"), full_page=False)
        except Exception as e:  # noqa: BLE001
            entered = f"실패: {type(e).__name__}: {e}"
            try:
                page.screenshot(path=str(SHOTS / "live-pages-390x844-room.png"), full_page=False)
            except Exception:  # noqa: BLE001
                pass
        check("채팅방 화면 스크린샷", room_ok, entered)

        check("콘솔 에러 0건", len(console_errors) == 0, console_errors[:5])
        check("페이지 에러 0건", len(page_errors) == 0, page_errors[:5])
        check("실패 요청 0건", len(failed_requests) == 0, failed_requests[:5])

        report["console_errors"] = console_errors
        report["page_errors"] = page_errors
        report["failed_requests"] = failed_requests
        report["responses"] = responses
        report["final_url"] = page.url
        browser.close()

    (ROOT / "e2e" / "live_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    ok = all(c["ok"] for c in report["checks"])
    print(f"\n총 {len(report['checks'])}항목 — 통과 {sum(c['ok'] for c in report['checks'])} / 실패 {sum(not c['ok'] for c in report['checks'])}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
