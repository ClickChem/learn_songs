// Removes section labels that lyric sites mix into pasted lyrics ("[Chorus]", "Припев:", "【サビ】" ...).
// A removed label becomes a blank line, so it still separates stanzas.

const WORDS = [
  // English
  "verse", "chorus", "pre-chorus", "prechorus", "post-chorus", "refrain", "hook", "bridge", "intro", "outro",
  "interlude", "instrumental", "breakdown", "drop", "coda", "spoken", "repeat", "x\\d+",
  // Russian
  "куплет", "припев", "предприпев", "пред-припев", "бридж", "мост", "вступление", "интро", "аутро", "проигрыш",
  "кода", "речитатив", "повтор",
  // Japanese
  "サビ", "[a-dａ-ｄＡ-Ｄ]メロ", "大サビ", "落ちサビ", "間奏", "前奏", "後奏", "イントロ", "アウトロ",
  "コーラス", "ブリッジ", "ラップ", "セリフ", "台詞", "繰り返し", "\\d+番",
  // Chinese
  "主歌", "副歌", "桥段", "橋段", "前奏", "间奏", "尾奏", "说唱", "說唱", "合唱", "重复", "重複", "独白", "獨白",
  // Spanish
  "verso", "estrofa", "coro", "estribillo", "pre-coro", "precoro", "puente", "introducción", "final", "puente musical",
  // French
  "couplet", "refrain", "pré-refrain", "pont", "intro", "outro",
];
// A label word, optionally numbered or with a repeat count: "Verse 2", "Chorus x2", "Припев 1:", "1番".
const CORE = `(?:${WORDS.join("|")})(?:\\s*[\\d０-９]+)?(?:\\s*[x×]\\s*\\d+)?`;
const LABEL = new RegExp(`^${CORE}\\s*[:：]?$`, "iu");
// Inside parentheses a singer name may follow: "(Chorus: Name)". Bare lines don't get this, so
// a lyric such as "Мост — через реку" is never mistaken for a label.
const LABEL_WITH_NAME = new RegExp(`^${CORE}\\s*(?:[:：\\-–—]\\s*[^\\n]{0,30})?$`, "iu");
const ALWAYS_LABEL = /^[[［【〔〖].*[\]］】〕〗]$/u;   // a whole line in square-style brackets
const PARENS = /^[(（](.*)[)）]$/u;                  // "(Chorus)" is a label, "(I miss you)" is a lyric

export function isSectionLabel(line) {
  const t = line.trim();
  if (!t) return false;
  if (ALWAYS_LABEL.test(t)) return true;
  const inner = t.match(PARENS)?.[1]?.trim();
  return inner != null ? LABEL_WITH_NAME.test(inner) : LABEL.test(t);
}

// Returns the cleaned lines and the labels that were removed.
export function stripSectionLabels(lines) {
  const removed = [];
  const out = lines.map((l) => {
    if (isSectionLabel(l)) { removed.push(l.trim()); return ""; }
    return l;
  });
  // collapse runs of blank lines left behind
  const cleaned = out.filter((l, i) => l.trim() || (i > 0 && out[i - 1].trim()));
  while (cleaned.length && !cleaned[0].trim()) cleaned.shift();
  return { lines: cleaned, removed };
}

// Page furniture that lyric sites leave in a copy-paste: credits, site names, counters, "Lyrics" headers.
const JUNK = [
  /^\d+\s*contributors?\b/i, /(^|\d|\s)embed$/i, /^you might also like$/i, /^translations?\b/i, /^see .* live$/i,
  /^(作詞|作曲|編曲|歌|歌手|唄|訳詞)\s*[:：]/u,
  /^(作词|作曲|编曲|演唱|歌手|制作人|監製|监制|填词|填詞)\s*[:：]/u,
  /^(letra|música|autor(es)?|compositor(es)?|intérprete|paroles|musique|auteur(s)?|compositeur(s)?|interprète)\s*(de)?\s*[:：]/iu,
  /^(слова|музыка|исполнитель|автор(ы)?(\s+(слов|музыки))?|аранжировка)\s*[:：]/iu,
  /^(lyrics|words|music|written|composed|arranged|source|источник)\s*(by)?\s*[:：]/iu,
  /^(©|\(c\)|copyright\b|℗)/iu,
  /(genius|musixmatch|azlyrics|lyrics\.com|lyricstranslate|uta-?net|utaten|j-?lyric|petitlyrics|歌ネット|текстпесни|pesni\.|songtexte|amalgama)/iu,
  /(^|\s)(lyrics|歌詞|歌词|текст песни|слова песни|перевод песни|letra|paroles)\s*$/iu,
];

// Lines that repeat the title / artist the reader typed ("Artist - Title", "Title", "Artist").
function isHeader(t, title, artist) {
  const norm = (x) => x.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
  const n = norm(t);
  if (!n) return false;
  const ti = title ? norm(title) : "", ar = artist ? norm(artist) : "";
  return (ti && n === ti) || (ar && n === ar) || (ti && ar && (n === ar + ti || n === ti + ar));
}

// Removes obvious non-lyric lines; anything less clear-cut is left for Claude to flag.
export function stripJunk(lines, { title = "", artist = "" } = {}) {
  const removed = [];
  const out = lines.map((l) => {
    const t = l.trim();
    if (t && t.length <= 80 && (JUNK.some((re) => re.test(t)) || isHeader(t, title, artist))) { removed.push(t); return ""; }
    return l;
  });
  const cleaned = out.filter((l, i) => l.trim() || (i > 0 && out[i - 1].trim()));
  while (cleaned.length && !cleaned[0].trim()) cleaned.shift();
  return { lines: cleaned, removed };
}

