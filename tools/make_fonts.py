# fonts/ のフォントを作り直す（このサイトで使う文字だけを抜き出す）
# 使い方:
#   1. https://github.com/notofonts/noto-cjk の Sans/SubsetOTF/JP から
#      NotoSansJP-Medium.otf / Bold.otf / Black.otf をダウンロードして、どこかのフォルダに置く
#   2. pip install fonttools brotli
#   3. python3 tools/make_fonts.py そのフォルダ
# 画面の文章を変えて、新しい漢字を使った時は、もう一度実行する
import sys, pathlib
from fontTools import subset

root = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1])

chars = set()
for p in list(root.glob("*.html")) + list(root.glob("*.js")):
    chars |= set(p.read_text(encoding="utf-8"))
# 文章に無くても使う文字：英数字・記号・ひらがな・カタカナ・全角英数字
for a, b in [(0x20, 0x7E), (0x3000, 0x303F), (0x3040, 0x309F), (0x30A0, 0x30FF), (0xFF01, 0xFF5E)]:
    chars |= {chr(c) for c in range(a, b + 1)}
chars |= set("・ー～…‥“”‘’〜♪★☆●○◯×÷±→←↑↓")
text = "".join(sorted(c for c in chars if ord(c) >= 0x20))

for w, name in [(500, "Medium"), (700, "Bold"), (900, "Black")]:
    opts = subset.Options(); opts.flavor = "woff2"; opts.layout_features = ["*"]; opts.name_IDs = ["*"]
    font = subset.load_font(str(src / f"NotoSansJP-{name}.otf"), opts)
    s = subset.Subsetter(opts); s.populate(text=text); s.subset(font)
    out = root / "fonts" / f"NotoSansJP-{w}.woff2"
    subset.save_font(font, str(out), opts)
    print(out.name, out.stat().st_size // 1024, "KB")
