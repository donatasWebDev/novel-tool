# Novel-TTS

Turn a **pre-translated English novel export** into chapter audio (Kokoro) and portable **~4 hour parts** (whole chapters only).

**Current path (recommended):**

```text
browser extension JSON  →  import-json  →  tts  →  pack --concat
```

Scrape/translate via lncrawl + LM Studio are optional/future; if your site already gives English (e.g. Flash MTL), you only need import + TTS + pack.

---

## Requirements

| Piece | Notes |
|--------|--------|
| **Python 3.12** | Kokoro needs &lt; 3.13. Use the project `.venv`. |
| **NVIDIA GPU + CUDA torch** | Strongly recommended. CPU works but is slow. |
| **FFmpeg** | On `PATH` — needed for MP3 parts (`pack --concat`). |
| **RAM / disk** | Full novel chapter WAVs can be tens of GB; part MP3s are much smaller. |

Duplicate-text checking for exports is a **separate** tool: `../json-dup-check/` (not part of this package).

---

## Setup (Windows / PowerShell)

```powershell
cd C:\Users\Pcc\Desktop\code\Novel-TTS

# once: create venv with Python 3.12
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1

# deps (torch CUDA may already be installed in this project’s venv)
pip install -r requirements.txt

# config
copy config.example.yaml config.yaml
# edit config.yaml → voice, speed, format if you want

# verify env
python -m novel_tts check
python -m novel_tts check --smoke
```

Activate the venv every session:

```powershell
cd C:\Users\Pcc\Desktop\code\Novel-TTS
.\.venv\Scripts\Activate.ps1
```

---

## Quick start

### 1. Export English chapters

Use your browser extension to scrape the novel and export JSON shaped like:

```json
{
  "exportedAt": "...",
  "count": 806,
  "chapters": [
    {
      "index": 1,
      "chapterNo": 1,
      "chapterId": "...",
      "title": "Chapter 1: ...",
      "wordCount": 1600,
      "url": "https://...",
      "text": "English body..."
    }
  ]
}
```

Optional: put a copy under `sraped_text/` (project folder name as on disk).

Optional: check for duplicate chapter bodies with:

```powershell
cd ..\json-dup-check
python check_duplicates.py "C:\path\to\export.json"
```

### 2. Import into a novel folder

```powershell
python -m novel_tts import-json "sraped_text\final_srcrape.json"
# or an absolute path to Downloads\novel-chapters-....json
```

Creates:

```text
data/novels/<slug>/
  translated/chapter_001.txt …
  audio/                 (empty until TTS)
  parts/                 (empty until pack --concat)
  meta.json
  state.json
  source_export.json
  playlist.m3u           (filled after TTS)
```

### 3. Generate chapter audio (TTS)

```powershell
# full book (resume-safe: skips existing chapter_*.wav)
python -m novel_tts tts --novel "data\novels\<slug>"

# smoke / one range
python -m novel_tts tts --novel "data\novels\my-stats-double-every-day-ill-go-dark-and-slaughter-everythi" --chapters 1-21

# re-do chapters
python -m novel_tts tts --novel "data\novels\<slug>" --chapters 5-8 --force

# import + TTS in one step
python -m novel_tts tts --json "sraped_text\final_srcrape.json" --first 2
```

Defaults come from `config.yaml` (`tts.voice`, `tts.speed`, `tts.format`).

| Flag | Meaning |
|------|---------|
| `--chapters 1-21` or `1,3,8` | Only those chapter numbers |
| `--first N` | First N chapter files only |
| `--voice af_heart` | Kokoro voice override |
| `--speed 1.0` | Speech rate |
| `--format wav` / `mp3` | Chapter output format |
| `--force` | Overwrite existing audio |
| `--workers N` | Parallel **processes** (default 1). Each worker loads its own Kokoro model and gets a contiguous chapter range. On one GPU try **2** max; more often OOMs or slows down. Threads do **not** help GPU TTS. |
| `--pack-after` | After TTS, **print** a ~4h pack plan (no files) |

Chapter WAVs land in `audio/chapter_NNN.wav`. A chapter playlist is written to `playlist.m3u`.

### 4. Batch queue (recommended for the rest of the book)

Pumps remaining chapters through a queue: **each item = 2 parts on 2 workers**, then concat those parts, then the next item.

```powershell
# preview full queue
python -m novel_tts batch --novel "data\novels\<slug>" --workers 2 --hours 4 --dry-run

# run (resume-safe: starts at first chapter missing audio)
python -m novel_tts batch --novel "data\novels\my-stats-double-every-day-ill-go-dark-and-slaughter-everythi" --workers 2 --hours 8
```

| Flag | Meaning |
|------|---------|
| `--workers 2` | Parts per queue item / parallel processes (default 2) |
| `--hours 4` | Target hours per part |
| `--from-chapter N` | Override start chapter (default: first missing WAV) |
| `--start-part N` | Override next part number (default: after highest `part_NN` on disk) |
| `--dry-run` | Print queue only |
| `--skip-pack` | TTS only, no part MP3 concat |

### 5. Pack into ~4 hour parts (manual / one range)

Whole chapters only — a chapter is never split mid-file. Packing is greedy by **measured** WAV duration when audio exists, otherwise word-count estimate (~150 WPM).

