# Hilads i18n style guide and glossary

For everyone writing or reviewing Hilads copy in any of the 19 locales: app, web, pushes, emails and the daily challenge content.
Check a change with `node tools/i18n/validate.mjs` (see the README, "Adding a string").

## 1. Voice

Hilads talks like a local friend who knows the city: warm, playful, short. Not a bank, not a government form, not a tourist brochure.

- **Second person, casual.** Address the user directly, in the informal form where the language has one (see each locale).
- **Short.** A button is 1 to 3 words. A title fits one line on a 360 dp phone. A toast is one sentence. When the translation runs longer than the English, cut words, not meaning.
- **Re-translate the meaning, not the words.** Ask "what would a 25-year-old local write here?" Word-for-word structure from English is the main defect we are fixing: passive voice, "your" everywhere, nouns stacked where a verb reads better.
- **Playful, not cringe.** One light touch per screen at most (an emoji the English already has, a local expression). Never invent jokes the English doesn't make.
- **Photo and play.** A player's contribution is a **photo**, taking part is **playing** ("Play for Saigon"). Never "answer" / "submission" / "entry" for a photo; "answer" only for the value given to the day's question (COPY.md §10).
- **Same thing, same word.** Use the glossary term every time, in the app, on the web, in pushes and in the daily content. A screen that says "streak" and another that says "series" for the same thing reads as two features.
- **Keep what the code needs:**
  - every placeholder (`{{city}}`, `{{count}}`, `{name}` in pushes) and every tag (`<1>…</1>`, `<hi>…</hi>`);
  - the same emojis as the English, in a natural position;
  - plural forms: every form the language needs (`_one`, `_few`, …), and `{{count}}` in each form where the language puts the number.
- **App Store / Play metadata strings: no emojis.**

## 2. Brand terms (never translated)

Hilads · Hi · Hi now · Hi plan · Daily Challenge · Local Twist · Local Pass · Most Local · Pioneer · Ghost (the guest badge) · vibe / vibes · Halloween ·
the brand words of `brand.json` (now, my city, here, me, feel local, anywhere) ·
the taglines "Play local. Compare global." and "Same challenge. Different worlds."

Write them exactly like this (case included). Inflect around them, never inside them: fr "le Daily Challenge", de "die Daily Challenge", ru "в Daily Challenge", ar "Daily Challenge" embedded in RTL.

Open decisions (the 2026-10-30 brief vs earlier approved choices, not changed in this pass):
- **Theme names** (Hidden gem, Taste, Get around, Local find, Night out, Drinks, Only here, Special). The brief lists them as English brand terms. On 2026-10-18 they were deliberately translated in all 19 locales (`common.json` `themes.*`, rendered with `themeName()`): fr "Pépite", ja "穴場", vi "Góc ẩn". Kept translated until confirmed; switching back is one commit (the `themes.*` values).
- **Vietnamese "Thổ địa" for Most Local** (approved earlier, the only locale that translates it). Kept.
- **Vietnamese guests: "Vãng lai / Khách vãng lai"** instead of "Ghost" (approved earlier). Kept.
- **Taglines**: none of the 19 locales translates them as UI text; the landing pages use them in English. Nothing to flag.

## 3. City names

One display name per city per locale, **the short name when the city has one**, everywhere a person reads it: cards, story and tour headers, passport, share cards, pushes, buttons ("Play for Saigon").

| City | Latin-script locales | vi | ja | ko | zh-hans | zh-hant | th | ru | ar | hi |
|---|---|---|---|---|---|---|---|---|---|---|
| Ho Chi Minh City | **Saigon** | **Sài Gòn** | サイゴン | 사이공 | 西贡 | 西貢 | ไซง่อน | Сайгон | سايغون | साइगॉन |

- The other short names stay as in `SHORT_NAMES` (St. Petersburg, Rio, Trivandrum, Guatemala, Québec, Panamá, Kuwait).
- The official long name appears only where people search for it: city search (both names match) and SEO page titles ("Saigon (Ho Chi Minh City)").
- Implemented in `src/i18n/cityName.ts` / `apps/web/src/i18n/cityName.js`: `localizeCityName()` returns the short display name when there is one, and `CityNames::display()` does the same on the server.

## 4. Glossary

Concepts that recur across the app. **Bold** = the fixed term. Use it in every surface.

