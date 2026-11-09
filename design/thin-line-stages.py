"""Generate review-only SVG concepts for the thin-line direction."""

from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).parent
W, H = 1400, 820
INK = "#171715"
SOFT = "#777773"
FAINT = "#A6A6A0"
LINE = "#D4D4CF"
BG = "#F8F8F5"
WHITE = "#FFFFFF"
ACCENT = "#DC6A2E"
FONT = "Inter, Helvetica Neue, Arial, sans-serif"
MONO = "IBM Plex Mono, SFMono-Regular, Menlo, monospace"


class Draw:
    def __init__(self):
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
                      f'<rect width="{W}" height="{H}" fill="{BG}"/>']

    def rect(self, x, y, w, h, fill=WHITE, stroke=LINE, sw=1, r=0):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def line(self, x1, y1, x2, y2, color=LINE, sw=1):
        self.parts.append(f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{color}" stroke-width="{sw}" fill="none"/>')

    def circle(self, x, y, r, fill=WHITE, stroke=LINE, sw=1):
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def text(self, x, y, value, size=14, color=INK, weight=400, family=FONT, spacing=0, anchor=None):
        a = f' text-anchor="{anchor}"' if anchor else ''
        self.parts.append(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" letter-spacing="{spacing}" fill="{color}"{a}>{escape(value)}</text>')

    def label(self, x, y, value):
        self.text(x, y, value.upper(), 10, SOFT, 500, MONO, 1.4)

    def end(self, name):
        self.parts.append('</svg>')
        (OUT / name).write_text('\n'.join(self.parts))


def heading(d, stage, title, desc):
    d.label(48, 42, f"AGNDA / DESIGN STAGE {stage}")
    d.text(48, 80, title, 30, INK, 500)
    d.text(48, 105, desc, 13, SOFT)
    d.line(48, 126, 1352, 126)


def button(d, x, y, w, label, active=False):
    d.rect(x, y, w, 36, WHITE, ACCENT if active else LINE, 1, 3)
    if active:
        d.rect(x + 10, y + 15, 5, 5, ACCENT, ACCENT, 0)
    d.text(x + (24 if active else 12), y + 23, label, 11, ACCENT if active else INK, 500)


def topic(d, x, y, w, n, title, tag, time, active=False, progress=0):
    d.rect(x, y, w, 99, WHITE, ACCENT if active else LINE, 1, 4)
    d.text(x + 16, y + 22, n, 11, ACCENT if active else FAINT, 400, MONO)
    d.label(x + 45, y + 22, tag)
    d.text(x + w - 16, y + 22, time, 11, SOFT, 400, MONO, anchor="end")
    d.text(x + 45, y + 53, title, 16, INK, 600 if active else 500)
    d.line(x + 45, y + 76, x + w - 16, y + 76, LINE, 0.75)
    if progress:
        d.line(x + 45, y + 76, x + 45 + (w - 61) * progress, y + 76, ACCENT, 2)
        d.circle(x + 45 + (w - 61) * progress, y + 76, 2.5, ACCENT, ACCENT, 0)


def dashboard(d, active=False):
    lx, cx, rx = 48, 392, 998
    top = 151
    d.rect(lx, top, 320, 610, WHITE, LINE, 1, 5)
    d.rect(cx, top, 582, 610, WHITE, LINE, 1, 5)
    d.rect(rx, top, 354, 377, WHITE, LINE, 1, 5)
    d.rect(rx, 540, 354, 221, WHITE, LINE, 1, 5)

    d.label(lx + 20, top + 29, "01 / AGENDA")
    d.text(lx + 20, top + 62, "Product weekly", 22, INK, 500)
    d.text(lx + 20, top + 90, "04 TOPICS", 11, SOFT, 400, MONO, 1)
    d.line(lx + 20, top + 111, lx + 300, top + 111)
    topic(d, lx + 12, top + 129, 296, "01", "Priorities & blockers", "DISCUSSION", "10:00", active, 0.36 if active else 0)
    topic(d, lx + 12, top + 240, 296, "02", "Release readiness", "REVIEW", "15:00")
    topic(d, lx + 12, top + 351, 296, "03", "Design updates", "UPDATE", "08:00")
    topic(d, lx + 12, top + 462, 296, "04", "Next steps", "PLANNING", "05:00")
    d.label(lx + 20, top + 592, "EST. COMPLETION / 11:48 AM")

    d.label(cx + 24, top + 29, "02 / SELECTED TOPIC")
    d.text(cx + 558, top + 30, "06:24" if active else "10:00", 14, ACCENT if active else SOFT, 400, MONO, anchor="end")
    d.line(cx + 24, top + 46, cx + 558, top + 46)
    d.text(cx + 24, top + 89, "Priorities & blockers", 30, INK, 600)
    d.label(cx + 24, top + 125, "DISCUSSION    /    10 MIN")
    d.line(cx + 24, top + 149, cx + 558, top + 149)
    d.label(cx + 24, top + 176, "ELAPSED")
    d.label(cx + 290, top + 176, "REMAINING")
    d.text(cx + 24, top + 203, "03:36" if active else "00:00", 20, INK, 400, MONO)
    d.text(cx + 290, top + 203, "06:24" if active else "10:00", 20, INK, 400, MONO)
    d.line(cx + 24, top + 232, cx + 558, top + 232)
    d.label(cx + 24, top + 259, "NOTES / 02")
    d.rect(cx + 24, top + 277, 534, 43, BG, LINE, 0.75, 3)
    d.text(cx + 38, top + 304, "+  Capture a note for this topic", 12, FAINT)
    d.text(cx + 24, top + 350, "01", 11, SOFT, 400, MONO)
    d.text(cx + 66, top + 350, "Confirm release owner", 13)
    d.text(cx + 558, top + 350, "02:14", 11, SOFT, 400, MONO, anchor="end")
    d.line(cx + 24, top + 366, cx + 558, top + 366, LINE, 0.75)
    d.text(cx + 24, top + 395, "02", 11, SOFT, 400, MONO)
    d.text(cx + 66, top + 395, "Check dependency with mobile team", 13)
    d.text(cx + 558, top + 395, "03:02", 11, SOFT, 400, MONO, anchor="end")
    d.line(cx + 24, top + 411, cx + 558, top + 411, LINE, 0.75)
    d.label(cx + 24, top + 446, "ACTIONS / 01")
    d.rect(cx + 24, top + 463, 13, 13, WHITE, LINE, 1, 1)
    d.text(cx + 50, top + 475, "Send release checklist", 13)
    button(d, cx + 24, top + 530, 150, "Revisit topic")
    button(d, cx + 184, top + 530, 154, "Side by side")
    button(d, cx + 348, top + 530, 210, "Mark as addressed")

    d.label(rx + 20, top + 29, "03 / SESSION")
    d.text(rx + 334, top + 30, "38:00 TOTAL", 11, SOFT, 400, MONO, anchor="end")
    d.line(rx + 20, top + 46, rx + 334, top + 46)
    d.label(rx + 20, top + 78, "CURRENT TOPIC REMAINING")
    d.text(rx + 20, top + 151, "06:24" if active else "10:00", 62, INK, 600, MONO, -3)
    d.line(rx + 20, top + 172, rx + 334, top + 172, LINE, 0.75)
    if active:
        d.line(rx + 20, top + 172, rx + 20 + 314 * 0.36, top + 172, ACCENT, 2)
    d.label(rx + 20, top + 210, "SESSION PROGRESS")
    d.text(rx + 334, top + 210, "09%" if active else "00%", 11, ACCENT if active else SOFT, 400, MONO, anchor="end")
    d.line(rx + 20, top + 226, rx + 334, top + 226, LINE, 0.75)
    if active:
        d.line(rx + 20, top + 226, rx + 20 + 314 * .09, top + 226, ACCENT, 2)
    d.text(rx + 20, top + 267, "AUTO ADVANCE", 11, SOFT, 400, MONO, 0.7)
    d.rect(rx + 291, top + 251, 43, 22, WHITE, LINE, 1, 11)
    d.circle(rx + 302, top + 262, 8, WHITE, LINE, 1)
    button(d, rx + 20, top + 301, 151, "Pause session" if active else "Start session", active)
    button(d, rx + 181, top + 301, 153, "Focus mode")

    d.label(rx + 20, 572, "04 / ACTION ITEMS")
    d.text(rx + 334, 572, "01 OPEN", 11, SOFT, 400, MONO, anchor="end")
    d.line(rx + 20, 590, rx + 334, 590)
    d.rect(rx + 20, 610, 13, 13, WHITE, LINE, 1, 1)
    d.text(rx + 45, 622, "Send release checklist", 13)
    d.line(rx + 20, 641, rx + 334, 641, LINE, .75)
    d.text(rx + 20, 670, "01 / PRIORITIES & BLOCKERS", 10, SOFT, 400, MONO, 1)


d = Draw()
heading(d, "01", "Foundation / workspace", "A quieter shell, 0.75–1px dividers, restrained type, and one stable three-column structure.")
dashboard(d)
d.end("thin-line-stage-01.svg")

d = Draw()
heading(d, "02", "Active / progress", "The same workspace in use. Orange appears only where time is moving or a control is active.")
dashboard(d, True)
d.end("thin-line-stage-02.svg")

d = Draw()
heading(d, "03", "Focus / compact", "One large number and one main title. Dense, systematic controls stay at the edges.")
d.rect(48, 151, 954, 610, WHITE, LINE, 1, 5)
d.rect(1020, 151, 332, 610, WHITE, LINE, 1, 5)
d.label(72, 184, "FOCUS MODE    /    PRODUCT WEEKLY")
d.text(978, 184, "03 OF 04", 11, SOFT, 400, MONO, anchor="end")
d.line(72, 200, 978, 200)
d.label(102, 270, "CURRENT TOPIC    /    DISCUSSION")
d.text(102, 324, "Priorities & blockers", 38, INK, 600)
d.text(102, 455, "06:24", 112, INK, 600, MONO, -6)
d.line(102, 493, 948, 493, LINE, 1)
d.line(102, 493, 407, 493, ACCENT, 2)
d.circle(407, 493, 3, ACCENT, ACCENT, 0)
d.text(102, 521, "03:36 ELAPSED", 11, SOFT, 400, MONO, 1)
d.text(948, 521, "10:00 TOTAL", 11, SOFT, 400, MONO, 1, "end")
d.rect(102, 559, 846, 54, BG, LINE, .75, 3)
d.text(121, 592, "+  Capture a note   /   N", 14, FAINT)
button(d, 102, 666, 125, "Previous")
button(d, 237, 666, 110, "Pause", True)
button(d, 357, 666, 110, "Next")
d.text(948, 689, "EXIT FOCUS    ×", 11, SOFT, 400, MONO, 1, "end")
d.label(1042, 184, "QUEUE    /    02 REMAINING")
d.line(1042, 200, 1330, 200)
d.label(1042, 239, "UP NEXT    /    15 MIN")
d.text(1042, 272, "Release readiness", 17, INK, 500)
d.line(1042, 297, 1330, 297, LINE, .75)
d.label(1042, 336, "LATER    /    08 MIN")
d.text(1042, 369, "Design updates", 17, INK, 500)
d.line(1042, 394, 1330, 394, LINE, .75)
d.label(1042, 433, "SESSION PROGRESS")
d.text(1330, 433, "09%", 11, ACCENT, 400, MONO, anchor="end")
d.line(1042, 451, 1330, 451, LINE, .75)
d.line(1042, 451, 1068, 451, ACCENT, 2)
d.label(1042, 511, "KEYBOARD")
d.text(1042, 547, "SPACE", 11, INK, 400, MONO)
d.text(1160, 547, "Pause / resume", 12, SOFT)
d.text(1042, 579, "N", 11, INK, 400, MONO)
d.text(1160, 579, "Add note", 12, SOFT)
d.text(1042, 611, "→", 13, INK, 400, MONO)
d.text(1160, 611, "Next topic", 12, SOFT)
d.line(1042, 641, 1330, 641)
d.text(1042, 680, "Thin controls / single accent / no decorative fill", 11, SOFT)
d.end("thin-line-stage-03.svg")
