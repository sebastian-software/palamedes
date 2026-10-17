#!/bin/sh
# Prepare the promo's audio toolchain in a work directory outside Git:
# a Python env with Chatterbox (MIT) and Kokoro (Apache-2.0) for the voice,
# and the two soundfonts for the score. Needs uv, ffmpeg and fluidsynth.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${PALAMEDES_VIDEO_WORK:-$HERE/.work}
mkdir -p "$WORK/sf"

for tool in uv ffmpeg fluidsynth; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done

if [ ! -x "$WORK/venv/bin/python" ]; then
  uv venv -q -p 3.11 "$WORK/venv"
  uv pip install -q -p "$WORK/venv/bin/python" \
    chatterbox-tts==0.1.7 kokoro==0.9.4 mido==1.3.3 soundfile scipy 'setuptools<81'
fi

# espeak-ng (used by Kokoro) truncates long data paths; keep a short copy.
if [ ! -d "$WORK/espeak-ng-data" ]; then
  cp -R "$("$WORK/venv/bin/python" -I -c 'import espeakng_loader as e; print(e.get_data_path())')" "$WORK/espeak-ng-data"
fi

# Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0.
if [ ! -f "$WORK/sf/piano.sf2" ]; then
  curl -fsSL https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPiano-SF2-V3+20200602.tar.xz | tar -xJ -C "$WORK/sf"
  mv "$WORK"/sf/SalamanderGrandPiano-SF2-V3+20200602/*.sf2 "$WORK/sf/piano.sf2"
fi
# MuseScore General, MIT; only its slow strings and cello are used.
if [ ! -f "$WORK/sf/strings.sf3" ]; then
  curl -fsSL -o "$WORK/sf/strings.sf3" https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3
fi
echo "ready: $WORK"
