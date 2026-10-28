// Splits a pasted Bible passage into units: verse numbers at the start of a line are pulled out
// ("16 Ибо…", "3:16 神は…", "１６　それ…"), and a long verse is cut at sentence ends so each
// unit stays readable. Returns the text lines and, aligned with them, the verse number to show.

const toAscii = (s) => s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
const VERSE_NO = /^\s*[(（]?(?:[0-9０-９]{1,3}\s*[:：]\s*)?([0-9０-９]{1,3})[)）]?(?:[\s.．、]+|(?=[^\s0-9０-９.,:：]))/u;
const LONG = 90;

function splitSentences(text) {
  // keep the closing punctuation (and any closing quote) with its sentence
  const parts = text.match(/[^。！？!?.]+(?:[。！？!?.]+[」』"»”]*|$)/gu) || [text];
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    // glue very short pieces (abbreviations, "Ст.") onto the previous one
    if (out.length && t.length < 12) out[out.length - 1] += " " + t;
    else out.push(t);
  }
  return out;
}

export function parseVerses(rawLines) {
  const lines = [], nums = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) { lines.push(""); nums.push(""); continue; }
    const m = line.match(VERSE_NO);
    const num = m ? toAscii(m[1]) : "";
    const text = m ? line.slice(m[0].length).trim() : line;
    if (!text) continue;
    const parts = text.length > LONG ? splitSentences(text) : [text];
    parts.forEach((p, i) => { lines.push(p); nums.push(i === 0 ? num : ""); });
  }
  while (lines.length && !lines[0].trim()) { lines.shift(); nums.shift(); }
  while (lines.length && !lines.at(-1).trim()) { lines.pop(); nums.pop(); }
  return { lines, nums };
}
