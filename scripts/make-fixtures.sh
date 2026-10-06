#!/usr/bin/env bash
# Generates test photos into fixtures/ (macOS: needs ImageMagick `magick`, `sips`).
# The generated files are committed; CI (Linux) uses them as-is and never runs this.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=fixtures
FONT=/System/Library/Fonts/Helvetica.ttc
mkdir -p "$OUT/set50"
Q=80

# label W H "colorA" "colorB" "text" out [pointsize]
img() {
  local w=$1 h=$2 a=$3 b=$4 text=$5 out=$6 ps
  ps=${7:-$(( (w < h ? w : h) / 2 ))}
  magick -size "${w}x${h}" "gradient:$a-$b" \
    -fill 'rgba(255,255,255,0.9)' -stroke black -strokewidth 3 -font "$FONT" -pointsize "$ps" \
    -gravity center -annotate 0 "$text" \
    -fill none -stroke white -strokewidth 8 -draw "rectangle 4,4 $((w-5)),$((h-5))" \
    -quality $Q "$out"
}

# --- Basic formats (2400x1600 landscape, "FMT") ---
img 2400 1600 '#e63946' '#1d3557' 'JPEG' $OUT/landscape.jpg
img 1200 800 '#2a9d8f' '#e9c46a' 'PNG' $OUT/image.png
img 2400 1600 '#6a4c93' '#ffca3a' 'WEBP' $OUT/image.webp
img 1600 1200 '#06d6a0' '#118ab2' 'AVIF' $OUT/image.avif
img 480 360 '#ff595e' '#8ac926' 'GIF' $OUT/image.gif

img 1600 2400 '#f4a261' '#264653' 'PORTRAIT' $OUT/portrait.jpg 260

# --- Tiny ---
img 64 48 '#ff006e' '#3a86ff' 'T' $OUT/tiny.png 40

# --- Panorama 6000x1200 with numbered columns ---
magick -size 6000x1200 gradient:'#ff9f1c'-'#2ec4b6' \
  -fill white -stroke black -strokewidth 3 -font "$FONT" -pointsize 300 -gravity center \
  -annotate 0 'PANORAMA' \
  -pointsize 120 -gravity northwest \
  -annotate +100+40 'L' -gravity northeast -annotate +100+40 'R' \
  -quality $Q $OUT/panorama.jpg

# --- EXIF orientation 6 ---
# Displayed (upright) image is 1600x2400 portrait with a big "TOP" and an up arrow.
# Stored pixels are rotated 90deg CCW (2400x1600) and tagged Orientation=6 (RightTop),
# so viewers that honour EXIF show it upright with the arrow pointing up.
magick -size 1600x2400 gradient:'#9b5de5'-'#00f5d4' \
  -fill white -stroke black -strokewidth 4 -font "$FONT" -gravity north -pointsize 360 -annotate +0+120 'TOP' \
  -fill white -draw 'polygon 800,560 500,960 700,960 700,1500 900,1500 900,960 1100,960' \
  -gravity south -pointsize 200 -annotate +0+120 'BOTTOM' \
  -stroke none -fill none -stroke white -strokewidth 8 -draw 'rectangle 4,4 1595,2395' \
  -rotate -90 -quality $Q $OUT/exif-rotated.jpg
# ImageMagick does not write the tag, so inject a minimal EXIF APP1 (Orientation=6) after SOI.
python3 - "$OUT/exif-rotated.jpg" <<'PY'
import struct, sys
p = sys.argv[1]
d = open(p, 'rb').read()
assert d[:2] == b'\xff\xd8'
# Drop any existing APP1/EXIF so the file has exactly one orientation tag.
i = 2
while d[i] == 0xFF and d[i + 1] == 0xE1:
    i += 2 + struct.unpack('>H', d[i + 2:i + 4])[0]
tiff = b'MM\x00\x2a' + struct.pack('>I', 8) + struct.pack('>H', 1) + struct.pack('>HHI', 0x0112, 3, 1) + struct.pack('>HH', 6, 0) + struct.pack('>I', 0)
body = b'Exif\x00\x00' + tiff
seg = b'\xff\xe1' + struct.pack('>H', len(body) + 2) + body
open(p, 'wb').write(d[:2] + seg + d[i:])
PY

# --- Corrupt / non-image ---
printf 'This is not an image.\n' > $OUT/not-an-image.txt
printf 'ID3\x03\x00\x00\x00\x00\x00\x00 not a jpeg' > $OUT/fake.jpg

# --- HEIC (via sips) ---
sips -s format heic -s formatOptions 70 $OUT/landscape.jpg --out $OUT/image.heic >/dev/null
sips -s format heic -s formatOptions 70 $OUT/portrait.jpg --out $OUT/portrait.heic >/dev/null
sips -s format heic -s formatOptions 70 $OUT/exif-rotated.jpg --out $OUT/exif-rotated.heic >/dev/null

# --- 50-photo mixed set: distinct numbered, alternating orientation, every 10th is HEIC ---
for i in $(seq 1 50); do
  n=$(printf '%02d' "$i")
  hue=$(( (i * 37) % 360 )); hue2=$(( (hue + 60) % 360 ))
  a="hsl($hue,70%,45%)"; b="hsl($hue2,70%,25%)"
  case $(( i % 3 )) in
    0) w=1200; h=1800 ;;   # portrait 2:3
    1) w=1800; h=1200 ;;   # landscape 3:2
    2) w=1600; h=1200 ;;   # landscape 4:3
  esac
  if (( i % 10 == 0 )); then
    img $w $h "$a" "$b" "$n" "$OUT/set50/tmp.jpg"
    sips -s format heic -s formatOptions 60 "$OUT/set50/tmp.jpg" --out "$OUT/set50/photo-$n.heic" >/dev/null
    rm "$OUT/set50/tmp.jpg"
  else
    img $w $h "$a" "$b" "$n" "$OUT/set50/photo-$n.jpg"
  fi
done
echo "fixtures: $(du -sh $OUT | cut -f1)"
