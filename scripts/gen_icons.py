#!/usr/bin/env python3
"""앱 아이콘 PNG 생성(192, 512). 마스코트: 주황 배경 + 흰색 'ㄴ' + 두 눈(피클 정체성).
외부 로고 파일을 쓰지 않고 직접 그린다. 결과는 public/icon-192.png, public/icon-512.png."""
from PIL import Image, ImageDraw
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"


def icon(size: int) -> Image.Image:
    s = size * 4  # 슈퍼샘플링 후 축소(안티에일리어싱)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 주황 그라데이션 배경(둥근 사각형)
    grad = Image.new("RGB", (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / max(1, s - 1)
        r = int(255 * (1 - 0.10 * t))
        g = int(154 * (1 - 0.36 * t))
        b = int(61 * (1 - 0.62 * t))
        gd.line([(0, y), (s, y)], fill=(r, g, b))
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    # ㄴ 자획
    w = int(s * 0.09)
    d.line([(s * 0.33, s * 0.29), (s * 0.33, s * 0.645)], fill="white", width=w)
    d.line([(s * 0.33, s * 0.645), (s * 0.64, s * 0.645)], fill="white", width=w)
    # 두 눈
    r = int(s * 0.047)
    for cx in (s * 0.512, s * 0.637):
        d.ellipse([cx - r, s * 0.383 - r, cx + r, s * 0.383 + r], fill="white")

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for px in (192, 512):
        out = PUBLIC / f"icon-{px}.png"
        icon(px).save(out, format="PNG", optimize=True)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
