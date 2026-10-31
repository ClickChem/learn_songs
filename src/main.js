import { analyzeOverview, analyzeLines, describeError, isFatal } from "./claude.js";
import { EXAMPLES, BIBLE_EXAMPLES } from "./examples.js";
import { parseVerses } from "./bible.js";
import { crossCheck } from "./stresscheck.js";
import { stripSectionLabels, stripJunk } from "./lyrics.js";
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
let mode = store.get("ln.mode", "song") === "bible" ? "bible" : "song";   // which tab is open
const lastView = { song: null, bible: null };                              // what each tab last showed

// Words that differ between the song tab and the Bible tab.
const MODES = {
  song: {
    titleLabel: "노래 제목", artistLabel: "가수", textLabel: "가사 붙여넣기",
    placeholder: "가사를 한 줄씩 붙여넣으세요. 빈 줄은 절 구분으로 유지됩니다.",
    noTitle: "제목 없음", noArtist: "가수 미상", guess: "제목·가수는 Claude 추정 (눌러서 수정)",
    empty: "가사를 붙여넣어 주세요. 제목만으로는 분석할 수 없어요.", dupWhat: "이 가사는",
    listEmpty: "분석한 노래가 여기에 저장됩니다 (이 기기에만).", unit: "곡", unitLine: "줄",
    exampleFlag: "예시 · 데모용으로 직접 쓴 문장입니다", examples: EXAMPLES,
  },
  bible: {
    titleLabel: "장·절 (예: 요한복음 3:16)", artistLabel: "번역본 (비우면 JCB / НРП)", textLabel: "성경 구절 붙여넣기",
    placeholder: "구절을 붙여넣으세요. 한 줄에 한 절씩, 앞의 절 번호는 그대로 둬도 됩니다.",
    noTitle: "출처 미상", noArtist: "번역본 미상", guess: "장·절·번역본은 Claude 추정 (눌러서 수정)",
    empty: "성경 구절을 붙여넣어 주세요. 장·절만으로는 분석할 수 없어요.", dupWhat: "이 구절은",
    listEmpty: "분석한 구절이 여기에 저장됩니다 (이 기기에만).", unit: "개", unitLine: "문장",
    exampleFlag: "예시 · JCB·НРП는 저작권이 있어 저작권이 끝난 번역본(시노달역·문어역)으로 보여 줍니다. 본문은 기억으로 옮긴 것이니 인쇄본과 대조하세요",
    examples: BIBLE_EXAMPLES,
  },
};
const M = (kind) => MODES[kind === "bible" ? "bible" : "song"];

// ---------- Helpers ----------
// Positions of lines Claude flagged as not part of the text that sit in the header block of the
// paste (before the first real line). A flagged line anywhere else is shown anyway: it is most
// likely sung (songs repeat and end on their title), and dropping real lyrics is worse than keeping
// a stray line. Trailing site furniture is already removed by stripJunk before analysis.
function edgeHidden(idx, lines) {
  const hidden = new Set();
  const flagged = (u) => u === null || !!lines[u]?.not_text;
  for (let i = 0; i < idx.length && flagged(idx[i]); i++) if (idx[i] !== null) hidden.add(i);
  return hidden;
}

const LANG_KO = { ja: "일본어", ru: "러시아어", zh: "중국어", es: "스페인어", fr: "프랑스어" };
const RUBY_LANGS = new Set(["ja", "zh"]);       // line shown with ruby (furigana / pinyin)

