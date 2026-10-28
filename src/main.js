import { analyzeOverview, analyzeLines, describeError, isFatal } from "./claude.js";
import { EXAMPLES } from "./examples.js";
import { crossCheck } from "./stresscheck.js";
import { stripSectionLabels } from "./lyrics.js";
import { lyricsKey, getSong, putSong, deleteSong, listSongs, requestPersist, migrateFromLocalStorage } from "./db.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- State ----------
let langChoice = "auto";
let current = null;      // { lang, title, artist, raw[], lines{uniqueIdx: data}, overview, example? }
let ctrl = null, stopped = false;
let wordbook = store.get("ln.wordbook", []);
let history = [];  // saved analyses, loaded from IndexedDB
let settings = { apiKey: "", model: "claude-opus-5-5", stressCheck: true, ...store.get("ln.settings", {}) };

// ---------- Helpers ----------
function detectLang(txt) {
  const ja = (txt.match(/[぀-ヿ一-鿿]/g) || []).length;
  const ru = (txt.match(/[Ѐ-ӿ]/g) || []).length;
  if (!ja && !ru) return null;
  return ja >= ru ? "ja" : "ru";
}
// Colors the vowel carrying each U+0301 stress mark.
function stressNodes(str) {
  const frag = document.createDocumentFragment();
  const re = /([аеёиоуыэюяАЕЁИОУЫЭЮЯ])́/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) frag.append(str.slice(last, m.index));
    frag.append(el("span", "st", m[0]));
    last = re.lastIndex;
  }
  if (last < str.length) frag.append(str.slice(last));
  return frag;
}
// Stressed line, with words where the cross-check disagrees underlined.
function stressedLineNodes(str, diffs) {
  if (!diffs?.length) return stressNodes(str);
  const flagged = new Set(diffs.map((d) => d.index));
  const frag = document.createDocumentFragment();
  let i = 0;
  for (const part of str.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { frag.append(part); continue; }
    if (flagged.has(i)) { const s = el("span", "disagree"); s.append(stressNodes(part)); frag.append(s); }
    else frag.append(stressNodes(part));
    i++;
  }
  return frag;
}
function rubyNodes(segs, fallback) {
  const frag = document.createDocumentFragment();
  if (!Array.isArray(segs) || !segs.length) { frag.append(fallback); return frag; }
  for (const s of segs) {
    const t = String(s?.t ?? ""), r = String(s?.r ?? "");
    if (r && r !== t) { const rb = el("ruby"); rb.append(t, el("rt", null, r)); frag.append(rb); }
    else frag.append(t);
  }
  return frag;
}
const keyOf = (w, lang) => lang + "|" + (w.lemma || w.word || "").replace(/́/g, "");
function uniqueLines(raw) {
  const map = new Map(), uniq = [], idx = [];
  raw.forEach((line) => {
    const t = line.trim();
    if (!t) { idx.push(null); return; }
    if (!map.has(t)) { map.set(t, uniq.length); uniq.push(t); }
    idx.push(map.get(t));
  });
  return { uniq, idx };
}