```powershell
# preview only
python -m novel_tts pack --novel "data\novels\<slug>" --hours 4 --dry-run

# build part MP3s (ffmpeg)
python -m novel_tts pack --novel "data\novels\building-a-long-lived-family-from-the-genealogy"  --hours 6 --concat --out-format mp3

# one part range (e.g. after generating that range with tts)
python -m novel_tts pack --novel "data\novels\building-a-long-lived-family-from-the-genealogy" --chapters 22-43 --hours 8 --concat
```

| Flag | Meaning |
|------|---------|
| `--hours 4` | Target length per part (default 4) |
| `--concat` | Actually build part files with ffmpeg |
| `--out-format mp3` | `mp3` (default), `wav`, or `m4a` |
| `--gap 0.6` | Silence between chapters inside a part (seconds) |
| `--max-chapters N` | Optional hard cap of chapters per part |
| `--force` | Rebuild part files that already exist |
| `--dry-run` | Print plan only |

**Layout after pack:**

```text
data/novels/<slug>/
  playlist.m3u           # per-chapter
  playlist_parts.m3u     # per-part (next to chapter playlist)
  audio/
    chapter_001.wav …
  parts/                 # audio only — no manifest/gap junk
    part_01_ch001-021.mp3
    part_02_ch022-043.mp3
    …
```

Typical size: ~20–22 chapters ≈ ~3.7–4.0 h ≈ ~115 MB MP3 per part (voice/speed dependent).

---

## Commands reference

```text
python -m novel_tts check [--smoke] [--skip-tts]
python -m novel_tts import-json <export.json> [--slug NAME] [--novel DIR]
python -m novel_tts tts --novel DIR | --json FILE  [options]
python -m novel_tts pack --novel DIR [--hours 4] [--concat] [options]
```

```powershell
python -m novel_tts --help
python -m novel_tts tts --help
python -m novel_tts pack --help
```

Not implemented yet: `scrape`, `translate`, `run` (full classic pipeline).

---

## Config (`config.yaml`)

Copy from `config.example.yaml`. Important TTS keys:

```yaml
tts:
  voice: "af_heart"    # Kokoro voice id
  speed: 1.0
  lang_code: "a"       # American English
  format: "wav"        # chapter files; parts usually mp3 via pack
  sample_rate: 24000

paths:
  data_dir: "./data/novels"
```

Optional env overrides (see `config.example.yaml`): `LM_STUDIO_URL`, `LM_STUDIO_MODEL`, `NOVEL_TTS_VOICE`.

---

## Example: this project’s novel

```powershell
cd C:\Users\Pcc\Desktop\code\Novel-TTS
.\.venv\Scripts\Activate.ps1

$novel = "data\novels\i-built-a-system-from-scratch-and-it-drove-the-cultivation-w"

$novel = "data\novels\from-poor-to-immortal-family"

# import final scrape (once)
python -m novel_tts import-json "sraped_text\final_srcrape.json"

# smoke: part 1 then part 2 (packer chooses ~4h ranges)
python -m novel_tts tts --novel $novel --chapters 1-21
python -m novel_tts pack --novel $novel --chapters 1-21 --hours 4 --concat

python -m novel_tts tts --novel $novel --chapters 22-43
python -m novel_tts pack --novel $novel --chapters 22-43 --hours 4 --concat

# remaining chapters (resume-safe)
python -m novel_tts tts --novel $novel
python -m novel_tts pack --novel $novel --hours 4 --concat
```

After a full pack of the book (~806 chapters), expect on the order of **~35–40 parts** and **~140+ hours** of audio at speed 1.0.

---

## Tips

1. **Resume** — TTS skips chapters that already have `audio/chapter_NNN.<ext>` unless you pass `--force`.
2. **Disk** — Prefer keeping chapters as WAV for clean resume/re-pack; use `parts/*.mp3` to move or upload.
3. **Part numbering** — Filenames include chapter ranges (`part_02_ch022-043.mp3`). If you pack a single range alone, the tool may label it `part_01_…` for that run; rename if you want global part numbers, or pack the full novel once so numbers are sequential.
4. **Duplicates in export** — Fix or drop bad chapters before import; use `json-dup-check` on the raw JSON.
5. **Voice / speed** — Change in `config.yaml` or per-run flags; re-run with `--force` on chapters you want redone.

---

## Project layout

```text
Novel-TTS/
  README.md
  PLAN.md / PROGRESS.md      # design + session notes
  config.example.yaml
  config.yaml                # local (not committed if gitignored)
  requirements.txt
  sraped_text/               # your final scrape JSON (optional drop folder)
  novel_tts/
    cli.py                   # entry: python -m novel_tts …
    import_json.py
    tts.py
    pack.py
    check.py
    config.py / models.py / utils.py
  data/
    novels/<slug>/
      translated/
      audio/
      parts/
      playlist.m3u
      playlist_parts.m3u
```

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `No translated chapters` | Run `import-json` first; check `translated/*.txt`. |
| Kokoro / CUDA errors | `python -m novel_tts check --smoke`; confirm Python 3.12 venv and GPU torch. |
| `ffmpeg not on PATH` | Install FFmpeg (e.g. `winget install Gyan.FFmpeg`), open a new shell. |
| Part concat skipped | Chapter audio missing for that range — finish `tts --chapters …` first. |
| VRAM full | Close other GPU apps; try fewer parallel tools; smoke with `--skip-tts` only checks non-TTS. |

---

## License / notes

Local personal pipeline. Respect site ToS and copyright for any novel you scrape or distribute as audio.
