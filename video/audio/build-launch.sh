#!/bin/sh
# Build the launch cut's audio from its cue sheet:
#   piano MIDI -> Salamander grand -> deep-house bed -> voice track -> ducked mix at -16 LUFS
#   -> picture -> MP4 + SRT
# usage: audio/build-launch.sh audio/cues/launch.json   (run from video/)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
VIDEO=$(dirname "$HERE")
WORK=${PALAMEDES_VIDEO_WORK:-$HERE/.work}
CUES=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
NAME=$(basename "$CUES" .json)
COMP=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['composition'])" "$CUES")
FILE=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['output'])" "$CUES")
PY=$WORK/venv/bin/python
OUT=$WORK/out/$NAME
MUSIC=$WORK/music/$NAME
mkdir -p "$MUSIC" "$OUT"

"$PY" -I "$HERE/deep.py" midi "$CUES" "$MUSIC/piano.mid"
fluidsynth -ni -q -R 0 -C 0 -g 0.6 -r 48000 -F "$MUSIC/piano.wav" "$WORK/sf/piano.sf2" "$MUSIC/piano.mid"
[ -f "$WORK/music/ir.wav" ] || "$PY" -I "$HERE/hall.py" "$WORK/music/ir.wav"
"$PY" -I "$HERE/deep.py" render "$CUES" "$MUSIC/piano.wav" "$WORK/music/ir.wav" "$MUSIC/music.wav"

"$PY" -I "$HERE/assemble.py" "$WORK" "$CUES" "$OUT"
TOTAL=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['total'])" "$CUES")
FADE=$(python3 -c "import sys; print(float(sys.argv[1]) - 1.5)" "$TOTAL")
# The music carries this cut, so it ducks less under the voice than the piano film's score.
ffmpeg -v error -y -i "$OUT/vo.wav" -i "$MUSIC/music.wav" -i "$WORK/music/ir.wav" -filter_complex "
[0:a]highpass=f=85,equalizer=f=3200:t=q:w=1.2:g=2.5,acompressor=threshold=-22dB:ratio=3:attack=8:release=120:makeup=2,asplit=3[v1][v2][vk];
[v2][2:a]afir=dry=0:wet=1,volume=0.05[vr];
[v1][vr]amix=inputs=2:normalize=0[voice];
[1:a]apad,atrim=0:$TOTAL,volume=0.22[m];
[m][vk]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=350[duck];
[voice][duck]amix=inputs=2:normalize=0,afade=t=out:st=$FADE:d=1.5,aformat=channel_layouts=stereo[out]" \
  -map "[out]" -c:a pcm_f32le "$OUT/premix.wav"
M=$(ffmpeg -i "$OUT/premix.wav" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
get() { echo "$M" | python3 -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }
ffmpeg -v error -y -i "$OUT/premix.wav" \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true" \
  -ar 48000 -c:a pcm_s16le "$OUT/audio.wav"
cp "$OUT/captions.srt" "$WORK/out/$FILE.srt"

# --- picture and mux (SKIP_PICTURE=1 builds the audio only) -------------------
[ "${SKIP_PICTURE:-}" = 1 ] && exit 0
# SUPERSAMPLE=2 renders at twice the size and scales down with Lanczos: type in
# 3D planes that drift by fractions of a pixel stops shimmering.
SS=${SUPERSAMPLE:-1}
(cd "$VIDEO" && ./node_modules/.bin/remotion render src/index.ts "$COMP" "$OUT/picture.mp4" --codec=h264 --crf=14 --scale="$SS" --muted --log=error)
if [ "$SS" = 1 ]; then
  ffmpeg -v error -y -i "$OUT/picture.mp4" -i "$OUT/audio.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$WORK/out/$FILE.mp4"
else
  ffmpeg -v error -y -i "$OUT/picture.mp4" -i "$OUT/audio.wav" -map 0:v -map 1:a -vf "scale=1920:1080:flags=lanczos" -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart "$WORK/out/$FILE.mp4"
fi
echo "$WORK/out/$FILE.mp4"