// ---------- Rendering ----------
function render() {
  const sheet = $("#sheet");
  sheet.replaceChildren();
  if (!current) return;
  const { lang } = current;

  const head = el("div", "song-head");
  const hl = el("div");
  hl.append(el("p", "song-title", current.title || "제목 없음"));
  hl.append(el("div", "song-meta", [current.artist, lang === "ru" ? "러시아어" : "일본어"].filter(Boolean).join(" · ")));
  head.append(hl);
  if (current.example) head.append(el("span", "example-flag", "예시 · 데모용으로 직접 쓴 문장입니다"));
  sheet.append(head);


  const { idx, uniq } = uniqueLines(current.raw);
  const lines = el("section", "lines");
  const seen = new Set();
  let n = 0;
  idx.forEach((u, i) => {
    if (u === null) { if (i > 0 && idx[i - 1] !== null) lines.append(el("div", "stanza-gap")); return; }
    n++;
    const d = current.lines[u];
    const row = el("article", "ln");
    row.append(el("div", "ln-no", String(n).padStart(2, "0")));
    const body = el("div", "ln-body");
    const orig = el("div", "orig " + lang);
    if (d && lang === "ru" && d.stressed) orig.append(stressedLineNodes(d.stressed, d.check?.diffs));
    else if (d && lang === "ja") orig.append(rubyNodes(d.ruby, uniq[u]));
    else orig.append(uniq[u]);
    body.append(orig);
    if (!d) body.append(el("div", "pending", current.lineErrors?.[u] || "분석 대기 중…"));
    else {
      if (d.roman) body.append(el("div", "roman", d.roman));
      body.append(el("div", "trans", d.translation || ""));
      const repeat = seen.has(u); seen.add(u);
      const detail = el("div", "detail");
      detail.hidden = repeat;
      if (repeat) {
        const t = el("button", "ln-toggle", "반복되는 줄 · 설명 보기");
        t.type = "button";
        t.onclick = () => { detail.hidden = !detail.hidden; t.textContent = detail.hidden ? "반복되는 줄 · 설명 보기" : "설명 접기"; };
        body.append(t);
      }
      if (d.words?.length) {
        const ws = el("div", "words");
        d.words.forEach((w) => ws.append(wordCard(w, lang)));
        detail.append(ws);
      }
      (d.grammar || []).forEach((g) => {
        const gb = el("div", "gram " + lang);
        const b = el("b"), q = el("p");
        b.append(lang === "ru" ? stressNodes(g.point || "") : (g.point || ""));
        q.append(lang === "ru" ? stressNodes(g.explain || "") : (g.explain || ""));
        gb.append(b, q); detail.append(gb);
      });
      if (d.check?.diffs?.length) {
        // Shown even on collapsed repeat lines: a disputed stress matters every time.
        const box = el("div", "unsure");
        box.append(el("b", null, "강세 확인 필요 "), "Claude와 사전 모델의 강세가 다릅니다. 사전에서 확인하세요.");
        const ul = el("ul", "check-list");
        d.check.diffs.forEach((x) => {
          const c = el("span", "w ru"); c.append(stressNodes(x.claude));
          const m = el("span", "w ru"); m.append(stressNodes(x.tool));
          const li = el("li"); li.append("Claude ", c, " · 모델 ", m);
          ul.append(li);
        });
        box.append(ul);
        body.append(box);
      }
      if (d.unsure?.length) detail.append(el("div", "unsure", "확인 필요: " + d.unsure.join(" / ")));
      body.append(detail);
    }
    row.append(body);
    lines.append(row);
  });
  sheet.append(lines);
  // Overview sits below the lines, collapsed unless the reader opens it.
  const ov = el("details", "overview");
  ov.open = !!current.overviewOpen;
  ov.addEventListener("toggle", () => { if (current) current.overviewOpen = ov.open; });
  const sum = el("summary");
  sum.append(el("span", "label", "전체 개요"));
  if (!current.overview) sum.append(el("span", "pending", current.overviewError ? " · 실패" : " · 작성 중…"));
  ov.append(sum);
  const mix = (t) => (lang === "ru" ? stressNodes(String(t)) : String(t));
  if (current.overview) {
    const p = el("p"); p.append(mix(current.overview.summary || "")); ov.append(p);
    if (current.overview.level) ov.append(el("p", "hint", "난이도 추정: " + current.overview.level));
    if (current.overview.tips?.length) {
      const ul = el("ul"); current.overview.tips.forEach((t) => { const li = el("li"); li.append(mix(t)); ul.append(li); }); ov.append(ul);
    }
  } else ov.append(el("p", "pending", current.overviewError || "개요를 작성하는 중…"));
  sheet.append(ov);
}

