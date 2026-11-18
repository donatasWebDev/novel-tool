# Novel Scraper

Browser extension that saves the English chapter you are reading and exports the JSON Novel-TTS imports.

The original `novel-scraper-extension` folder was deleted. This is a new extension built to the export shape in `../Novel-TTS/README.md`.

## Load it

1. Open `edge://extensions` or `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked and select this folder.

## Use it

1. Open a chapter page that already shows English text.
2. Open the extension. Set the novel name.
3. Save chapter, or set Chapters and Start. The count includes the open chapter. Start clicks the Next button on the page and waits for the next chapter to load. Stop ends the run. Closing the popup does not stop it.
5. Export JSON. Put the file in `Novel-TTS/sraped_text/` when the importer exists.

Each chapter is:

```json
{
  "index": 1,
  "chapterNo": 1,
  "chapterId": "path-from-the-url",
  "title": "Chapter 1: ...",
  "wordCount": 1600,
  "url": "https://...",
  "text": "English body..."
}
```

The file also has `exportedAt` and `count`.

Only save text you are allowed to copy. The extension reads the page already open in your browser. It does not log in or pass a paywall.
