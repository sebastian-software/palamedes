#!/bin/sh
# Prepare the product film's audio tools outside Git. ElevenLabs narration uses
# the standard-library client in eleven.py; no local TTS models are needed.
# Needs uv, ffmpeg and fluidsynth.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${PALAMEDES_VIDEO_WORK:-$HERE/.work}
mkdir -p "$WORK/sf"

for tool in uv ffmpeg fluidsynth; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done

if [ ! -x "$WORK/venv/bin/python" ]; then
  uv venv -q -p 3.11 "$WORK/venv"
fi
uv pip install -q -p "$WORK/venv/bin/python" \
  mido==1.3.3 soundfile scipy faster-whisper

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
