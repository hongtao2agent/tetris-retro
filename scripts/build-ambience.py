"""Build the seamless rain-and-pad loops in music/ from two open-licensed field recordings.

Usage: python3 scripts/build-ambience.py <dir with rain-open.wav and rain-window.ogg>
Needs ffmpeg. Sources and licences are listed in music/LICENSE.txt.
"""
import hashlib, json, math, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1])
XFADE, TAIL, LEAD = 6.0, 1.5, 0.25      # seconds: loop crossfade, repeated tail, loop start offset

BEDS = {
    "open": dict(file="rain-open.wav", length=96.0, filt="highpass=f=70", level=-30.0,
                 source="Light Rain Distant Thunder July 5th 2016.wav", author="kvgarlic (freesound.org)", license="CC0 1.0",
                 url="https://commons.wikimedia.org/wiki/File:Light_Rain_Distant_Thunder_July_5th_2016.wav"),
    "window": dict(file="rain-window.ogg", length=70.0, filt="highpass=f=70", level=-30.0,
                   source="Rain against the window.ogg", author="cori (PDSounds)", license="Public domain",
                   url="https://commons.wikimedia.org/wiki/File:Rain_against_the_window.ogg"),
    # the forest rain heard from indoors: muffled and a little quieter
    "indoor": dict(file="rain-open.wav", length=96.0, filt="highpass=f=70,lowpass=f=900,lowpass=f=1400", level=-32.0,
                   source="Light Rain Distant Thunder July 5th 2016.wav", author="kvgarlic (freesound.org)", license="CC0 1.0",
                   url="https://commons.wikimedia.org/wiki/File:Light_Rain_Distant_Thunder_July_5th_2016.wav"),
}
BED_NAMES = {"open": "林间细雨", "window": "窗边的雨", "indoor": "屋内听雨"}
NOTE = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
# id, bed, key (pitch class of the pad's root; the game's notes use its major pentatonic)
TRACKS = [("stage-01", "open", 2), ("stage-02", "window", 7), ("stage-03", "indoor", 0), ("stage-04", "open", 5),
          ("stage-05", "window", 9), ("stage-06", "indoor", 4), ("stage-07", "open", 7), ("stage-08", "window", 2),
          ("stage-09", "indoor", 5), ("stage-10", "open", 9), ("endless", "open", 0), ("zen", "indoor", 2)]
PAD_LEVEL = -37.0