// Guess the language from the script, and for Latin text from telltale letters and common words.
function detectLang(txt) {
  const count = (re) => (txt.match(re) || []).length;
  const kana = count(/[\u3040-\u30ff]/g), han = count(/[\u4e00-\u9fff]/g), cyr = count(/[\u0400-\u04ff]/g);
  const latin = count(/[A-Za-zÀ-ÿœŒ]/g);
  const top = Math.max(kana + han, cyr, latin);
  if (!top) return null;
  if (top === cyr) return "ru";
  if (top === kana + han) return kana >= 2 || kana > han * 0.05 ? "ja" : "zh";
  const words = txt.toLowerCase().match(/[a-zà-ÿœ']+/g) || [];
  const ES = new Set("el los las que y de en es por con para una mi tu yo no me te se lo del al como pero más muy está estoy eres soy".split(" "));
  const FR = new Set("le les et je tu il elle est pas une des du au aux qui dans mon ton ma ce cette avec pour sur ne nous vous suis es c'est j'ai".split(" "));
  let es = count(/[ñ¿¡áíóú]/gi) * 3, fr = count(/[çœàèùêâîôûëï]/gi) * 3;
  for (const w of words) { if (ES.has(w)) es++; if (FR.has(w)) fr++; }
  if (!es && !fr) return null;
  return es >= fr ? "es" : "fr";
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
// Dictionary word + its hiragana reading -> ruby over the kanji part only
// ("待つ"/"まつ" -> 待[ま]つ). Kana shared at either end is left unannotated.
function wordRuby(word, reading) {
  const frag = document.createDocumentFragment();
  if (!reading || !/[\u4e00-\u9fff々]/.test(word)) { frag.append(word); return frag; }
  const toHira = (c) => c.replace(/[\u30a1-\u30f6]/g, (x) => String.fromCharCode(x.charCodeAt(0) - 0x60));
  let a = 0, b = 0;
  while (a < word.length && a < reading.length && !/[\u4e00-\u9fff々]/.test(word[a]) && toHira(word[a]) === reading[a]) a++;
  while (b < word.length - a && b < reading.length - a && !/[\u4e00-\u9fff々]/.test(word[word.length - 1 - b]) && toHira(word[word.length - 1 - b]) === reading[reading.length - 1 - b]) b++;
  const core = word.slice(a, word.length - b), rcore = reading.slice(a, reading.length - b);
  frag.append(word.slice(0, a));
  if (core && rcore) { const rb = el("ruby"); rb.append(core, el("rt", null, rcore)); frag.append(rb); }
  else frag.append(core);
  frag.append(word.slice(word.length - b));
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
// Lines that differ only in case, punctuation or spacing count as the same line,
// so a chorus pasted with a stray comma is still analyzed (and explained) once.
const lineKey = (t) => t.toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim() || t;
function uniqueLines(raw) {
  const map = new Map(), uniq = [], idx = [];
  raw.forEach((line) => {
    const t = line.trim();
    if (!t) { idx.push(null); return; }
    const k = lineKey(t);
    if (!map.has(k)) { map.set(k, uniq.length); uniq.push(t); }
    idx.push(map.get(k));
  });
  return { uniq, idx };
}

// One lyric line. A line already explained earlier shows only text and translation.
function lineRow(u, label, uniq, lang, seenAt) {
  const d = current.lines[u];
  const row = el("article", "ln");
  row.append(el("div", "ln-no", label));
  const body = el("div", "ln-body");
  const orig = el("div", "orig " + lang);
  if (d && lang === "ru" && d.stressed) orig.append(stressedLineNodes(d.stressed, seenAt == null ? d.check?.diffs : null));
  else if (d && RUBY_LANGS.has(lang)) orig.append(rubyNodes(d.ruby, uniq[u]));
  else orig.append(uniq[u]);
  body.append(orig);
  row.append(body);
  if (!d) { body.append(el("div", "pending", current.lineErrors?.[u] || "분석 대기 중…")); return row; }
  body.append(el("div", "trans", d.translation || ""));
  if (seenAt != null) {
    body.append(el("div", "repeat-tag", current.kind === "bible" ? `앞(${seenAt || "위"})에 나온 문장과 같음 · 해설은 그곳에` : `${seenAt}행과 같은 줄 · 해설은 ${seenAt}행에`));
    return row;
  }

  const detail = el("div", "detail");
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
    detail.append(box);
  }
  if (d.unsure?.length) detail.append(el("div", "unsure", "확인 필요: " + d.unsure.join(" / ")));
  if (detail.childElementCount) body.append(detail);
  return row;
}

// A whole stanza identical to an earlier one (usually the chorus): one folded line.
function repeatedStanza(st, [from, to], uniq, lang) {
  const box = el("details", "repeat-stanza");
  const sum = el("summary");
  sum.append(`후렴 반복 · ${from}–${to}행과 같음 (${st.length}줄)`);
  box.append(sum);
  st.forEach(({ u, n }) => {
    const d = current.lines[u];
    const row = el("div", "rep-line");
    row.append(el("span", "ln-no", String(n).padStart(2, "0")));
    const t = el("div");
    const o = el("div", "orig small " + lang);
    if (d && lang === "ru" && d.stressed) o.append(stressNodes(d.stressed));
    else if (d && RUBY_LANGS.has(lang)) o.append(rubyNodes(d.ruby, uniq[u]));
    else o.append(uniq[u]);
    t.append(o);
    if (d?.translation) t.append(el("div", "trans", d.translation));
    row.append(t);
    box.append(row);
  });
  return box;
}

// ---------- Rendering ----------
function render() {
  const sheet = $("#sheet");
  sheet.replaceChildren();
  if (!current) return;
  const { lang } = current;

  const head = el("div", "song-head");
  const hl = el("div");
  const T = M(current.kind);
  const title = el("p", "song-title", current.title || T.noTitle);
  const artist = el("span", "song-artist", current.artist || (current.example ? "" : T.noArtist));
  if (!current.example) {
    for (const [node, field, empty] of [[title, "title", T.noTitle], [artist, "artist", T.noArtist]]) {
      node.contentEditable = "plaintext-only";
      node.spellcheck = false;
      node.title = "눌러서 고칠 수 있어요";
      node.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); node.blur(); } });
      node.addEventListener("blur", () => {
        const v = node.textContent.trim();
        if (!v) { node.textContent = empty; }
        if ((current[field] || "") === (v === empty ? "" : v)) return;
        current[field] = v === empty ? "" : v;
        current.titleGuessed = false;
        if (current.key && Object.keys(current.lines).length) saveHistory(current);
        render();
      });
    }
  }
  const meta = el("div", "song-meta");
  meta.append(artist, " · " + LANG_KO[lang]);
  if (current.titleGuessed) meta.append(el("span", "guess", " · " + T.guess));
  hl.append(title, meta);
  head.append(hl);
  if (current.example) head.append(el("span", "example-flag", T.exampleFlag));
  const left = !current.example && current.key && !ctrl ? missingIds(current).length : 0;
  if (left) {
    const btn = el("button", "btn primary small", `남은 ${left}${T.unitLine} 이어서 분석`);
    btn.type = "button";
    const song = current;
    btn.onclick = () => resumeAnalysis(song);
    head.append(btn);
  }
  sheet.append(head);


  const { idx, uniq } = uniqueLines(current.raw);
  const hiddenAt = edgeHidden(idx, current.lines);
  const lines = el("section", "lines");

  // Group lines into stanzas (split at blank lines) and number them.
  const stanzas = [];
  let cur = null, n = 0;
  idx.forEach((u, i) => {
    if (u === null) { cur = null; return; }
    if (hiddenAt.has(i)) return;   // Claude marked it as not part of the text, at the edge of the paste
    if (!cur) stanzas.push(cur = []);
    n++;
    // Bible: show the verse number pulled from the text (blank for a verse's later sentences)
    const label = current.kind === "bible" ? (current.nums?.[i] ?? "") : String(n).padStart(2, "0");
    cur.push({ u, n, label });
  });

  const firstNo = new Map();       // unique line -> number where it first appears
  const firstStanza = new Map();   // stanza signature -> [first, last] line numbers
  stanzas.forEach((st, si) => {
    if (si > 0) lines.append(el("div", "stanza-gap"));
    const sig = st.map((x) => x.u).join(",");
    const prev = current.kind !== "bible" && st.length > 1 && firstStanza.get(sig);
    if (prev) { lines.append(repeatedStanza(st, prev, uniq, lang)); return; }
    if (st.length > 1) firstStanza.set(sig, [st[0].n, st.at(-1).n]);
    st.forEach(({ u, n, label }) => {
      const seenAt = firstNo.get(u);
      if (seenAt == null) firstNo.set(u, current.kind === "bible" ? label : n);
      lines.append(lineRow(u, label, uniq, lang, seenAt));
    });
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
  if (lang === "ru") head.append(stressNodes(w.word || ""));
  else if (RUBY_LANGS.has(lang)) head.append(wordRuby(w.word || "", w.reading || ""));
  else head.append(w.word || "");
  c.append(head);
  const sub = [!RUBY_LANGS.has(lang) && w.lemma && w.lemma !== w.word ? "기본형 " + w.lemma : "", w.pos].filter(Boolean).join(" · ");
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
    ww.append(w.lang === "ru" ? stressNodes(w.word) : wordRuby(w.word, w.reading));
    t.append(ww);
    t.append(" — " + w.meaning);
    if (w.song) t.append(" ", el("small", null, "· " + w.song));
    const x = el("button", "x", "×"); x.type = "button"; x.setAttribute("aria-label", "단어 삭제");
    x.onclick = () => { wordbook.splice(i, 1); store.set("ln.wordbook", wordbook); renderWordbook(); render(); };
    li.append(t, x); ul.append(li);
  });
}

