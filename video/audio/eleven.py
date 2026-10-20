"""Generate voiceover takes with ElevenLabs (Eleven v4).

The voice is one of ElevenLabs' premade voices, used under a paid plan, which
grants commercial rights to what it generates; no real person's voice is
cloned. The key comes from ELEVENLABS_API_KEY or from the .env file passed
with --env, and is never printed. Every take is written to
<work>/takes/eleven-<voice>/<line>_s<seed>.mp3; existing takes are kept.

Each request carries the neighbouring lines as context. The model sometimes
starts the next line after a pause; clean.py removes such stray bursts.

usage: eleven.py <work> <lines.json> [line ...] [--voice brian] [--seeds 7,11] [--env path]
"""
import json, os, sys, urllib.error, urllib.request

VOICES = {"brian": "nPczCjzI2devNBz1zQrb"}
MODEL = "eleven_v4"

work, lines_path, *rest = sys.argv[1:]


def option(name, default):
    global rest
    if name in rest:
        i = rest.index(name)
        value = rest[i + 1]
        rest = rest[:i] + rest[i + 2 :]
        return value
    return default


voice = option("--voice", "brian")
seeds = [int(s) for s in option("--seeds", "7,11").split(",")]
env = option("--env", None)
key = os.environ.get("ELEVENLABS_API_KEY")
if not key and env:
    for line in open(env):
        if line.startswith("ELEVENLABS_API_KEY="):
            key = line.split("=", 1)[1].strip().strip("\"'")
if not key:
    sys.exit("set ELEVENLABS_API_KEY or pass --env")

lines = json.load(open(lines_path))
keys = list(lines)
wanted = rest or keys
out = os.path.join(work, "takes", f"eleven-{voice}")
os.makedirs(out, exist_ok=True)

for name in wanted:
    i = keys.index(name)
    for seed in seeds:
        path = os.path.join(out, f"{name}_s{seed}.mp3")
        if os.path.exists(path):
            continue
        body = {"text": lines[name], "model_id": MODEL, "seed": seed}
        if i > 0:
            body["previous_text"] = lines[keys[i - 1]]
        if i < len(keys) - 1:
            body["next_text"] = lines[keys[i + 1]]
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{VOICES[voice]}?output_format=mp3_44100_192",
            data=json.dumps(body).encode(),
            headers={"xi-api-key": key, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                open(path, "wb").write(res.read())
        except urllib.error.HTTPError as err:
            sys.exit(f"{name} s{seed}: HTTP {err.code} {err.read()[:300].decode(errors='replace')}")
        print(voice, name, seed, flush=True)
