#!/usr/bin/env python3
"""Rasterise the Nightforge mark into the PWA icons (no external deps).

The mark is the app's own favicon: a slate rounded square, an indigo "t"
stroke and an indigo dot. This script draws it with a signed-distance test at
4x supersampling and writes a straight RGBA PNG, so the installed app icon
matches the design system instead of the old emerald or amber one.
"""

import struct
import zlib
from pathlib import Path

GROUND = (0x0D, 0x11, 0x17)
SEAL = (0x6B, 0x8E, 0xF7)
SS = 4  # supersampling factor


def rounded_rect(x, y, w, h, r):
    """Return a coverage test for a rounded rectangle."""
    def inside(px, py):
        cx = min(max(px, r), w - r)
        cy = min(max(py, r), h - r)
        dx, dy = px - cx, py - cy
        return dx * dx + dy * dy <= r * r
    return inside


def segment(px, py, x1, y1, x2, y2, half):
    """Distance test for a round-capped stroke."""
    vx, vy = x2 - x1, y2 - y1
    wx, wy = px - x1, py - y1
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    dx, dy = wx - t * vx, wy - t * vy
    return dx * dx + dy * dy <= half * half


def render(size, glyph_scale=1.0):
    """Draw the mark at `size` px, glyph scaled into the safe area."""
    rect = rounded_rect(0, 0, size, size, size * 14 / 64)
    # glyph geometry in the 64-unit viewBox, scaled about the centre
    cx = cy = size / 2
    s = size / 64 * glyph_scale
    half = 3 * s

    def pt(x, y):
        return cx + (x - 32) * s, cy + (y - 32) * s

    hx1, hy1 = pt(16, 20)
    hx2, hy2 = pt(48, 20)
    vx1, vy1 = pt(32, 20)
    vx2, vy2 = pt(32, 46)
    dotx, doty = pt(46, 46)
    dotr = 6 * s

    out = bytearray()
    for py in range(size):
        row = bytearray([0])  # filter type 0
        for px in range(size):
            ground = seal = 0
            for sy in range(SS):
                for sx in range(SS):
                    fx = px + (sx + 0.5) / SS
                    fy = py + (sy + 0.5) / SS
                    if not rect(fx, fy):
                        continue
                    ground += 1
                    if (
                        segment(fx, fy, hx1, hy1, hx2, hy2, half)
                        or segment(fx, fy, vx1, vy1, vx2, vy2, half)
                        or (fx - dotx) ** 2 + (fy - doty) ** 2 <= dotr * dotr
                    ):
                        seal += 1
            total = SS * SS
            if ground == 0:
                row += bytes((0, 0, 0, 0))
                continue
            # composite indigo over slate, then alpha by rect coverage
            a = ground / total
            t = seal / ground
            r = round(GROUND[0] + (SEAL[0] - GROUND[0]) * t)
            g = round(GROUND[1] + (SEAL[1] - GROUND[1]) * t)
            b = round(GROUND[2] + (SEAL[2] - GROUND[2]) * t)
            row += bytes((r, g, b, round(a * 255)))
        out += row
    return bytes(out)


def png(width, height, rgba):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', zlib.compress(rgba, 9))
        + chunk(b'IEND', b'')
    )


def main():
    here = Path(__file__).resolve().parent
    targets = [
        ('icon-192.png', 192, 1.0),
        ('icon-512.png', 512, 1.0),
        # maskable: keep the glyph inside the 80% safe zone
        ('icon-512-maskable.png', 512, 0.72),
    ]
    for name, size, scale in targets:
        path = here / name
        path.write_bytes(png(size, size, render(size, scale)))
        print(f'{name}: {size}x{size} {path.stat().st_size} bytes')


if __name__ == '__main__':
    main()
