// Original sentences written for the demo, not song lyrics.
export const EXAMPLES = {
  ru: {
    example: true, lang: "ru", title: "예시 문장", artist: "데모용 창작 문장",
    raw: ["Я иду по тихой улице одна,", "И падает снег на мою ладонь."],
    overview: { summary: "겨울밤 혼자 걷는 화자가 손바닥에 떨어지는 눈을 바라보는 장면입니다. 고요함과 쓸쓸함이 함께 느껴집니다.", level: "초급~초중급", tips: ["одна́(여성형)로 화자가 여성임을 알 수 있어요.", "по + 여격, на + 대격처럼 전치사가 요구하는 격을 함께 외우세요."] },
    lines: {
      0: { stressed: "Я иду́ по ти́хой у́лице одна́,", roman: "Ya idu po tikhoy ulitse odna", translation: "나는 조용한 거리를 혼자 걸어간다,",
        words: [
          { word: "иду́", lemma: "идти́", pos: "동사 (불완료, 정태)", meaning: "가다, 걸어가다", note: "한 방향으로 지금 가는 중. 반복·왕복은 ходи́ть." },
          { word: "ти́хой", lemma: "ти́хий", pos: "형용사, 여성 여격", meaning: "조용한", note: "у́лица(여성)에 맞춰 여격 -ой." },
          { word: "у́лице", lemma: "у́лица", pos: "명사, 여성 여격", meaning: "거리", note: "" },
          { word: "одна́", lemma: "оди́н", pos: "수사/형용사, 여성", meaning: "혼자, 하나", note: "남성 화자라면 оди́н." } ],
        grammar: [ { point: "по + 여격", explain: "'~을 따라, ~ 곳곳을' 이동할 때. по у́лице = 거리를 따라." },
                   { point: "성(性) 일치", explain: "주어 я의 성은 형태로 드러나지 않지만, одна́ 같은 술어 형태가 화자의 성을 알려 줍니다." } ],
        unsure: [] },
      1: { stressed: "И па́дает снег на мою́ ладо́нь.", roman: "I padayet sneg na moyu ladon'", translation: "그리고 눈이 내 손바닥 위로 떨어진다.",
        words: [
          { word: "па́дает", lemma: "па́дать", pos: "동사 (불완료), 3인칭 단수", meaning: "떨어지다, 내리다", note: "완료상은 упа́сть." },
          { word: "снег", lemma: "снег", pos: "명사, 남성", meaning: "눈(雪)", note: "단음절이라 강세 표시 없음." },
          { word: "мою́", lemma: "мой", pos: "소유대명사, 여성 대격", meaning: "나의", note: "" },
          { word: "ладо́нь", lemma: "ладо́нь", pos: "명사, 여성 (-ь)", meaning: "손바닥", note: "-ь로 끝나는 명사는 성을 따로 외워야 합니다." } ],
        grammar: [ { point: "на + 대격", explain: "방향(~ 위로)을 나타냄. 위치(~ 위에)는 на + 전치격: на ладо́ни." },
                   { point: "동사-주어 도치", explain: "па́дает снег처럼 동사를 앞에 두면 장면 묘사·서사적 리듬이 생깁니다. 가사·시에서 흔합니다." } ],
        unsure: [] } } },
  ja: {
    example: true, lang: "ja", title: "예시 문장", artist: "데모용 창작 문장",
    raw: ["夜の駅で君を待っている", "明日はきっと晴れるだろう"],
    overview: { summary: "밤 역에서 누군가를 기다리며 내일에 대한 희망을 품는 장면입니다.", level: "초급", tips: ["～ている와 ～だろう는 가사에 정말 자주 나오니 꼭 익혀 두세요."] },
    lines: {
      0: { ruby: [{t:"夜",r:"よる"},{t:"の",r:""},{t:"駅",r:"えき"},{t:"で",r:""},{t:"君",r:"きみ"},{t:"を",r:""},{t:"待",r:"ま"},{t:"っている",r:""}],
        roman: "yoru no eki de kimi o matte iru", translation: "밤의 역에서 너를 기다리고 있어",
        words: [
          { word: "夜", reading: "よる", pos: "명사", meaning: "밤", note: "" },
          { word: "駅", reading: "えき", pos: "명사", meaning: "역", note: "" },
          { word: "君", reading: "きみ", pos: "대명사", meaning: "너", note: "가사에서 매우 흔한 2인칭. 일상 회화에선 상대에 따라 조심해서 씁니다." },
          { word: "待つ", reading: "まつ", pos: "동사 (5단)", meaning: "기다리다", note: "て형: 待って" } ],
        grammar: [ { point: "장소 + で", explain: "동작이 일어나는 장소. 駅で待つ = 역에서 기다리다." },
                   { point: "～ている", explain: "진행 중인 동작(기다리고 있다) 또는 지속 상태." } ],
        unsure: [] },
      1: { ruby: [{t:"明日",r:"あした"},{t:"は",r:""},{t:"きっと",r:""},{t:"晴",r:"は"},{t:"れるだろう",r:""}],
        roman: "ashita wa kitto hareru darō", translation: "내일은 분명 맑겠지",
        words: [
          { word: "明日", reading: "あした", pos: "명사", meaning: "내일", note: "あす, みょうにち로도 읽음(더 격식)." },
          { word: "きっと", reading: "きっと", pos: "부사", meaning: "분명, 꼭", note: "" },
          { word: "晴れる", reading: "はれる", pos: "동사 (1단)", meaning: "(날씨가) 개다, 맑다", note: "" } ],
        grammar: [ { point: "～だろう", explain: "추측 '~하겠지'. 정중형은 ～でしょう." },
                   { point: "は (주제)", explain: "明日は = '내일은'. 화제를 제시합니다." } ],
        unsure: [] } } },
};
