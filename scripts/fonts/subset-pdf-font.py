"""
Make public/fonts/NotoSansJP-Regular-subset.ttf, the Japanese font of the PDF reports (#189).

Source: Noto Sans JP variable font from github.com/google/fonts (ofl/notosansjp/NotoSansJP[wght].ttf),
SIL Open Font License 1.1 (public/fonts/NotoSansJP-OFL.txt). jsPDF needs a static TrueType
font, so the Regular (wght 400) instance is taken and subset to:
ASCII, Latin-1, common punctuation and symbols, kana, every CP932 character (JIS X 0208
level 1 + 2 kanji plus the NEC / IBM extensions such as 髙 﨑 ① ㈱) and half/full-width forms.

Usage (needs fonttools: python3 -m venv .venv && .venv/bin/pip install fonttools):
  .venv/bin/python scripts/fonts/subset-pdf-font.py 'NotoSansJP[wght].ttf' public/fonts/NotoSansJP-Regular-subset.ttf
"""

import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

RANGES = [
    (0x20, 0x7E),  # ASCII
    (0xA0, 0xFF),  # Latin-1 supplement
    (0x2010, 0x206F),  # general punctuation
    (0x20A0, 0x20BF),  # currency
    (0x2100, 0x214F),  # letterlike symbols
    (0x2190, 0x21FF),  # arrows
    (0x2460, 0x24FF),  # enclosed numbers
    (0x2500, 0x257F),  # box drawing
    (0x25A0, 0x25FF),  # geometric shapes
    (0x3000, 0x303F),  # CJK punctuation
    (0x3040, 0x30FF),  # hiragana, katakana
    (0x31F0, 0x31FF),  # katakana extension
    (0x3200, 0x33FF),  # enclosed CJK, CJK compatibility
    (0xFF00, 0xFFEF),  # half/full-width forms
]


def code_points() -> set[int]:
    points = {c for start, end in RANGES for c in range(start, end + 1)}
    lead_bytes = list(range(0x81, 0xA0)) + list(range(0xE0, 0xFD))
    trail_bytes = list(range(0x40, 0x7F)) + list(range(0x80, 0xFD))
    for lead in lead_bytes:
        for trail in trail_bytes:
            try:
                text = bytes([lead, trail]).decode("cp932")
            except UnicodeDecodeError:
                continue
            if len(text) == 1 and not 0xE000 <= ord(text) <= 0xF8FF:  # no private use
                points.add(ord(text))
    return points


def main(source: str, output: str) -> None:
    font = instantiateVariableFont(TTFont(source), {"wght": 400}, updateFontNames=True)
    options = subset.Options()
    options.layout_features = []  # jsPDF does no shaping
    options.hinting = False
    options.notdef_outline = True
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=code_points())
    subsetter.subset(font)
    font.save(output)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
