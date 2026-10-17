#!/bin/sh
# Build one cut of the promo from a cue sheet:
#   score -> voice track -> ducked mix at -16 LUFS -> picture -> MP4 + SRT
# usage: audio/build.sh audio/cues/team.json   (run from video/)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
VIDEO=$(dirname "$HERE")
WORK=${PALAMEDES_VIDEO_WORK:-$HERE/.work}
CUES=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
NAME=$(basename "$CUES" .json)
PY=$WORK/venv/bin/python
OUT=$WORK/out/$NAME
mkdir -p "$WORK/music" "$OUT"

# --- score ----------------------------------------------------------------
"$PY" -I "$HERE/compose.py" "$WORK/music" "$CUES"
[ -f "$WORK/music/ir.wav" ] || "$PY" -I "$HERE/hall.py" "$WORK/music/ir.wav"
fluidsynth -ni -q -R 0 -C 0 -g 0.45 -r 48000 -F "$WORK/music/piano.wav" "$WORK/sf/piano.sf2" "$WORK/music/piano.mid"
fluidsynth -ni -q -R 0 -C 0 -g 0.35 -r 48000 -F "$WORK/music/strings.wav" "$WORK/sf/strings.sf3" "$WORK/music/strings.mid" 2>/dev/null
ffmpeg -v error -y -i "$WORK/music/piano.wav" -i "$WORK/music/strings.wav" -i "$WORK/music/ir.wav" -filter_complex "
[1:a]volume=0.55,lowpass=f=6000[s];
[0:a][s]amix=inputs=2:normalize=0,asplit[dry][wet0];
[wet0][2:a]afir=dry=0:wet=1,volume=0.28[wet];
[dry][wet]amix=inputs=2:normalize=0,highpass=f=35,acompressor=threshold=-26dB:ratio=2.2:attack=25:release=300:makeup=2[out]" \
  -map "[out]" -ar 48000 -c:a pcm_f32le "$WORK/music/mix.wav"
PEAK=$(ffmpeg -i "$WORK/music/mix.wav" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB/\1/p')
ffmpeg -v error -y -i "$WORK/music/mix.wav" -af "volume=$(echo "-1.5 - ($PEAK)" | bc)dB" -c:a pcm_s16le "$WORK/music/music.wav"

# --- voice and final mix --------------------------------------------------
"$PY" -I "$HERE/assemble.py" "$WORK" "$CUES" "$OUT"
TOTAL=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['total'])" "$CUES")
FADE=$(python3 -c "import sys; print(float(sys.argv[1]) - 1.2)" "$TOTAL")
ffmpeg -v error -y -i "$OUT/vo.wav" -i "$WORK/music/music.wav" -i "$WORK/music/ir.wav" -filter_complex "
[0:a]highpass=f=85,equalizer=f=3200:t=q:w=1.2:g=2.5,acompressor=threshold=-22dB:ratio=3:attack=8:release=120:makeup=2,asplit=3[v1][v2][vk];
[v2][2:a]afir=dry=0:wet=1,volume=0.07[vr];
[v1][vr]amix=inputs=2:normalize=0[voice];
[1:a]apad,atrim=0:$TOTAL,volume=0.55[m];
[m][vk]sidechaincompress=threshold=0.02:ratio=8:attack=35:release=500[duck];
[voice][duck]amix=inputs=2:normalize=0,afade=t=out:st=$FADE:d=1.2,aformat=channel_layouts=stereo[out]" \
  -map "[out]" -c:a pcm_f32le "$OUT/premix.wav"
M=$(ffmpeg -i "$OUT/premix.wav" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
get() { echo "$M" | python3 -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }
ffmpeg -v error -y -i "$OUT/premix.wav" \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true" \
  -ar 48000 -c:a pcm_s16le "$OUT/audio.wav"

# --- picture and mux --------------------------------------------------------
PROPS=$(python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1])).get('props', {})))" "$CUES")
COMP=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('composition', 'PalamedesPromo'))" "$CUES")
FILE=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('output', 'palamedes-promo-' + sys.argv[2]))" "$CUES" "$NAME")
(cd "$VIDEO" && ./node_modules/.bin/remotion render src/index.ts "$COMP" "$OUT/picture.mp4" --props="$PROPS" --codec=h264 --crf=18 --muted --log=error)
ffmpeg -v error -y -i "$OUT/picture.mp4" -i "$OUT/audio.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$WORK/out/$FILE.mp4"
cp "$OUT/captions.srt" "$WORK/out/$FILE.srt"
echo "wrote $WORK/out/$FILE.mp4"
