const SCAN_LIMIT_MS = 90000;
const MIN_TEXT_CHARS = 100;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  continueJob(tabId, tab.url || "").catch((err) => failJob(err));
});

async function handle(msg) {
  if (msg.type === "list") return { ok: true, novels: await summaries() };
  if (msg.type === "get-novel") return { ok: true, novel: await getNovel(msg.novelTitle) };
  if (msg.type === "save") {
    const saved = await saveChapter(msg.novelTitle, msg.chapter, msg.chapterNo);
    return { ok: true, ...saved };
  }
  if (msg.type === "clear") {
    await clearNovel(msg.novelTitle);
    return { ok: true };
  }
  if (msg.type === "status") return { ok: true, ...(await status()) };
  if (msg.type === "start") {
    await startJob(msg);
    return { ok: true };
  }
  if (msg.type === "stop") {
    await chrome.storage.session.remove("job");
    await setStatus("Stopped.");
    return { ok: true };
  }
  if (msg.type === "selector-picked") return { ok: true };
  return { ok: false, error: "Unknown message." };
}

async function startJob(msg) {
  const count = Number(msg.count);
  if (!Number.isInteger(count) || count < 1) throw new Error("Chapter count must be a whole number.");
  const delaySec = Number(msg.delaySec);
  if (!Number.isFinite(delaySec) || delaySec < 0 || delaySec > 120) {
    throw new Error("Delay must be between 0 and 120 seconds.");
  }
  const job = {
    tabId: msg.tabId,
    novelTitle: msg.novelTitle.trim(),
    chapterNo: msg.chapterNo,
    left: count,
    phase: "extract",
    step: 0,
    nextUrl: "",
    nextDelayMs: Math.round(delaySec * 1000),
    previousKey: ""
  };
  if (!job.novelTitle) throw new Error("Name the novel first.");
  await chrome.storage.session.set({ job });
  await setStatus(`Reading this page. ${count} left.`);
  await tick(job);
}

async function continueJob(tabId, url) {
  const job = await getJob();
  if (!job || job.phase !== "navigate" || job.tabId !== tabId || !job.expectLoad) return;
  if (job.seenUrl && normalize(url) === normalize(job.seenUrl)) return;
  job.phase = "extract";
  job.expectLoad = false;
  job.step += 1;
  await chrome.storage.session.set({ job });
  await tick(job);
}

async function tick(job) {
  const current = await getJob();
  if (!current || current.step !== job.step || current.phase !== "extract") return;
  let chapter;
  try {
    chapter = await scanUntilReady(current);
  } catch (err) {
    if (await holdForLoad(current, err)) return;
    await failJob(err);
    return;
  }
  if (!chapter) return;
  const saved = await saveChapter(job.novelTitle, chapter, job.step === 0 ? job.chapterNo : null);
  const latest = await getJob();
  if (!latest || latest.step !== job.step) return;
  latest.previousKey = openingKey(chapter.text);
  latest.page = pageFacts(chapter);
  latest.left -= 1;
  await publishPage(chapter);
  await toast(job.tabId, `Saved chapter ${saved.chapter.chapterNo}. ${latest.left} left.`);
  if (latest.left <= 0 || !chapter.hasNext) {
    await chrome.storage.session.remove("job");
    const reason = chapter.hasNext ? "Collected the requested chapters." : "No Next button.";
    await setStatus(`${reason} ${saved.count} saved in this novel.`);
    await toast(job.tabId, reason);
    return;
  }
  latest.phase = "navigate";
  latest.expectLoad = false;
  latest.seenUrl = chapter.url;
  await chrome.storage.session.set({ job: latest });
  if (!(await waitDelay(latest, `Saved. Waiting ${delaySeconds(latest)}s before Next. ${latest.left} left.`))) return;
  await setStatus(`Clicking Next. ${latest.left} left.`);
  await openNext(latest);
}

