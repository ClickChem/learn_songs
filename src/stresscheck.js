// Cross-checks Claude's Russian stress marks against rustress (a local neural stress model).
// The model (~20 MB with its runtime) is loaded only the first time a Russian song is checked.

const ACUTE = "́";
const VOWEL = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/;

let loading = null;
function load() {
  loading ??= import("@roj/rustress").then((m) => m.markStresses).catch((e) => { loading = null; throw e; });
  return loading;
}

// "иду́," -> { base: "иду", pos: 2 }  (pos = index in base of the stressed vowel, or -1)
function parseWord(token) {
  const clean = token.replace(/[^\p{L}́-]/gu, "");
  let base = "", pos = -1;
  for (const ch of clean) {
    if (ch === ACUTE) { if (base) pos = base.length - 1; }
    else base += ch;
  }
  if (pos === -1) { const yo = base.search(/[ёЁ]/); if (yo !== -1) pos = yo; }
  return { base, pos };
}

const vowelCount = (w) => [...w].filter((c) => VOWEL.test(c)).length;

/**
 * Returns the indices (in the whitespace-split line) of words where Claude and the
 * model put the stress on different vowels, with both versions. Words either side
 * left unmarked, one-syllable words and lines whose letters differ are skipped.
 */
export async function crossCheck(original, claudeStressed) {
  const markStresses = await load();
  const tool = await markStresses(original);
  const a = claudeStressed.split(/\s+/).filter(Boolean);
  const b = tool.split(/\s+/).filter(Boolean);
  if (a.length !== b.length) return { ok: false, diffs: [] };
  const diffs = [];
  for (let i = 0; i < a.length; i++) {
    const ca = parseWord(a[i]), cb = parseWord(b[i]);
    if (ca.base.toLowerCase() !== cb.base.toLowerCase()) return { ok: false, diffs: [] };
    if (vowelCount(ca.base) < 2 || ca.pos < 0 || cb.pos < 0 || ca.pos === cb.pos) continue;
    diffs.push({ index: i, claude: a[i].replace(/[^\p{L}́-]/gu, ""), tool: b[i].replace(/[^\p{L}́-]/gu, "") });
  }
  return { ok: true, diffs };
}
