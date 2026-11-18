# Novel-TTS rebuild map

The Python source is gone. This file is the design recovered from the last README (11 Aug 2026) and from VS Code’s record of the earlier session (26 Jul 2026). `README.md` in this folder is that original README, copied back unchanged. Use it as the spec. This file is the module map for writing the code again.

No chapter audio was copied. Large wav and mp3 files were left unrecovered on purpose.

## What the tool did

Local Windows pipeline. It turns a browser-extension JSON export of an already-English novel into Kokoro chapter audio, then into portable parts of about 4 hours. A part is whole chapters only. A chapter is never cut in the middle.

Recommended path:

```text
browser extension JSON  →  import-json  →  tts  →  pack --concat
```

Scrape and translate (lncrawl, LM Studio) were installed in the venv and described as optional or future. The README says these commands were not implemented: `scrape`, `translate`, `run`.

Runtime: Python 3.12 venv at `.venv` (Kokoro needs Python before 3.13), NVIDIA CUDA torch, FFmpeg on `PATH`.

## Commands

Entry: `python -m novel_tts`

```text
python -m novel_tts check [--smoke] [--skip-tts]
python -m novel_tts import-json <export.json> [--slug NAME] [--novel DIR]
python -m novel_tts tts --novel DIR | --json FILE  [options]
python -m novel_tts pack --novel DIR [--hours 4] [--concat] [options]
python -m novel_tts batch --novel DIR [--workers 2] [--hours 4] [--dry-run]
```

`tts` flags: `--chapters 1-21` or `1,3,8`, `--first N`, `--voice`, `--speed`, `--format wav|mp3`, `--force`, `--workers N`, `--pack-after`.

`pack` flags: `--hours`, `--concat`, `--out-format mp3|wav|m4a`, `--gap 0.6`, `--max-chapters N`, `--force`, `--dry-run`.

`batch` flags: `--workers` (parts per queue item, default 2), `--hours`, `--from-chapter`, `--start-part`, `--dry-run`, `--skip-pack`.

Behavior that has to stay:

- TTS is resume-safe. Skip `audio/chapter_NNN.<ext>` unless `--force`.
- `--workers` is processes, not threads. Each worker loads its own Kokoro model and gets a contiguous chapter range. On one GPU, 2 was the practical max.
- Pack length uses measured WAV duration when the audio exists, otherwise a word-count estimate of about 150 words per minute.
- `--pack-after` only prints a plan. It does not write part files.
- `batch` pumps a queue. Each item is N parts on N workers, then ffmpeg-concats those parts, then the next item. It starts at the first chapter missing audio.
- Part files look like `part_01_ch001-021.mp3`. Packing one range by itself can label that range `part_01`. A full-book pack numbers parts in order.
- Silence between chapters inside a part defaults to 0.6 seconds.
- Typical size called out in the README: about 20–22 chapters, about 3.7–4.0 hours, about 115 MB MP3 per part.

## Input JSON

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

Duplicate chapter bodies were checked by a separate folder, `../json-dup-check/`, command `python check_duplicates.py <export.json>`. That tool was not recovered.

## On-disk layout

```text
Novel-TTS/
  README.md
  PLAN.md                  # 283 lines on 26 Jul. Not recovered.
  PROGRESS.md              # 141 lines on 26 Jul. Not recovered.
  config.example.yaml      # 37 lines on 26 Jul. Not recovered.
  config.yaml              # 28 lines, local, not for git.
  requirements.txt         # 172 lines. Was a pip freeze. Only the tail survived.
  .gitignore               # 35 lines. Not recovered.
  .venv/                   # Python 3.12. Gone with the folder.
  scripts/                 # Folder existed. No file names survived.
  sraped_text/             # Optional drop folder. Name was spelled that way.
  novel_tts/
    __init__.py            # 4 lines on 26 Jul.
    __main__.py            # 5 lines on 26 Jul. Launches the CLI.
    cli.py                 # Described in the August README. No line count.
    import_json.py
    tts.py
    pack.py
    check.py
    config.py              # 117 lines on 26 Jul.
    models.py              # 181 lines on 26 Jul.
    utils.py               # 159 lines on 26 Jul.
  data/novels/<slug>/
    translated/chapter_001.txt
    audio/chapter_001.wav
    parts/part_01_ch001-021.mp3
    meta.json
    state.json
    source_export.json
    playlist.m3u
    playlist_parts.m3u
```

The July line counts are from before the August README. `cli.py`, `import_json.py`, `tts.py`, `pack.py`, and `check.py` are in the August design. Their source was not in any backup.

`import-json` creates the novel folder: `translated/`, empty `audio/` and `parts/`, `meta.json`, `state.json`, `source_export.json`, and an empty `playlist.m3u` that TTS fills later. Pack writes `playlist_parts.m3u` next to the chapter playlist. `parts/` is audio only.

## Config

Copy `config.example.yaml` to `config.yaml`. Keys the README names:

```yaml
tts:
  voice: "af_heart"
  speed: 1.0
  lang_code: "a"
  format: "wav"
  sample_rate: 24000

paths:
  data_dir: "./data/novels"
```

Env overrides named in the README: `LM_STUDIO_URL`, `LM_STUDIO_MODEL`, `NOVEL_TTS_VOICE`.

## Packages that were actually installed

`recovered-pip-freeze-tail.txt` is the tail of `pip freeze` from the project venv. The terminal scrollback started at `imap-tools`, so names from A through H are missing. The full freeze was 172 lines. Direct pieces the tool needed:

- `kokoro==0.9.4`
- `misaki==0.9.4`
- `torch==2.11.0+cu128`
- `soundfile==0.14.0`
- `PyYAML==6.0.3`
- `python-slugify==8.0.4`

Also present, for the unfinished scrape/translate side or the CLI: `lightnovel-crawler==4.13.1`, `lncrawl-scraper==0.2.5`, `lncrawl-translator==0.2.1`, `openai==2.48.0`, `typer==0.27.0`, `loguru==0.7.3`, `rich==15.0.0`.

## Novels this copy was pointed at

Slugs written in the README examples:

- `my-stats-double-every-day-ill-go-dark-and-slaughter-everythi`
- `building-a-long-lived-family-from-the-genealogy`
- `i-built-a-system-from-scratch-and-it-drove-the-cultivation-w`
- `from-poor-to-immortal-family`

One full book in the notes was about 806 chapters, about 35–40 parts, about 140 hours at speed 1.0.

## What to build first

1. `config.py` loads `config.yaml` and the env overrides.
2. `models.py` holds a chapter, a novel directory, and a pack range.
3. `import_json.py` writes `translated/chapter_NNN.txt` and the json sidecars.
4. `tts.py` calls Kokoro per chapter, skips existing files, and can split a range across processes.
5. `pack.py` greedily fills an hour budget and, with `--concat`, calls ffmpeg.
6. `check.py` verifies Python 3.12, torch, ffmpeg, and an optional one-line smoke synth.
7. `__main__.py` calls the CLI. Keep it a few lines.