async function openNext(job) {
  try {
    const res = await chrome.tabs.sendMessage(job.tabId, { type: "click-next" });
    const current = await getJob();
    if (!current || current.phase !== "navigate" || current.step !== job.step) return;
    if (!res?.ok || !res.clicked) throw new Error(res?.error || "The Next button was not clicked.");
    current.page = null;
    await publishPage(null);
    current.phase = "extract";
    current.step += 1;
    await chrome.storage.session.set({ job: current });
    await tick(current);
  } catch (err) {
    const current = await getJob();
    if (!current || current.phase !== "navigate" || current.step !== job.step) return;
    if (!pageUnloaded(err)) {
      await failJob(err);
      return;
    }
    current.expectLoad = true;
    await chrome.storage.session.set({ job: current });
    await setStatus("Waiting for the next page.");
  }
}

async function scanUntilReady(job) {
  const deadline = Date.now() + SCAN_LIMIT_MS;
  let lastProblem = "The page was not ready.";
  while (Date.now() < deadline) {
    if (!(await jobStillOn(job))) return null;
    const seconds = delaySeconds(job);
    if (!(await waitDelay(job, `Waiting ${seconds}s before scanning. ${job.left} left.`))) return null;
    if (!(await jobStillOn(job))) return null;
    let scan;
    try {
      scan = await scanTab(job.tabId);
    } catch (err) {
      if (pageUnloaded(err)) throw err;
      lastProblem = err.message || lastProblem;
      await setStatus(lastProblem);
      continue;
    }
    job.page = pageFacts(scan);
    await publishPage(scan);
    const problem = readinessProblem(scan, job.previousKey);
    if (!problem) return scan;
    lastProblem = problem;
    await setStatus(`${problem} ${job.left} left.`);
  }
  throw new Error(lastProblem);
}

async function scanTab(tabId) {
  const res = await chrome.tabs.sendMessage(tabId, { type: "scan" });
  if (!res?.ok || !res.chapter) throw new Error(res?.error || "Could not read the page.");
  return res.chapter;
}

async function holdForLoad(job, err) {
  if (!pageUnloaded(err)) return false;
  const current = await getJob();
  if (!current || current.step !== job.step) return true;
  current.phase = "navigate";
  current.expectLoad = true;
  current.page = null;
  await chrome.storage.session.set({ job: current });
  await publishPage(null);
  await setStatus("Waiting for the next page.");
  return true;
}

async function waitDelay(job, message) {
  const waitMs = Math.max(job.nextDelayMs || 0, 300);
  await setStatus(message);
  const step = 200;
  let left = waitMs;
  while (left > 0) {
    if (!(await jobStillOn(job))) return false;
    const slice = Math.min(step, left);
    await delay(slice);
    left -= slice;
  }
  return jobStillOn(job);
}

function delaySeconds(job) {
  return ((job.nextDelayMs || 0) / 1000).toFixed(1).replace(/\.0$/, "");
}

async function jobStillOn(job) {
  const current = await getJob();
  return Boolean(current && current.step === job.step && current.phase === job.phase);
}

function readinessProblem(scan, previousKey) {
  const missing = [];
  if (scan.chapterNo == null) missing.push("chapter number");
  if (!(scan.wordCount > 0)) missing.push("word count");
  if (!scan.hasNext) missing.push("Next button");
  if ((scan.text || "").length < MIN_TEXT_CHARS) missing.push(`${MIN_TEXT_CHARS} characters of text`);
  if (missing.length) return `Not ready: ${missing.join(", ")}. ${describe(scan)}.`;
  if (previousKey && openingKey(scan.text) === previousKey) {
    return `Same opening as the last chapter. ${describe(scan)}.`;
  }
  return "";
}

function describe(scan) {
  const number = scan.chapterNo == null ? "Chapter not detected" : `Chapter ${scan.chapterNo}`;
  const next = scan.hasNext ? "Next button found" : "No Next button";
  return `${number}, ${scan.wordCount || 0} words, ${next}, ${(scan.text || "").length} chars`;
}