def run(*args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", *args], check=True, capture_output=True, text=True).stderr


def mean_db(path):
    return float(re.search(r"mean_volume: (-?[\d.]+) dB", run("-i", str(path), "-af", "volumedetect", "-f", "null", "-")).group(1))


def bed_loop(bed, out):
    """A loop exactly `length` long whose end runs straight into its start."""
    L = bed["length"]
    graph = (f"[0:a]aformat=channel_layouts=stereo,aresample=44100,{bed['filt']},asplit=3[a][b][c];"
             f"[a]atrim={XFADE}:{L},asetpts=PTS-STARTPTS[body];"
             f"[b]atrim={L}:{L + XFADE},asetpts=PTS-STARTPTS[out];"
             f"[c]atrim=0:{XFADE},asetpts=PTS-STARTPTS[in];"
             f"[out][in]acrossfade=d={XFADE}:c1=qsin:c2=qsin[join];[join][body]concat=n=2:v=0:a=1")
    run("-i", str(SRC / bed["file"]), "-filter_complex", graph, "-t", str(L), "-c:a", "pcm_f32le", str(out))


def pad_loop(key, L, out):
    """Soft sustained root-fifth-ninth pad. Every sine is a whole number of cycles per loop."""
    def channel(seed):
        terms = []
        for n, (semis, amp, lfo) in enumerate([(0, .30, 3), (7, .22, 4), (12, .16, 5), (14, .12, 7), (19, .06, 2)]):
            freq = 440 * 2 ** ((48 + key + semis - 69) / 12)
            for d, detune in enumerate((-.0017, .0013 + seed * .0006)):
                cycles = round(freq * (1 + detune) * L)
                phase = (n * 1.7 + d * 2.3 + seed) % (2 * math.pi)
                terms.append(f"{amp / 2:.3f}*(0.55+0.45*sin(2*PI*{lfo}*t/{L}+{phase + d:.2f}))*sin(2*PI*{cycles}*t/{L}+{phase:.2f})")
        return "+".join(terms)
    run("-f", "lavfi", "-i", f"aevalsrc={channel(0)}|{channel(1)}:s=44100:d={L}", "-af", "lowpass=f=1800", "-c:a", "pcm_f32le", str(out))


def main():
    tracks, tmp = [], Path(tempfile.mkdtemp())
    beds = {}
    for name, bed in BEDS.items():
        beds[name] = tmp / (name + ".wav")
        bed_loop(bed, beds[name])
        bed["gain"] = bed["level"] - mean_db(beds[name])
    for track_id, bed_name, key in TRACKS:
        bed, L = BEDS[bed_name], BEDS[bed_name]["length"]
        pad, loop, out = tmp / "pad.wav", tmp / "loop.wav", ROOT / "music" / (track_id + ".m4a")
        pad_loop(key, L, pad)
        run("-i", str(beds[bed_name]), "-i", str(pad), "-filter_complex",
            f"[0:a]volume={bed['gain']:.2f}dB[r0];[r0]anull[r];[1:a]volume={PAD_LEVEL - mean_db(pad):.2f}dB[p];"
            f"[r]acompressor=threshold=0.07:ratio=3:attack=15:release=400[rc];[rc][p]amix=inputs=2:normalize=0,alimiter=limit=0.5:level=0", "-c:a", "pcm_f32le", str(loop))
        # lead-in + loop + the loop's first moments again, so [LEAD, LEAD + L] loops cleanly after AAC padding
        run("-i", str(loop), "-filter_complex",
            f"[0:a]asplit=3[x][y][z];[x]atrim={L - LEAD}:{L},asetpts=PTS-STARTPTS[lead];"
            f"[z]atrim=0:{TAIL},asetpts=PTS-STARTPTS[tail];[lead][y][tail]concat=n=3:v=0:a=1",
            "-map_metadata", "-1", "-c:a", "aac", "-b:a", "96k", "-ar", "44100", str(out))
        scale = sorted((key + step) % 12 for step in (0, 2, 4, 7, 9))
        tracks.append(dict(id=track_id, title=f"{BED_NAMES[bed_name]} · {NOTE[key]} 调", bed=bed_name, key=NOTE[key], scale=scale,
                           bass=36 + key, file=f"music/{track_id}.m4a", loopStart=LEAD, loopEnd=LEAD + L,
                           source=bed["source"], sourceUrl=bed["url"], license=bed["license"], bytes=out.stat().st_size))
        print(track_id, tracks[-1]["title"], out.stat().st_size)
    manifest = dict(collection="Rain field recordings with a generated sustained pad", revision="rain-v1",
                    processing=f"Each bed is crossfaded into a seamless loop, levelled to about {BEDS['open']['level']:.0f} dB mean, mixed with a "
                               f"generated root-fifth-ninth pad at {PAD_LEVEL:.0f} dB mean, AAC 96 kbps stereo at 44.1 kHz. "
                               "Built by scripts/build-ambience.py.",
                    sources=[dict(file=b["source"], author=b["author"], license=b["license"], url=b["url"],
                                  sha256=hashlib.sha256((SRC / b["file"]).read_bytes()).hexdigest()) for b in (BEDS["open"], BEDS["window"])],
                    tracks=tracks)
    (ROOT / "music" / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    lines = ["Graphite Blocks — background ambience", "=====================================", "",
             "Every loop is a rain field recording mixed with a sustained pad generated for this game",
             "(scripts/build-ambience.py). The recordings come from Wikimedia Commons; licence labels",
             "are those shown on each file page on 2026-11-12.", ""]
    for b in (BEDS["open"], BEDS["window"]):
        lines += [b["source"], "  Recorded by: " + b["author"], "  Licence:     " + b["license"]
                  + (" (https://creativecommons.org/publicdomain/zero/1.0/)" if b["license"].startswith("CC0") else ""),
                  "  Source:      " + b["url"], "  Used in:     " + ", ".join(t["file"] for t in tracks if t["sourceUrl"] == b["url"]), ""]
    (ROOT / "music" / "LICENSE.txt").write_text("\n".join(lines), encoding="utf8")


main()