function wordCard(w, lang) {
  const c = el("div", "word");
  const head = el("span", "w " + lang);
  if (lang === "ru") head.append(stressNodes(w.word || "")); else head.append(w.word || "");
  c.append(head);
  const sub = [lang === "ru" ? (w.lemma && w.lemma !== w.word ? "기본형 " + w.lemma : "") : (w.reading || ""), w.pos].filter(Boolean).join(" · ");
  if (sub) { const s = el("span", "sub"); s.append(lang === "ru" ? stressNodes(sub) : sub); c.append(s); }
  c.append(el("span", "mean", w.meaning || ""));
  if (w.note) { const n = el("span", "note"); n.append(lang === "ru" ? stressNodes(w.note) : w.note); c.append(n); }
  const k = keyOf(w, lang);
  const b = el("button", "save"); b.type = "button";
  const sync = () => { const on = wordbook.some((x) => x.k === k); b.setAttribute("aria-pressed", on); b.textContent = on ? "★ 단어장에 있음" : "☆ 단어장에 추가"; };
  sync();
  b.onclick = () => {
    const i = wordbook.findIndex((x) => x.k === k);
    if (i >= 0) wordbook.splice(i, 1);
    else wordbook.unshift({ k, lang, word: w.lemma || w.word, reading: w.reading || "", meaning: w.meaning || "", song: current?.example ? "" : (current?.title || "") });
    store.set("ln.wordbook", wordbook); sync(); renderWordbook();
  };
  c.append(b);
  return c;
}

function renderWordbook() {
  const ul = $("#wb"); ul.replaceChildren();
  if (!wordbook.length) { ul.append(el("li", "empty", "단어 카드의 ☆를 누르면 여기에 모입니다.")); return; }
  wordbook.forEach((w, i) => {
    const li = el("li");
    const t = el("div");
    const ww = el("strong", "w " + w.lang);
    ww.append(w.lang === "ru" ? stressNodes(w.word) : w.word);
    t.append(ww);
    if (w.reading) t.append(" (" + w.reading + ")");
    t.append(" — " + w.meaning);
    if (w.song) t.append(" ", el("small", null, "· " + w.song));
    const x = el("button", "x", "×"); x.type = "button"; x.setAttribute("aria-label", "단어 삭제");
    x.onclick = () => { wordbook.splice(i, 1); store.set("ln.wordbook", wordbook); renderWordbook(); render(); };
    li.append(t, x); ul.append(li);
  });
}