function openSaved(h) {
  current = clone(h); lastView[mode] = current; render(); hideDup();
  const left = missingIds(current).length;
  setStatus(left
    ? `저장된 해설을 불러왔습니다. ${left}${M(h.kind).unitLine}이 아직 분석되지 않았습니다. ‘이어서 분석’을 누르면 남은 부분만 분석합니다.`
    : "저장된 해설을 불러왔습니다. API는 호출하지 않았습니다.");
  window.scrollTo({ top: $("#sheet").offsetTop - 12 });
}
async function renderHistory() {
  const ul = $("#hist");
  try { history = (await listSongs()).filter((h) => (h.kind === "bible") === (mode === "bible")); } catch { history = []; }
  ul.replaceChildren();
  $("#histCount").textContent = history.length ? `${history.length}${MODES[mode].unit}` : "";
  if (!history.length) { ul.append(el("li", "empty", MODES[mode].listEmpty)); return; }
  history.forEach((h) => {
    const li = el("li"); const b = el("button", "open"); b.type = "button";
    const leftH = missingIds(h).length;
    b.append(h.title || M(h.kind).noTitle, " ", el("small", null, (h.artist ? h.artist + " · " : "") + h.lang.toUpperCase()));
    if (leftH) b.append(" ", el("small", "partial", `· ${leftH}${M(h.kind).unitLine} 남음`));
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
  const left = missingIds(saved).length;
  const unit = M(saved.kind).unitLine;
  const name = saved.title ? ` (‘${saved.title}’)` : "";
  $("#dupText").textContent = left
    ? `${M(saved.kind).dupWhat} 분석하다 멈춘 해설이 있습니다${name}. ${left}${unit}이 남았습니다. 이어서 분석하면 남은 부분에만 API 비용이 듭니다.`
    : `${M(saved.kind).dupWhat} 이미 분석해서 저장해 둔 해설이 있습니다${name}. 다시 분석하면 API 비용이 다시 듭니다.`;
  $("#dupResume").hidden = !left;
  $("#dupResume").textContent = `남은 ${left}${unit} 이어서 분석`;
  $("#dupResume").onclick = () => resumeAnalysis(saved);
  $("#dupOpen").className = left ? "btn small" : "btn primary small";
  $("#dupOpen").onclick = () => openSaved(saved);
  $("#dupRerun").textContent = left ? "처음부터 다시 분석" : "그래도 다시 분석";
  $("#dupRerun").onclick = () => { hideDup(); rerun(); };
  box.hidden = false;
}
function hideDup() { $("#dupNotice").hidden = true; }
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
  const kind = mode === "bible" ? "bible" : undefined;
  const pasted = $("#lyrics").value.replace(/\r/g, "").split("\n");
  let raw, removed = [], nums;
  if (kind === "bible") ({ lines: raw, nums } = parseVerses(pasted));
  else {
    ({ lines: raw, removed } = stripSectionLabels(pasted));
    const junk = stripJunk(raw, { title: $("#title").value.trim(), artist: $("#artist").value.trim() });
    raw = junk.lines; removed = [...removed, ...junk.removed];
    if (removed.length) $("#lyrics").value = raw.join("\n");
  }
  const text = raw.join("\n").trim();
  if (!text) { setStatus(MODES[mode].empty, true); $("#lyrics").focus(); return; }
  const lang = langChoice === "auto" ? detectLang(text) : langChoice;
  const allowed = mode === "bible" ? ["ja", "ru"] : Object.keys(LANG_KO);
  if (!lang || !allowed.includes(lang)) {
    setStatus(mode === "bible"
      ? "성경 탭은 일본어·러시아어만 지원합니다. 언어를 확인해 주세요."
      : "언어를 알아내지 못했습니다. 위에서 언어를 직접 선택해 주세요.", true);
    return;
  }
  let key = null;
  try { key = await lyricsKey(lang, raw, kind); } catch {}
  if (key && !force) {
    let saved = null;
    try { saved = await getSong(key); } catch {}
    if (saved) { showDup(saved, () => analyze({ force: true })); return; }
  }
  if (!settings.apiKey) { setStatus("먼저 설정에서 Anthropic API 키를 입력해 주세요.", true); openSettings(); return; }

  while (raw.length && !raw[raw.length - 1].trim()) { raw.pop(); nums?.pop(); }
  // The Bible tab assumes the reader's own translations unless they name another.
  const DEFAULT_TRANSLATION = { ja: "JCB (リビングバイブル)", ru: "НРП (Новый русский перевод)" };
  const artist = $("#artist").value.trim() || (kind === "bible" ? DEFAULT_TRANSLATION[lang] : "");
  const song = { key, kind, lang, title: $("#title").value.trim(), artist, raw, nums, lines: {}, overview: null, lineErrors: {} };
  // Store the text right away, so even a run that fails at once can be resumed later; then clear
  // the form for the next one.
  if (key) {
    await saveHistory(song);
    $("#lyrics").value = ""; $("#title").value = ""; $("#artist").value = ""; updateSearch();
  }
  await runAnalysis(song, { removed });
}

// Unique lines of a song that have no analysis yet (never sent, failed, or cut off).
function missingIds(song) {
  const { uniq } = uniqueLines(song.raw);
  return uniq.map((t, id) => ({ id, text: t })).filter((b) => !song.lines[b.id]);
}

// Picks up an interrupted analysis: only the lines (and overview) still missing are sent.
async function resumeAnalysis(saved) {
  hideDup();
  if (!settings.apiKey) { setStatus("먼저 설정에서 Anthropic API 키를 입력해 주세요.", true); openSettings(); return; }
  const song = clone(saved);
  song.lineErrors = {};
  await runAnalysis(song, { resumed: true });
}

async function runAnalysis(song, { removed = [], resumed = false } = {}) {
  current = song; lastView[mode] = song;
  stopped = false;
  ctrl = new AbortController();   // set before the first render: no "resume" button while running
  render();
  window.scrollTo({ top: $("#sheet").offsetTop - 12, behavior: "smooth" });
  const { lang } = song;
  const unit = MODES[mode].unitLine;

  const { uniq } = uniqueLines(song.raw);
  const todo = missingIds(song);
  const BATCH = 8;
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  const opts = { apiKey: settings.apiKey, model: settings.model, signal: ctrl.signal };
  $("#go").disabled = true; $("#stop").hidden = false;
  setStatus(resumed
    ? `이어서 분석합니다. 이미 분석한 ${uniq.length - todo.length}${unit}은 건너뜁니다.`
    : "Claude가 읽는 중… (한 묶음에 수십 초 걸릴 수 있어요)");
  setBar((uniq.length - todo.length) / Math.max(uniq.length, 1) || 0.03);

  const ovP = song.overview ? Promise.resolve() : analyzeOverview(opts, song)
    .then((o) => {
      song.overview = o; delete song.overviewError;
      // Fill in title/artist only where the user left them blank.
      const t = o.song_title?.trim(), a = o.song_artist?.trim();
      if ((!song.title && t) || (!song.artist && a)) {
        if (!song.title && t) song.title = t;
        if (!song.artist && a) song.artist = a;
        song.titleGuessed = true;
      }
      if (song.key) saveHistory(song);
    })
    .catch((e) => { const m = describeError(e); if (m) song.overviewError = "개요를 만들지 못했습니다: " + m; })
    .finally(() => { if (current === song) render(); });

  // Words already explained (also from an earlier, interrupted run) are not repeated.
  const covered = Object.values(song.lines).flatMap((d) => d.words || []).map((w) => (w.lemma || w.word).replace(/\u0301/g, ""));
  let failed = false, checkFailed = false, checkNoted = false;
  for (const batch of batches) {
    if (stopped) break;
    const doneNow = Object.keys(song.lines).length;
    setStatus(`${unit}별 분석 중… ${Math.min(doneNow + batch.length, uniq.length)}/${uniq.length}${unit}`);
    try {
      const lines = await analyzeLines(opts, song, batch, covered);
      for (const d of lines) {
        if (!batch.some((b) => b.id === d.id)) continue;
        song.lines[d.id] = d;
        delete song.lineErrors[d.id];
        d.words.forEach((w) => covered.push((w.lemma || w.word).replace(/\u0301/g, "")));
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
      // Save after every batch, so a closed app or a dropped connection loses at most one batch.
      if (song.key) saveHistory(song);
    } catch (e) {
      const m = describeError(e);
      if (m === null) break; // cancelled
      failed = true;
      batch.forEach((b) => { song.lineErrors[b.id] = "분석 실패: " + m; });
      setStatus(m, true);
      if (isFatal(e)) break;
    }
    setBar(Object.keys(song.lines).length / uniq.length);
    if (current === song) render();
  }
  await ovP;
  $("#go").disabled = false; $("#stop").hidden = true; ctrl = null;
  const left = missingIds(song).length;
  if (song.key) saveHistory(song);
  if (current === song) render();
  if (left) {
    const why = stopped ? "멈췄습니다." : failed ? "일부가 실패했습니다." : "분석이 끝나지 않았습니다.";
    setStatus(`${why} ${uniq.length - left}/${uniq.length}${unit} 분석됨. ‘남은 ${left}${unit} 이어서 분석’을 누르면 나머지만 분석합니다.`, failed && !stopped);
    return;
  }
  const n = Object.values(song.lines).reduce((s, d) => s + (d.check?.diffs?.length || 0), 0);
  const check = lang !== "ru" || !settings.stressCheck ? ""
    : checkFailed ? " 강세 확인 모델을 불러오지 못해 교차 확인은 건너뛰었습니다."
    : n ? ` 강세가 엇갈린 단어 ${n}개에 밑줄을 쳤습니다.` : " 강세 교차 확인에서 엇갈린 단어는 없었습니다.";
  // One note for everything left out: obvious lines dropped before sending, and lines Claude flagged.
  const { idx: allIdx } = uniqueLines(song.raw);
  const hidden = [...edgeHidden(allIdx, song.lines)].map((i) => song.raw[i].trim());
  const out = [...removed, ...hidden];
  const what = mode === "bible" ? "본문이 아닌 줄" : "가사가 아닌 줄";
  const outNote = out.length ? ` ${what} ${out.length}개(${out.slice(0, 3).join(", ")}${out.length > 3 ? " …" : ""})는 뺐습니다.` : "";
  setStatus(`완료 · ${uniq.length - hidden.length}${unit} 분석.${outNote}${check} 강세·읽기는 사전으로 한 번 더 확인하세요.`);
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
const showExample = (k) => {
  current = clone(MODES[mode].examples[k]); lastView[mode] = current; render();
  setStatus(`예시를 보는 중입니다. 실제 ${mode === "bible" ? "구절" : "가사"}을 붙여넣고 ‘분석하기’를 누르세요.`);
};

function setMode(m, { initial = false } = {}) {
  mode = m; store.set("ln.mode", m);
  const T = MODES[m];
  document.querySelectorAll(".tabs [role=tab]").forEach((t) => t.setAttribute("aria-selected", t.dataset.mode === m));
  $("#titleLabel").textContent = T.titleLabel;
  $("#artistLabel").textContent = T.artistLabel;
  $("#textLabel").textContent = T.textLabel;
  $("#lyrics").placeholder = T.placeholder;
  $("#textHint").hidden = m === "bible";   // the lyrics-search hint only makes sense for songs
  // Chinese, Spanish and French are for songs only.
  document.querySelectorAll("#langSeg .song-only").forEach((b) => (b.hidden = m === "bible"));
  if (m === "bible" && !["auto", "ja", "ru"].includes(langChoice)) setLang("auto");
  if (!initial) {
    $("#lyrics").value = ""; $("#title").value = ""; $("#artist").value = ""; updateSearch(); hideDup();
    setStatus("");
  }
  current = lastView[m] || clone(T.examples.ru);
  lastView[m] = current;
  render(); renderHistory();
}
document.querySelectorAll(".tabs [role=tab]").forEach((t) => (t.onclick = () => { if (t.dataset.mode !== mode && !ctrl) setMode(t.dataset.mode); }));
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

setMode(mode, { initial: true });
renderWordbook(); updateSearch();
migrateFromLocalStorage().catch(() => {}).finally(renderHistory);
requestPersist();
setStatus(settings.apiKey ? `러시아어 예시입니다. ${mode === "bible" ? "구절" : "가사"}을 붙여넣고 ‘분석하기’를 누르세요.` : "처음이라면 오른쪽 위 ‘설정 · API 키’에서 키를 입력하세요.");

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
