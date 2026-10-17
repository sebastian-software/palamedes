"""Write readable WebVTT captions for a cut: short cues timed to the words.

The cue sheet places one take per line of the script, which makes for long
captions. This splits each line at its punctuation into cues of at most two
short lines, and times every cue by the words as spoken: faster-whisper
transcribes each take once (cached next to the takes as words.json), and the
script's words are aligned to the transcript, so captions keep the script's
spelling ("Next.js", "fifteen hundred") while following the voice.

usage: captions.py <work> <cues.json> <out.vtt>
"""
import difflib, json, os, re, sys

import soundfile as sf

WORK, CUES, OUT = sys.argv[1:4]
MAX = 84  # characters per cue: two lines of about 42
cues = json.load(open(CUES))["cues"]


def words_for(take):
    cache = os.path.join(WORK, "takes", os.path.dirname(take), "words.json")
    known = json.load(open(cache)) if os.path.exists(cache) else {}
    name = os.path.basename(take)
    path = os.path.join(WORK, "takes", take + ".wav")
    stamp = os.path.getmtime(path)
    if name not in known or known[name].get("mtime") != stamp:
        from faster_whisper import WhisperModel

        audio, rate = sf.read(path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if rate != 16000:
            from scipy.signal import resample_poly

            audio = resample_poly(audio, 16000, rate).astype("float32")
        model = WhisperModel("medium.en", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(audio, beam_size=5, word_timestamps=True)
        known[name] = {
            "mtime": stamp,
            "words": [[w.word.strip(), w.start, w.end] for s in segments for w in s.words],
        }
        json.dump(known, open(cache, "w"), indent=1)
    return known[name]["words"]


def norm(word):
    return re.sub(r"[^a-z0-9]", "", word.lower())


SOFT = ("and", "into", "in", "so", "with", "for", "to", "from", "but")


def split_long(piece):
    """Split a clause longer than MAX at a word near its middle, before a soft word if one is close."""
    if len(piece) <= MAX:
        return [piece]
    words = piece.split()
    best, score = 1, None
    for k in range(1, len(words)):
        left = len(" ".join(words[:k]))
        cost = abs(left - len(piece) / 2) - (12 if words[k].lower() in SOFT else 0)
        if score is None or cost < score:
            best, score = k, cost
    return split_long(" ".join(words[:best])) + split_long(" ".join(words[best:]))


def chunks(text):
    """Cues end at sentence ends where they can, and never exceed MAX characters."""
    # A dot between letters (Next.js, palamedes.dev) is part of a name, not a sentence end.
    text = re.sub(r"(?<=\w)\.(?=\w)", "\u2024", text)
    clauses = []
    for clause in re.findall(r"[^,.:;?!]+[,.:;?!]*", text):
        clauses += split_long(clause.strip().replace("\u2024", "."))
    out, current = [], ""
    for clause in clauses:
        joined = f"{current} {clause}".strip()
        if current and (len(joined) > MAX or (current[-1] in ".?!" and len(current) >= 24)):
            out.append(current)
            current = clause
        else:
            current = joined
    if current:
        out.append(current)
    return out


def stamp(t):
    h, rest = divmod(t, 3600)
    m, s = divmod(rest, 60)
    return f"{int(h):02}:{int(m):02}:{s:06.3f}"


timed = []
for cue in cues:
    spoken = words_for(cue["take"])
    script = cue["text"].split()
    matcher = difflib.SequenceMatcher(None, [norm(w) for w in script], [norm(w[0]) for w in spoken])
    start_of, end_of = {}, {}
    for a, b, size in matcher.get_matching_blocks():
        for k in range(size):
            start_of[a + k] = spoken[b + k][1]
            end_of[a + k] = spoken[b + k][2]
    first = spoken[0][1] if spoken else 0.0
    last = spoken[-1][2] if spoken else 0.0

    def when(index, table, fallback):
        # Nearest aligned word on either side; numbers and names may not align.
        for step in range(len(script)):
            for k in (index - step, index + step):
                if k in table:
                    return table[k]
        return fallback

    position = 0
    for text in chunks(cue["text"]):
        count = len(text.split())
        begin = cue["at"] + when(position, start_of, first)
        end = cue["at"] + when(position + count - 1, end_of, last) + 0.25
        timed.append([begin, end, text])
        position += count

lines = ["WEBVTT", ""]
for index, (begin, end, text) in enumerate(timed):
    following = timed[index + 1][0] if index + 1 < len(timed) else None
    if following is not None:
        end = min(end, following - 0.04)
    lines += [f"{stamp(begin)} --> {stamp(max(end, begin + 0.5))}", text, ""]

open(OUT, "w").write("\n".join(lines))
print(f"{sum(1 for l in lines if '-->' in l)} cues -> {OUT}")
