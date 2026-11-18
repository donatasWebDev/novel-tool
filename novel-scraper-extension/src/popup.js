const novelInput = document.querySelector("#novel");
const saved = document.querySelector("#saved");
const pageMeta = document.querySelector("#page-meta");
const pageTitle = document.querySelector("#page-title");
const snippet = document.querySelector("#snippet");
const chapterNoInput = document.querySelector("#chapter-no");
const status = document.querySelector("#status");

let tabId = null;
let chapter = null;

document.querySelector("#save").addEventListener("click", saveCurrent);
document.querySelector("#start").addEventListener("click", startCollect);
document.querySelector("#stop").addEventListener("click", () => send({ type: "stop" }));
document.querySelector("#export").addEventListener("click", exportJson);
document.querySelector("#clear").addEventListener("click", clearNovel);
novelInput.addEventListener("change", () => refreshSaved());
document.querySelector("#delay").addEventListener("change", saveDelay);

init();

async function init() {
  const prefs = await chrome.storage.local.get("nextDelaySec");
  if (typeof prefs.nextDelaySec === "number") {
    document.querySelector("#delay").value = String(prefs.nextDelaySec);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  if (!tabId || !/^https?:/i.test(tab.url || "")) {
    setStatus("Open a chapter page first.", true);
    return;
  }
  await refreshPage();
  watchPage();

  const listed = await send({ type: "list" });
  if (listed?.ok && !novelInput.value) {
    novelInput.value = listed.novels.activeNovel || chapter?.novelGuess || "";
  }
  await refreshSaved();
  await refreshJob();
}

async function saveCurrent() {
  await refreshPage();
  if (!chapter || (chapter.text || "").length < 100) {
    setStatus("Text is under 100 characters.", true);
    return;
  }
  const novelTitle = novelInput.value.trim() || chapter.novelGuess;
  novelInput.value = novelTitle;
  const res = await send({
    type: "save",
    novelTitle,
    chapter,
    chapterNo: chapterNoInput.value
  });
  if (!res?.ok) {
    setStatus(res?.error || "Save failed.", true);
    return;
  }
  saved.textContent = `${res.count} chapter${res.count === 1 ? "" : "s"} saved.`;
  setStatus(`Saved chapter ${res.chapter.chapterNo}.`);
}

async function startCollect() {
  const novelTitle = novelInput.value.trim() || chapter?.novelGuess || "";
  novelInput.value = novelTitle;
  const delaySec = Number(document.querySelector("#delay").value);
  saveDelay();
  pollJob();
  const res = await send({
    type: "start",
    tabId,
    novelTitle,
    count: Number(document.querySelector("#count").value),
    chapterNo: chapterNoInput.value,
    delaySec
  });
  if (!res?.ok) {
    clearInterval(pollJob.timer);
    setStatus(res?.error || "Could not start.", true);
    return;
  }
  setStatus("Collecting. You can close this popup.");
  pollJob();
}

async function exportJson() {
  const novelTitle = novelInput.value.trim();
  if (!novelTitle) {
    setStatus("Name the novel first.", true);
    return;
  }
  const res = await send({ type: "get-novel", novelTitle });
  const novel = res?.novel;
  const records = Object.values(novel?.chapters || {});
  if (!records.length) {
    setStatus("Nothing saved for that novel.", true);
    return;
  }
  const chapters = records
    .sort((a, b) => a.chapterNo - b.chapterNo || a.url.localeCompare(b.url))
    .map((ch, index) => ({
      index: index + 1,
      chapterNo: ch.chapterNo,
      chapterId: ch.chapterId,
      title: ch.title,
      wordCount: ch.wordCount,
      url: ch.url,
      text: ch.text
    }));
  const payload = {
    exportedAt: new Date().toISOString(),
    count: chapters.length,
    chapters
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filename = `${slug(novelTitle)}.json`;
  await chrome.downloads.download({ url, filename, saveAs: true });
  setStatus(`Export ready: ${chapters.length} chapters.`);
}

async function clearNovel() {
  const novelTitle = novelInput.value.trim();
  if (!novelTitle) return;
  if (!confirm(`Delete saved chapters for “${novelTitle}”?`)) return;
  await send({ type: "clear", novelTitle });
  await refreshSaved();
  setStatus("Cleared.");
}

async function refreshSaved() {
  const novelTitle = novelInput.value.trim();
  if (!novelTitle) {
    saved.textContent = "Name the novel to see its saved chapters.";
    return;
  }
  const res = await send({ type: "get-novel", novelTitle });
  const count = Object.keys(res?.novel?.chapters || {}).length;
  saved.textContent = count
    ? `${count} chapter${count === 1 ? "" : "s"} saved for this novel.`
    : "No chapters saved for this novel yet.";
}

async function refreshPage() {
  if (!tabId) return;
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "scan" });
    if (!res?.ok || !res.chapter) throw new Error(res?.error || "Could not read this page.");
    showPage(res.chapter);
  } catch (err) {
    if (!chapter) setStatus(err.message || "Reload the page, then open the extension again.", true);
  }
}

function watchPage() {
  clearInterval(watchPage.timer);
  watchPage.timer = setInterval(refreshPage, 1000);
}

function showPage(ch) {
  chapter = ch;
  pageTitle.textContent = ch.title || "";
  pageMeta.textContent = pageLine(ch);
  pageMeta.classList.toggle("waiting", !pageReady(ch));
  snippet.textContent = (ch.text || "").slice(0, 280);
  if (ch.chapterNo != null && document.activeElement !== chapterNoInput) {
    chapterNoInput.value = String(ch.chapterNo);
  }
}

async function refreshJob() {
  const res = await send({ type: "status" });
  if (res?.text) setStatus(res.text, !res.running && /not ready|could not|same opening|was not clicked/i.test(res.text));
  if (res?.running) pollJob();
}

function pollJob() {
  clearInterval(pollJob.timer);
  pollJob.timer = setInterval(async () => {
    const res = await send({ type: "status" });
    if (res?.text) setStatus(res.text, !res.running && /not ready|could not|same opening|was not clicked/i.test(res.text));
    await refreshSaved();
    if (!res?.running) clearInterval(pollJob.timer);
  }, 1000);
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function saveDelay() {
  const delaySec = Number(document.querySelector("#delay").value);
  if (Number.isFinite(delaySec)) chrome.storage.local.set({ nextDelaySec: delaySec });
}

function pageLine(ch) {
  const number = ch.chapterNo == null ? "Chapter not detected" : `Chapter ${ch.chapterNo}`;
  const words = `${(ch.wordCount || 0).toLocaleString()} words`;
  const next = ch.hasNext ? "Next button found." : "No Next button.";
  const chars = `${(ch.text || "").length.toLocaleString()} chars`;
  return `${number} · ${words}. ${next} ${chars}.`;
}

function pageReady(ch) {
  return Boolean(ch) && ch.chapterNo != null && ch.wordCount > 0 && ch.hasNext && (ch.text || "").length >= 100;
}

function setStatus(text, isError) {
  status.textContent = text;
  status.classList.toggle("error", Boolean(isError));
}

function slug(title) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "novel";
}
