import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

// ---------- Output schemas ----------
const Grammar = z.object({ point: z.string(), explain: z.string() });

const RuWord = z.object({ word: z.string(), lemma: z.string(), pos: z.string(), meaning: z.string(), note: z.string() });
const RuLine = z.object({
  id: z.number().int(), not_text: z.boolean(), stressed: z.string(), translation: z.string(),
  words: z.array(RuWord), grammar: z.array(Grammar), unsure: z.array(z.string()),
});

const JaWord = z.object({ word: z.string(), reading: z.string(), pos: z.string(), meaning: z.string(), note: z.string() });
const JaLine = z.object({
  id: z.number().int(), not_text: z.boolean(), ruby: z.array(z.object({ t: z.string(), r: z.string() })), translation: z.string(),
  words: z.array(JaWord), grammar: z.array(Grammar), unsure: z.array(z.string()),
});

const LINES = { ru: z.object({ lines: z.array(RuLine) }), ja: z.object({ lines: z.array(JaLine) }) };
const Overview = z.object({ song_title: z.string(), song_artist: z.string(), summary: z.string(), level: z.string(), tips: z.array(z.string()) });

// Server-side refusal fallback is offered for Opus 5.5 and Sonnet 5.5 on the Claude API, not for Haiku 5.5.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export class RefusedError extends Error {}

// ---------- Prompts ----------
const LANG_NAME = { ru: "Russian", ja: "Japanese" };

const system = (lang, kind) => [
  kind === "bible"
    ? `You are a careful ${LANG_NAME[lang]} tutor for a Korean speaker who reads the Bible in ${LANG_NAME[lang]} to learn the language.`
    : `You are a careful ${LANG_NAME[lang]} tutor for a Korean speaker who learns the language through songs.`,
  kind === "bible"
    ? `Work ONLY with the passage the learner pasted. Never add, complete, or recall other verses from memory, and do not quote any other Bible translation.`
    : `Work ONLY with the lyric text the learner pasted. Never add, complete, or recall other lyrics of the song from memory, even if you think you know them.`,
  lang === "ru"
    ? `Write translations, word meanings, notes and the overview in natural Korean, but use Russian grammatical terms (e.g. дательный падеж, несовершенный вид) instead of Korean ones. Grammar points are written entirely in simple Russian, as the user prompt describes.`
    : `Write every explanation, translation and note in natural Korean.`,
  `Korean style: ${kind === "bible" ? "write the translation" : "write the lyric translation in casual 해체 (반말, e.g. ~해, ~야, ~지), as a song would speak; write"} every other Korean text (explanations, notes, grammar, unsure notes, overview) in polite 합니다체 (~합니다, ~입니다)${kind === "bible" ? ", including the translation" : ""}. Word meanings are short dictionary glosses (e.g. "가다, 걸어가다").`,
  `Accuracy matters more than completeness: if you are not sure about a reading, stress, nuance or idiom, say so briefly in "unsure" instead of stating it confidently.`,
].join("\n");

const songLine = (s) => s.kind === "bible"
  ? `Bible passage. Reference as given by the learner: "${s.title || "unknown"}"; translation: "${s.artist || "unknown"}".`
  : `Song (as named by the learner): "${s.title || "unknown"}"${s.artist ? " by " + s.artist : ""}.`;

// What the Bible tab needs on top of the song rules.
const BIBLE_NOTES = {
  ru: `- This is a Bible text, normally from the НРП (Новый русский перевод), a modern Russian translation. Focus on vocabulary and expressions of modern literary Russian as used in Scripture, theological and church terms (благода́ть, пра́ведность, искупле́ние ...), and any remaining traditional or bookish forms, explaining their everyday equivalent. Do not assume Synodal wording. Grammar explanations stay in simple Russian.`,
  ja: `- This is a Bible text, normally from the JCB (リビングバイブル, Japanese Contemporary Bible), a modern, freely paraphrased Japanese translation. Focus on N1-level expressions, idioms and set phrases, honorific language for God and Jesus (尊敬語・謙譲語), and Bible or church vocabulary (贖い, 義, 恵み, 悔い改め ...). Do not assume 口語訳 or 新共同訳 wording.`,
};