function openSaved(h) {
  current = clone(h); fillForm(current); render(); hideDup();
  setStatus("저장된 해설을 불러왔습니다. API는 호출하지 않았습니다.");
  window.scrollTo({ top: $("#sheet").offsetTop - 12 });
}
async function renderHistory() {
  const ul = $("#hist");
  try { history = await listSongs(); } catch { history = []; }
  ul.replaceChildren();
  $("#histCount").textContent = history.length ? `${history.length}곡` : "";
  if (!history.length) { ul.append(el("li", "empty", "분석한 노래가 여기에 저장됩니다 (이 기기에만).")); return; }
  history.forEach((h) => {
    const li = el("li"); const b = el("button", "open"); b.type = "button";
    b.append(h.title || "제목 없음", " ", el("small", null, (h.artist ? h.artist + " · " : "") + (h.lang === "ru" ? "RU" : "JA")));
    b.onclick = () => openSaved(h);
    const x = el("button", "x", "×"); x.type = "button"; x.setAttribute("aria-label", `${h.title || "제목 없음"} 해설 삭제`);
    // Two-tap delete: first tap arms, second tap deletes (no confirm() in a PWA we can rely on).
    x.onclick = async () => {
      if (x.dataset.armed !== "1") { x.dataset.armed = "1"; x.textContent = "삭제?"; return; }
      try { await deleteSong(h.key); setStatus(`‘${h.title || "제목 없음"}’ 해설을 삭제했습니다.`); }
      catch { setStatus("삭제하지 못했습니다.", true); }
      renderHistory();
    };
    li.append(b, x); ul.append(li);
  });
}
async function saveHistory(song) {
  if (!song || song.example) return;
  const entry = clone(song);
  delete entry.lineErrors; delete entry.overviewError; delete entry.overviewOpen;
  entry.savedAt = Date.now();
  try { await putSong(entry); }
  catch { setStatus("해설을 이 기기에 저장하지 못했습니다. 저장 공간을 확인해 주세요.", true); return; }
  renderHistory();
}
function showDup(saved, rerun) {
  const box = $("#dupNotice");
  $("#dupText").textContent = `이 가사는 이미 분석해서 저장해 둔 해설이 있습니다${saved.title ? ` (‘${saved.title}’)` : ""}. 다시 분석하면 API 비용이 다시 듭니다.`;
  $("#dupOpen").onclick = () => openSaved(saved);
  $("#dupRerun").onclick = () => { hideDup(); rerun(); };
  box.hidden = false;
}
function hideDup() { $("#dupNotice").hidden = true; }
function fillForm(c) {
  $("#title").value = c.example ? "" : (c.title || "");
  $("#artist").value = c.example ? "" : (c.artist || "");
  $("#lyrics").value = c.example ? "" : c.raw.join("\n");
  updateSearch();
}
function setLang(l) { langChoice = l; document.querySelectorAll("#langSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === l)); }
function setStatus(t, err) { const s = $("#status"); s.textContent = t; s.classList.toggle("err", !!err); }
function setBar(p) { $("#bar").style.width = Math.round(p * 100) + "%"; }
function updateSearch() {
  const q = [$("#title").value, $("#artist").value].filter(Boolean).join(" ");
  $("#searchLink").href = "https://www.google.com/search?q=" + encodeURIComponent(q + " 가사 lyrics");
}

// ---------- Analyze ----------
async function analyze({ force = false } = {}) {
  hideDup();
  const { lines: raw, removed } = stripSectionLabels($("#lyrics").value.replace(/\r/g, "").split("\n"));
  if (removed.length) $("#lyrics").value = raw.join("\n");
  const labelNote = removed.length ? ` 구간 표시 ${removed.length}줄(${removed.slice(0, 3).join(", ")}${removed.length > 3 ? " …" : ""})은 뺐습니다.` : "";
  const text = raw.join("\n").trim();
  if (!text) { setStatus("가사를 붙여넣어 주세요. 제목만으로는 분석할 수 없어요.", true); $("#lyrics").focus(); return; }
  const lang = langChoice === "auto" ? detectLang(text) : langChoice;
  if (!lang) { setStatus("일본어나 러시아어 문자를 찾지 못했습니다. 언어를 직접 선택해 주세요.", true); return; }
  let key = null;
  try { key = await lyricsKey(lang, raw); } catch {}
  if (key && !force) {
    let saved = null;
    try { saved = await getSong(key); } catch {}
    if (saved) { showDup(saved, () => analyze({ force: true })); return; }
  }
  if (!settings.apiKey) { setStatus("먼저 설정에서 Anthropic API 키를 입력해 주세요.", true); openSettings(); return; }

  while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
  current = { key, lang, title: $("#title").value.trim(), artist: $("#artist").value.trim(), raw, lines: {}, overview: null, lineErrors: {} };
  const song = current;
  render();
  window.scrollTo({ top: $("#sheet").offsetTop - 12, behavior: "smooth" });

  const { uniq } = uniqueLines(raw);
  const BATCH = 8;
  const batches = [];
  for (let i = 0; i < uniq.length; i += BATCH) batches.push(uniq.slice(i, i + BATCH).map((t, j) => ({ id: i + j, text: t })));

  stopped = false;
  ctrl = new AbortController();
  const opts = { apiKey: settings.apiKey, model: settings.model, signal: ctrl.signal };
  $("#go").disabled = true; $("#stop").hidden = false;
  setStatus("Claude가 읽는 중… (한 묶음에 수십 초 걸릴 수 있어요)"); setBar(0.03);

  const ovP = analyzeOverview(opts, song)
    .then((o) => { song.overview = o; })
    .catch((e) => { const m = describeError(e); if (m) song.overviewError = "개요를 만들지 못했습니다: " + m; })
    .finally(() => { if (current === song) render(); });

  const covered = [];
  let done = 0, failed = false, checkFailed = false, checkNoted = false;
  for (const batch of batches) {
    if (stopped) break;
    setStatus(`줄별 분석 중… ${Math.min(done + batch.length, uniq.length)}/${uniq.length}줄`);
    try {
      const lines = await analyzeLines(opts, song, batch, covered);
      for (const d of lines) {
        if (!batch.some((b) => b.id === d.id)) continue;
        song.lines[d.id] = d;
        d.words.forEach((w) => covered.push((w.lemma || w.word).replace(/́/g, "")));
      }
      batch.forEach((b) => { if (!song.lines[b.id]) song.lineErrors[b.id] = "이 줄은 결과가 비어 있습니다."; });
      if (lang === "ru" && settings.stressCheck && !checkFailed) {
        if (!checkNoted) { setStatus("강세 확인 모델을 불러오는 중… (처음 한 번 약 20MB)"); checkNoted = true; }
        try {
          for (const b of batch) {
            const d = song.lines[b.id];
            if (d?.stressed) d.check = await crossCheck(b.text, d.stressed);
          }
        } catch {
          checkFailed = true; // keep the Claude results; just skip the cross-check
        }
      }
    } catch (e) {
      const m = describeError(e);
      if (m === null) break; // cancelled
      failed = true;
      batch.forEach((b) => { song.lineErrors[b.id] = "분석 실패: " + m; });
      setStatus(m, true);
      if (isFatal(e)) break;
    }
    done += batch.length;
    setBar(done / uniq.length);
    if (current === song) render();
  }
  await ovP;
  $("#go").disabled = false; $("#stop").hidden = true; ctrl = null;
  const ok = Object.keys(song.lines).length;
  if (stopped) setStatus(`멈췄습니다. ${ok}/${uniq.length}줄 분석됨.`);
  else if (!failed) {
    const n = Object.values(song.lines).reduce((s, d) => s + (d.check?.diffs?.length || 0), 0);
    const check = lang !== "ru" || !settings.stressCheck ? ""
      : checkFailed ? " 강세 확인 모델을 불러오지 못해 교차 확인은 건너뛰었습니다."
      : n ? ` 강세가 엇갈린 단어 ${n}개에 밑줄을 쳤습니다.` : " 강세 교차 확인에서 엇갈린 단어는 없었습니다.";
    setStatus(`완료 · ${uniq.length}줄 분석.${labelNote}${check} 강세·읽기는 사전으로 한 번 더 확인하세요.`);
  }
  if (ok && song.key) saveHistory(song);
}

// ---------- Settings ----------
const dlg = $("#settings");
function openSettings() {
  $("#apiKey").value = settings.apiKey;
  $("#model").value = settings.model;
  $("#stressCheck").checked = settings.stressCheck;
  dlg.showModal();
}
$("#settingsForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  settings = { apiKey: $("#apiKey").value.trim(), model: $("#model").value, stressCheck: $("#stressCheck").checked };
  store.set("ln.settings", settings);
  setStatus(settings.apiKey ? "설정을 저장했습니다." : "API 키가 비어 있습니다.", !settings.apiKey);
});
$("#clearKey").onclick = () => {
  settings = { ...settings, apiKey: "" };
  store.set("ln.settings", settings);
  $("#apiKey").value = "";
  setStatus("API 키를 이 기기에서 삭제했습니다.");
};
$("#openSettings").onclick = openSettings;

// ---------- Wire up ----------
document.querySelectorAll("#langSeg button").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
$("#go").onclick = () => analyze();
$("#stop").onclick = () => { stopped = true; ctrl?.abort(); };
const showExample = (k) => { current = clone(EXAMPLES[k]); render(); setStatus("예시를 보는 중입니다. 실제 가사를 붙여넣고 ‘분석하기’를 누르세요."); };
$("#exRu").onclick = () => showExample("ru");
$("#exJa").onclick = () => showExample("ja");
$("#title").addEventListener("input", updateSearch);
$("#artist").addEventListener("input", updateSearch);
$("#copyWb").onclick = async () => {
  const txt = wordbook.map((w) => `${w.word}${w.reading ? " (" + w.reading + ")" : ""}\t${w.meaning}${w.song ? "\t" + w.song : ""}`).join("\n");
  if (!txt) { setStatus("단어장이 비어 있습니다."); return; }
  try { await navigator.clipboard.writeText(txt); setStatus("단어장을 복사했습니다."); }
  catch { setStatus("복사가 막혀 있습니다. 단어장 목록을 직접 선택해 복사해 주세요.", true); }
};

current = clone(EXAMPLES.ru);
render(); renderWordbook(); updateSearch();
migrateFromLocalStorage().catch(() => {}).finally(renderHistory);
requestPersist();
setStatus(settings.apiKey ? "러시아어 예시입니다. 가사를 붙여넣고 ‘분석하기’를 누르세요." : "처음이라면 오른쪽 위 ‘설정 · API 키’에서 키를 입력하세요.");

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
