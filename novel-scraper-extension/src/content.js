const SELECTORS = [
  "[itemprop='articleBody']",
  "#chapter-content",
  "#chapterContent",
  "#chr-content",
  ".chapter-content",
  ".chapter-body",
  ".text-content",
  ".reading-content",
  "#novel-content",
  ".entry-content",
  ".post-content",
  "article",
  "#content"
];

const JUNK_LINE = /^(next|previous|prev)\s*chapter\b|^advertisement$|^ads?\s*by\b/i;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "scan" || msg.type === "extract") {
    const chapter = scanPage();
    if (msg.type === "extract" && chapter.text.length < 100) {
      sendResponse({ ok: false, error: "The detected text is too short to be a chapter." });
      return false;
    }
    sendResponse({ ok: true, chapter });
    return false;
  }
  if (msg.type === "click-next") {
    try {
      sendResponse({ ok: true, ...clickNext() });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
    return false;
  }
  if (msg.type === "toast") {
    showToast(msg.text);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

function scanPage() {
  const body = findBody();
  const text = body ? cleanup(body.innerText || "") : "";
  const title = findTitle();
  const url = location.href.split("#")[0];
  const nextButton = findNextButton();
  const chapterNo = chapterNumber(title, url);
  const words = wordCount(text);
  return {
    title,
    chapterNo,
    chapterId: text ? chapterId(url, text) : "",
    text,
    wordCount: words,
    url,
    hasNext: Boolean(nextButton),
    novelGuess: guessNovel(title),
    ready: chapterNo != null && words > 0 && Boolean(nextButton) && text.length >= 100
  };
}

function findBody() {
  return bestBody(document) || bestBodyInShadows(document);
}

function bestBody(root) {
  let best = null;
  let bestWords = 0;
  for (const selector of SELECTORS) {
    for (const el of root.querySelectorAll(selector)) {
      const words = scoreBody(el);
      if (words > bestWords) {
        best = el;
        bestWords = words;
      }
    }
  }
  if (best && bestWords >= 80) return best;

  for (const el of root.querySelectorAll("div, article, section, main")) {
    if (el.querySelectorAll(":scope > p").length < 4) continue;
    const words = scoreBody(el);
    if (words > bestWords) {
      best = el;
      bestWords = words;
    }
  }
  return bestWords >= 80 ? best : null;
}

function bestBodyInShadows(root) {
  for (const el of root.querySelectorAll("*")) {
    if (!el.shadowRoot) continue;
    const found = bestBody(el.shadowRoot) || bestBodyInShadows(el.shadowRoot);
    if (found) return found;
  }
  return null;
}

function scoreBody(el) {
  if (!isVisible(el)) return 0;
  const words = wordCount(el.innerText || "");
  return words > 0 && words < 80000 ? words : 0;
}

function findTitle() {
  const heading = document.querySelector("h1");
  const headingText = heading?.innerText?.trim();
  if (headingText && headingText.length < 180) return headingText;
  const raw = document.title.trim();
  return raw.replace(/\s+[|\-–—]\s+.*$/, "").trim() || raw || "Untitled chapter";
}

function guessNovel(chapterTitle) {
  const crumbs = [...document.querySelectorAll("nav a, .breadcrumb a, .breadcrumbs a")]
    .map((a) => a.textContent.trim())
    .filter((text) => text && !/^home$/i.test(text) && text.length < 80);
  if (crumbs.length) return crumbs[crumbs.length - 1];
  const siteTitle = document.title.split(/\s+[|\-–—]\s+/)[0]?.trim();
  if (siteTitle && !/chapter/i.test(siteTitle)) return siteTitle;
  return chapterTitle.replace(/chapter[\s._-]*\d+.*$/i, "").trim() || location.hostname;
}

function chapterNumber(title, url) {
  return numberFrom(url) ?? numberFrom(title);
}

function numberFrom(source) {
  if (!source) return null;
  const patterns = [
    /chapter[\s._-]*(\d+(?:\.\d+)?)/i,
    /\bch[\s._-]*(\d+(?:\.\d+)?)/i,
    /\/(\d+)\/?(?:$|\?|#)/,
    /[-_](\d+)(?:\.html?)?$/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function chapterId(url, text) {
  const parsed = new URL(url);
  const path = (parsed.pathname + parsed.search).replace(/^\/+/, "") || parsed.host;
  return `${path}#${fingerprint(text)}`;
}

function findNextButton() {
  const matches = [];
  for (const el of controlsIn(document)) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    const label = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (/^next\b/i.test(label)) matches.push(el);
  }
  return matches.find(isVisible) || matches[0] || null;
}

function controlsIn(root) {
  const found = [...root.querySelectorAll("button, [role='button']")];
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) found.push(...controlsIn(el.shadowRoot));
  }
  return found;
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function press(el) {
  const event = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent("pointerdown", event));
  el.dispatchEvent(new MouseEvent("mousedown", event));
  el.dispatchEvent(new PointerEvent("pointerup", event));
  el.dispatchEvent(new MouseEvent("mouseup", event));
  el.click();
}

function clickNext() {
  const button = findNextButton();
  if (!button) throw new Error("No Next button on this page.");
  press(button);
  return { clicked: true };
}

function fingerprint(text) {
  let hash = 0;
  const sample = text.slice(0, 500);
  for (let i = 0; i < sample.length; i += 1) {
    hash = (Math.imul(31, hash) + sample.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function cleanup(text) {
  return text
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !JUNK_LINE.test(line))
    .join("\n\n")
    .trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function showToast(text) {
  let toast = document.getElementById("novel-scraper-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "novel-scraper-toast";
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: "2147483647",
      maxWidth: "320px",
      background: "#1c2430",
      color: "#f4efe6",
      padding: "10px 12px",
      font: "14px Georgia, serif",
      borderRadius: "6px"
    });
    document.documentElement.appendChild(toast);
  }
  toast.textContent = text;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.remove(), 4000);
}