function overviewPrompt(s) {
  const bible = s.kind === "bible";
  return `${songLine(s)}
Based only on the pasted text below, give the following. The paste may include stray lines that are not ${bible ? "verse text" : "lyrics"} (a title or artist header, credits, a website or app name, section labels): ignore them for the summary, but you may use a title/artist header to fill the fields below.
${bible
  ? `- song_title: the book, chapter and verse(s) in Korean (e.g. "요한복음 3:16-17"), only if you can identify them with high confidence; otherwise "".
- song_artist: the translation's name (e.g. "Синодальный перевод", "口語訳"), only if you can tell with high confidence from the wording; otherwise "".
- summary: 3-5 Korean sentences on what the passage says and its context in the book`
  : `- song_title, song_artist: the song's title and performer, only if you recognize the song from these lyrics with high confidence; otherwise "" for both. Write them as commonly published (original script). Never quote lyrics here.
- summary: 3-5 Korean sentences on what the lyrics say and their mood`}
- level: a short Korean estimate of learner level (e.g. 초급, 중급)
- tips: 2-4 short Korean study tips specific to this text${s.lang === "ru" ? " (assume the learner knows A1-A2 grammar; no tips about basic declension or agreement; use Russian grammatical terms)" : " (the learner has passed JLPT N2; tips only about N1-level grammar, idioms, literary forms or nuance)"}
${bible ? "Keep the summary factual and neutral." : "Do not state facts about the song's release, writer or background unless they are visible in the text."}

Pasted ${bible ? "passage" : "lyrics"}:
${s.raw.join("\n")}`;
}

function linesPrompt(s, batch, covered) {
  const fmt = s.lang === "ru"
    ? `- stressed: the line exactly as given, with the combining acute accent U+0301 placed right after the stressed vowel of every word of two or more syllables. Do not mark ё (always stressed) or one-syllable words. Change no other character.
- words[].word / lemma: the form in the line and its dictionary form, both with U+0301 stress marks.
- words[].pos: in Russian grammatical terms, with U+0301 stress marks, e.g. "глаго́л, несоверше́нный вид" or "существи́тельное, ж. р., да́тельный паде́ж".
- words[].meaning: Korean. words[].note: short Korean, but name grammar with Russian terms (e.g. "соверше́нный вид는 упа́сть").
- grammar: write point and explain entirely in Russian at CEFR A2-B1 level: short sentences, common everyday words, Russian grammatical terms (паде́ж, вид, род, предло́г, глаго́л...), and a short example. Put U+0301 stress marks on every word of two or more syllables. No Korean in grammar.
- The learner already knows A1-A2 grammar. Do NOT explain basics such as noun/adjective declension by gender and case, basic case use after common prepositions, gender agreement, present/past tense forms or personal pronouns. Choose points from B1 and above instead: aspect choice and its nuance, prefixed verbs of motion, participles and verbal adverbs (причастия, деепричастия), conditional and subjunctive (бы), impersonal constructions, word order and emphasis, colloquial or poetic forms, idioms and set phrases. If a line has nothing beyond A2, return grammar as [].
- words: likewise skip words a learner at A2 knows; pick the less common or song-specific ones.${s.kind === "bible" ? "\n" + BIBLE_NOTES.ru : ""}`
    : `- ruby: consecutive segments that together reproduce the line exactly. Each segment {t, r}: r is the hiragana reading only for segments containing kanji (okurigana goes in its own segment with r ""), otherwise r is "".
- words[].word: dictionary form; reading: hiragana; pos: Korean part of speech (e.g. 동사 (5단)); note: e.g. the conjugated form used in the line.
- The learner has passed JLPT N2. Do NOT explain grammar or words at N2 level or below (particles, ている, だろう, ように, ばかり, わけ, はず and the like). Focus on N1-level grammar, idioms and set phrases (慣用句, 四字熟語, ことわざ), literary and classical forms common in lyrics (〜ぬ, 〜ず, 〜ゆく, 〜べし, 〜んことを, 〜ども ...), poetic or unusual kanji readings (当て字), and nuance between near-synonyms. If a line has nothing beyond N2, return grammar as [] and only list words that are genuinely advanced (words can be []).
- grammar: point is the pattern in Japanese (e.g. 〜んばかりに); explain in Korean, 1-2 sentences, with what level/register it is.${s.kind === "bible" ? "\n" + BIBLE_NOTES.ja : ""}`;
  return `${songLine(s)}
For each numbered line below return an entry with:
- id: the number given
- not_text: true only if the line is clearly not part of the ${s.kind === "bible" ? "verse text: a section heading, a book/chapter reference line, a translation name, a copyright notice, or an app or website name" : "sung lyrics: the song title, the artist name, an \"Artist - Title\" header, credits (作詞, слова, music by ...), a website or app name, an ad, a section label"}. If it is true, leave every other field empty (""/[]). When unsure, false.
${fmt}
- translation: natural Korean translation that fits the context${s.kind === "bible" ? ", using standard Korean Christian terms (e.g. 독생자, 은혜, 의) but in your own wording; do not quote a published Korean Bible" : ""}
- words: 2-5 key words worth learning, skipping trivial particles and pronouns${covered.length ? ` and these already explained: ${covered.slice(-80).join(", ")}` : ""}. note may be "".
- grammar: 1-2 grammar points visible in the line, each explained in 1-2 sentences${s.lang === "ru" ? " (in simple Russian, see above)" : " of Korean"}
- unsure: [] or short Korean notes on anything you are not certain about

Full pasted ${s.kind === "bible" ? "passage" : "lyrics"}, for context only:
${s.raw.join("\n")}

Lines to analyze:
${batch.map((b) => `[${b.id}] ${b.text}`).join("\n")}`;
}