| Concept (en) | fr | vi | es | it | pt-br | pt-pt | de | nl |
|---|---|---|---|---|---|---|---|---|
| challenge (the day's, a group one) | **défi** (m) | **thử thách** | **reto** | **sfida** (f) | **desafio** | **desafio** | **Challenge** (die) | **challenge** (de) |
| photo | **photo** | **ảnh** | **foto** | **foto** | **foto** | **foto** | **Foto** | **foto** |
| city | **ville** | **thành phố** | **ciudad** | **città** | **cidade** | **cidade** | **Stadt** | **stad** |
| streak | **série** (3 jours de suite) | **chuỗi** (chuỗi 3 ngày) | **racha** | **serie** | **sequência** | **sequência** | **Serie** (3-Tage-Serie) | **reeks** |
| stamp | **tampon** | **con dấu** | **sello** | **timbro** | **carimbo** | **carimbo** | **Stempel** | **stempel** |
| passport | **passeport** | **hộ chiếu** | **pasaporte** | **passaporto** | **passaporte** | **passaporte** | **Reisepass** | **paspoort** |
| spot (a place on the map) | **spot** (m) | **địa điểm** (casual: **chỗ**) | **sitio** | **posto** | **lugar** | **sítio** | **Spot** (der) | **plek** |
| plan (Hi plan, going out) | **plan** | **kèo** | **plan** | **piano** | **rolê** | **plano** | **Plan** | **plan** |
| comment | **commentaire** | **bình luận** | **comentario** | **commento** | **comentário** | **comentário** | **Kommentar** | **reactie** |
| like (n / v) | **j'aime** / aimer | **lượt thích** / **thả tim** | **me gusta** | **mi piace** | **curtida** / curtir | **gosto** / gostar | **Like** / liken | **like** / liken |
| vote | **vote** / voter | **bình chọn** | **voto** / votar | **voto** / votare | **voto** / votar | **voto** / votar | **Stimme** / abstimmen | **stem** / stemmen |
| share | **partager** | **chia sẻ** | **compartir** | **condividere** | **compartilhar** | **partilhar** | **teilen** | **delen** |
| players | **joueurs** | **người chơi** | **jugadores** | **giocatori** | **jogadores** | **jogadores** | **Spieler** | **spelers** |
| play (for a city) | **jouer** (Joue pour Saigon) | **chơi** (Chơi cho Sài Gòn) | **jugar** (Juega por Saigon) | **giocare** (Gioca per Saigon) | **jogar** (Jogue por Saigon) | **jogar** (Joga por Saigon) | **spielen** (Spiel für Saigon) | **spelen** (Speel voor Saigon) |
| locals | **les gens du coin** / **locaux** | **dân địa phương** / **người ở đây** | **la gente local** | **la gente del posto** | **moradores** / locais | **locais** | **Locals** | **locals** |
| traveler | **voyageur** | **du khách** | **viajero** | **viaggiatore** | **viajante** | **viajante** | **Reisende** | **reiziger** |
| Represent your city | **Représente ta ville** | **Đại diện cho thành phố của bạn** | **Representa a tu ciudad** | **Rappresenta la tua città** | **Represente sua cidade** | **Representa a tua cidade** | **Vertritt deine Stadt** | **Vertegenwoordig je stad** |
| Your turn | **À toi de jouer** | **Tới lượt bạn** | **Te toca** | **Tocca a te** | **Sua vez** | **É a tua vez** | **Du bist dran** | **Jij bent aan de beurt** |
| theme | **thème** | **chủ đề** | **tema** | **tema** | **tema** | **tema** | **Thema** | **thema** |
| selfie | **selfie** | **selfie** | **selfie** | **selfie** | **selfie** | **selfie** | **Selfie** | **selfie** |

| Concept (en) | zh-hans | zh-hant | ja | ko | fil | th | id | hi | ru | ar |
|---|---|---|---|---|---|---|---|---|---|---|
| challenge | **挑战** | **挑戰** | **チャレンジ** | **챌린지** | **challenge** | **ชาเลนจ์** | **tantangan** | **चैलेंज** (m) | **челлендж** | **تحدٍّ** / التحدّي |
| photo | **照片** | **照片** | **写真** | **사진** | **photo** | **รูป** | **foto** | **फ़ोटो** | **фото** | **صورة** |
| city | **城市** | **城市** | **街** | **도시** | **city** | **เมือง** | **kota** | **शहर** | **город** | **مدينة** |
| streak | **连续打卡** (连续 3 天) | **連續紀錄** (連續 3 天) | **連続記録** (3日連続) | **연속 기록** (3일 연속) | **streak** | **ต่อเนื่อง** (3 วันติด) | **beruntun** (3 hari beruntun) | **स्ट्रीक** | **серия** (3 дня подряд) | **سلسلة** (3 أيام متتالية) |
| stamp | **印章** | **印章** | **スタンプ** | **스탬프** | **stamp** | **แสตมป์** | **stempel** | **स्टैम्प** | **штамп** | **ختم** |
| passport | **护照** | **護照** | **パスポート** | **여권** | **passport** | **พาสปอร์ต** | **paspor** | **पासपोर्ट** | **паспорт** | **جواز السفر** |
| spot | **地点** | **地點** | **スポット** | **장소** | **spot** | **ที่** / สปอต | **tempat** | **जगह** | **место** | **مكان** |
| plan | **计划** | **計畫** | **予定** | **약속** | **lakad** | **แพลน** | **rencana** | **प्लान** | **план** | **خطة** |
| comment | **评论** | **留言** | **コメント** | **댓글** | **comment** | **คอมเมนต์** | **komentar** | **कमेंट** | **комментарий** | **تعليق** |
| like | **赞** / 点赞 | **讚** / 按讚 | **いいね** | **좋아요** | **like** | **ไลก์** | **suka** | **लाइक** | **лайк** | **إعجاب** |
| vote | **投票** | **投票** | **投票** | **투표** | **vote** | **โหวต** | **vote** | **वोट** | **голос** / голосовать | **تصويت** |
| share | **分享** | **分享** | **シェア** | **공유** | **i-share** | **แชร์** | **bagikan** | **शेयर** | **поделиться** | **مشاركة** |
| players | **玩家** | **玩家** | **参加者** | **참가자** | **players** | **ผู้เล่น** | **pemain** | **खिलाड़ी** | **игроки** | **اللاعبون** |
| play (for a city) | **为西贡出战** | **為西貢出戰** | **サイゴン代表で参加** | **사이공 대표로 참여** | **Maglaro para sa Saigon** | **เล่นให้ไซง่อน** | **Main untuk Saigon** | **साइगॉन के लिए खेलें** | **Играй за Сайгон** | **العب لأجل سايغون** |
| locals | **本地人** | **在地人** | **地元の人** | **현지인** | **locals** | **คนท้องถิ่น** | **warga lokal** | **लोकल्स** | **местные** | **السكان المحليون** |
| traveler | **旅行者** | **旅人** | **旅行者** | **여행자** | **biyahero** | **นักเดินทาง** | **pelancong** | **यात्री** | **путешественник** | **مسافر** |
| Represent your city | **为你的城市出战** | **為你的城市出戰** | **自分の街を代表しよう** | **우리 도시를 대표해요** | **I-represent ang city mo** | **เป็นตัวแทนเมืองของคุณ** | **Wakili kotamu** | **अपने शहर का नाम रोशन करें** | **Представь свой город** | **مثّل مدينتك** |
| Your turn | **轮到你了** | **換你了** | **次はあなたの番** | **이제 차례예요** | **Ikaw na!** | **ตาคุณแล้ว** | **Giliranmu** | **अब आपकी बारी** | **Твой ход** | **دورك** |
| theme | **主题** | **主題** | **テーマ** | **테마** | **theme** | **ธีม** | **tema** | **थीम** | **тема** | **موضوع** |
| selfie | **自拍** | **自拍** | **自撮り** | **셀카** | **selfie** | **เซลฟี่** | **selfie** | **सेल्फ़ी** | **селфи** | **سيلفي** |

When a term reads wrong in a specific sentence (grammar, idiom), keep the meaning and mark the row `flag` in the review CSV rather than drifting to a synonym.

## 5. Per-locale rules

**en** (source)
- Sentence case, contractions ("you're", "isn't"), US spelling.
- Simple hyphen or comma instead of em dashes in UI copy.
- The English is the reference for meaning, never for word order.

**fr**
- **tu**, always.
- Typography:
  - **no-break space (U+00A0) before ? ! : ;**;
  - « guillemets » with no-break spaces inside;
  - **no em dash**: a simple hyphen " - " or a comma;
  - apostrophe ' as in the existing files.
- Natural spoken French ("Trop bien", "bosser", "On y va ?"), never anglicisms the French don't use ("Checke").
- "Spot" and "selfie" are fine, "challenge" is not (défi).

**vi**
- **bạn**, casual and warm.
- Wording natural in Saigon but understood everywhere:
  - **avoid** stiff administrative vocabulary: "Vui lòng", "Quý khách", "thực hiện", "tiến hành", "được … bởi";
  - **prefer** spoken forms: "nha" / "nhé", "nè", "luôn", "liền" (sparingly, once per string at most).
- Avoid repeating "của bạn"; drop it when the context already says whose.
- Avoid the passive "được" when an active verb works ("Ảnh đã được duyệt" → "Ảnh đã được duyệt" only in status labels; otherwise "Ảnh của bạn đã lên!").
- English loanwords young Vietnamese really use are fine: selfie, check-in, top 10, story. Do not use "challenge", "spot" or "vote" inside sentences (the glossary has the words).
- No space before ? ! :. Sentence case.
- Stacked diacritics must render: no uppercase transforms on Vietnamese text (see Fonts).

**es**
- **tú**.
- Neutral Spanish understood in Spain and Latin America: no vosotros, no regional slang ("vale", "chévere", "guay").
- Opening ¿ and ¡ always.

**it**
- **tu**.
- "sfida" is feminine (la tua sfida). Natural spoken Italian; no Anglicisms where Italian has the word.

**pt-br**
- **você**, casual Brazilian: "rolê", "curtir", "bora" (sparingly).
- Brazilian vocabulary: celular, tela, salvar.

**pt-pt**
- **tu** with European verb forms and enclitics: regista-te, junta-te.
- European vocabulary: telemóvel, ecrã, guardar, partilhar, ficheiro, utilizador. Never Brazilian forms.

**de**
- **du**.
- Typography:
  - „Anführungszeichen";
  - compounds with a hyphen when one part is English or a brand (Daily-Challenge-Foto, Spot-Liste);
  - "Pkt." for points.
- "die Challenge" (feminine). Locals / Reisende. No stiff officialese ("Bitte beachten Sie").

**nl**
- **je / jij**.
- "challenge" stays as a loanword; "u" in times means uur, not the formal you.

**zh-hans** (Mainland)
- 你.
- Full-width punctuation ，。！？：.
- A space between Chinese and Latin words or numbers (Daily Challenge 来了, 3 张照片), none around full-width punctuation.

**zh-hant** (Taiwan)
- 你; Taiwan vocabulary: 留言, 在地, 計畫, 影片, 手機.
- Full-width punctuation; spacing as zh-hans.

**ja**
- Friendly です/ます, with casual calls to action (〜しよう, 〜してみて).
- No keigo, no あなた in every sentence (drop the subject).
- Full-width 、。！？, no spaces between Japanese words.

**ko**
- 해요체. Drop 당신: Korean leaves the subject out ("차례예요!", not "당신의 차례입니다").
- No 합니다체 and no 반말.

**fil**
- Friendly **Taglish**, the way Manila users text: English nouns (challenge, photo, spot, players) with Tagalog grammar ("I-share mo", "Sali ka na!").
- ikaw / mo, no "po".

**th**
- Polite-friendly, **no** gendered particles ครับ / ค่ะ.
- No spaces between words; a space only between clauses.

**id**
- **kamu**, casual Jakarta tone (nggak, aja, yuk) but readable everywhere.
- No "Anda".

**hi**
- **आप**, friendly Hinglish where Indians really use English words (फ़ोटो, चैलेंज (m), लाइक, शेयर). Devanagari script.

**ru**
- **ты**.
- Every plural form (one / few / many / other).
- «ёлочки» quotes; the em dash is correct Russian punctuation (the French rule does not apply).

**ar**
- Modern Standard Arabic, warm and simple, second person.
- RTL: Arabic comma ، and question mark ؟; Latin brand terms embedded as is.
- All six plural forms (zero / one / two / few / many / other), with the dual and the counted-noun cases right.

## 6. Plurals, numbers, dates

- Every string with a count has plural forms (`key_one`, `key_other`, plus the locale's own: ru few/many, ar zero/two/few/many). Never "1 players", never "photo(s)".
- Numbers, decimals, distances and currencies go through `Intl` with the UI language: 1,5 km in fr / de / vi / es / it / pt / nl / id / ru, 1.5 km in en / ja / zh / ko / th / hi / fil / ar(Latin digits).
- Dates and relative times: `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` with the UI language (app on Hermes: `common:time.*` keys, with plural forms).

## 7. Fonts

- Latin-script locales (vi included) use Be Vietnam Pro. It has every Vietnamese glyph, but stacked capitals (Ẫ, Ễ, Ổ) rise 15% above its line box.
- Give text a line height of at least 1.25× the font size, and no `textTransform: 'uppercase'` on translated text. The Android Text clips anything above the line box.
- Other scripts use the system font (SF, Roboto, Noto): Cyrillic, Thai, Arabic, Devanagari, CJK.

## 8. Daily challenge content

Same voice and glossary. Field limits, the prompt and the review loop are in `docs/daily-challenge/TRANSLATION.md`.