function pageFacts(scan) {
  return {
    title: scan.title || "",
    chapterNo: scan.chapterNo ?? null,
    wordCount: scan.wordCount || 0,
    hasNext: Boolean(scan.hasNext),
    textLength: (scan.text || "").length,
    snippet: (scan.text || "").slice(0, 280),
    url: scan.url || ""
  };
}

async function publishPage(scan) {
  await chrome.storage.session.set({ pagePreview: scan ? pageFacts(scan) : null });
}

// First 30 characters with whitespace removed. A chapter that has not
// changed still matches when the site drops line breaks during navigation.
function openingKey(text) {
  return String(text || "").replace(/\s+/g, "").slice(0, 30);
}

async function saveChapter(novelTitle, chapter, chapterNoOverride) {
  const title = (novelTitle || chapter.novelGuess || "Untitled novel").trim();
  const key = slug(title);
  const data = await chrome.storage.local.get("novels");
  const novels = data.novels || {};
  const novel = novels[key] || { title, chapters: {} };
  novel.title = title;
  const chapterNo = numberOrNull(chapterNoOverride) ?? chapter.chapterNo ?? nextNumber(novel);
  const record = {
    chapterNo,
    chapterId: chapter.chapterId,
    title: chapter.title,
    wordCount: chapter.wordCount,
    url: chapter.url,
    text: chapter.text,
    savedAt: new Date().toISOString()
  };
  novel.chapters[chapter.chapterId] = record;
  novel.updatedAt = record.savedAt;
  novels[key] = novel;
  await chrome.storage.local.set({ novels, activeNovel: title });
  const count = Object.keys(novel.chapters).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#8a5a2b" });
  await chrome.action.setBadgeText({ text: String(count) });
  return { novelTitle: title, count, chapter: record };
}

function nextNumber(novel) {
  const numbers = Object.values(novel.chapters).map((ch) => ch.chapterNo).filter((n) => typeof n === "number");
  if (!numbers.length) return 1;
  return Math.max(...numbers) + 1;
}

async function getNovel(novelTitle) {
  const data = await chrome.storage.local.get("novels");
  return data.novels?.[slug(novelTitle)] || null;
}

async function summaries() {
  const data = await chrome.storage.local.get(["novels", "activeNovel"]);
  const novels = data.novels || {};
  return {
    activeNovel: data.activeNovel || "",
    items: Object.values(novels)
      .map((novel) => ({
        title: novel.title,
        count: Object.keys(novel.chapters || {}).length,
        updatedAt: novel.updatedAt || ""
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  };
}

async function clearNovel(novelTitle) {
  const data = await chrome.storage.local.get("novels");
  const novels = data.novels || {};
  delete novels[slug(novelTitle)];
  await chrome.storage.local.set({ novels });
  await chrome.action.setBadgeText({ text: "" });
}

async function status() {
  const job = await getJob();
  const stored = await chrome.storage.session.get(["statusText", "pagePreview"]);
  return {
    running: Boolean(job),
    left: job?.left ?? 0,
    novelTitle: job?.novelTitle || "",
    text: stored.statusText || "",
    page: stored.pagePreview || null
  };
}

async function getJob() {
  const stored = await chrome.storage.session.get("job");
  return stored.job || null;
}

async function setStatus(text) {
  await chrome.storage.session.set({ statusText: text });
}

async function failJob(err) {
  await chrome.storage.session.remove("job");
  await setStatus(err.message || String(err));
}

async function toast(tabId, text) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "toast", text });
  } catch (_err) {
    // The popup can still show the status if the page is mid-navigation.
  }
}

function slug(title) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "novel";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pageUnloaded(err) {
  const text = String(err?.message || err);
  return /message channel closed|Receiving end does not exist|disconnected|back\/forward cache|tab was closed/i.test(text);
}

function normalize(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch (_err) {
    return url;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
