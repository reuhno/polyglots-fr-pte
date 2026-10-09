#!/usr/bin/env python3
"""Génère les icônes PNG (16, 32, 48, 128 px) de l'extension, bibliothèque standard uniquement.

Usage : python3 tools/make-icons.py [dossier_de_sortie]   (défaut : icons/)
Dessin : carré arrondi bleu, bulle de dialogue blanche avec trois points.
"""
import struct
import sys
import zlib
from pathlib import Path

BLUE = (34, 113, 177)
WHITE = (255, 255, 255)
SS = 4  # suréchantillonnage pour l'anti-crénelage


def inside_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_triangle(x, y, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    p = (x, y)
    d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def sample(u, v):
    """Couleur RGBA au point (u, v) du carré unité."""
    if not inside_round_rect(u, v, 0.0, 0.0, 1.0, 1.0, 0.22):
        return (0, 0, 0, 0)
    # bulle
    bubble = inside_round_rect(u, v, 0.18, 0.22, 0.82, 0.64, 0.12) or inside_triangle(
        u, v, (0.30, 0.60), (0.48, 0.60), (0.30, 0.80)
    )
    if bubble:
        for cx in (0.34, 0.50, 0.66):
            if (u - cx) ** 2 + (v - 0.43) ** 2 <= 0.045 ** 2:
                return (*BLUE, 255)
        return (*WHITE, 255)
    return (*BLUE, 255)


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])  # filtre PNG « None »
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    r, g, b, a = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            n = SS * SS
            a = acc[3] / n
            if acc[3]:
                row += bytes([round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(a)])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    return b"".join(rows)


def png(size):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA 8 bits
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(render(size), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 128):
        (out / f"icon-{s}.png").write_bytes(png(s))
        print(f"{out / f'icon-{s}.png'}")