// ---------- Calls ----------
function client(apiKey) {
  // The key lives only on this device; the SDK sends it straight to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

async function ask({ apiKey, model, lang, kind, prompt, schema, signal }) {
  const params = {
    model,
    max_tokens: 16000,
    system: system(lang, kind),
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const res = await client(apiKey).beta.messages.parse(params, { signal });
  if (res.stop_reason === "refusal") throw new RefusedError(res.stop_details?.explanation || "refused");
  if (res.stop_reason === "max_tokens") throw new Error("응답이 길이 제한에 걸려 잘렸습니다. 가사를 나눠서 분석해 주세요.");
  if (!res.parsed_output) throw new Error("응답을 읽지 못했습니다.");
  return res.parsed_output;
}

export const analyzeOverview = (opts, song) =>
  ask({ ...opts, lang: song.lang, kind: song.kind, prompt: overviewPrompt(song), schema: Overview });

export const analyzeLines = (opts, song, batch, covered) =>
  ask({ ...opts, lang: song.lang, kind: song.kind, prompt: linesPrompt(song, batch, covered), schema: LINES[song.lang] }).then((r) => r.lines);

export function describeError(e) {
  if (e instanceof Anthropic.APIUserAbortError) return null;
  if (e instanceof RefusedError) return "이 내용은 분석할 수 없다는 응답을 받았습니다.";
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다. 설정에서 키를 확인해 주세요.";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 선택한 모델을 쓸 수 없습니다. 설정에서 다른 모델을 골라 보세요.";
  if (e instanceof Anthropic.RateLimitError) return "요청 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.";
  if (e instanceof Anthropic.BadRequestError) return "요청이 거부되었습니다: " + (e.message || "").slice(0, 200);
  if (e instanceof Anthropic.APIConnectionError) return "네트워크에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.";
  if (e instanceof Anthropic.APIError) return `API 오류 (${e.status ?? "?"}). 잠시 후 다시 시도해 주세요.`;
  return e?.message || "알 수 없는 오류가 발생했습니다.";
}

// Errors after which further batches would fail the same way.
export const isFatal = (e) =>
  e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError ||
  e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError;
