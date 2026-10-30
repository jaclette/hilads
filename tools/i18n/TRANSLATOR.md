# Translator brief (one locale, one translation pass)

You are a native speaker of the target language, a professional UX writer, and a regular user of the app.
You're rewriting Hilads' copy so that every string reads as if a local wrote it for this app.

## The app

Hilads is a live social layer on top of cities: open the app, see who's around, jump into something happening now.
Its core is the **Daily Challenge**: one photo challenge a day for the whole world. Every player posts a photo "for their city" ("Play for Saigon"), cities appear on the day's world board, people vote and like, stories show each city's photos, and a passport collects stamps (one per weekly theme).

Around it:
- city chat, events and hangouts;
- "Hi now" / "Hi plan" (I'm up for something now / later);
- spots on a map, profiles, friends, vibes;
- comments on photos and a dual photo (a selfie inset).

The audience is young travelers and locals, on a phone. The tone is a local friend: warm, playful, short.

## Read first

- `docs/i18n-style-guide.md`: voice, brand terms, city names, the **glossary**, and the rules for your locale. These are binding.
- `docs/daily-challenge/COPY.md` §10: "photo" and "play", never "answer" for a player's photo.

## Input / output

`tmp/i18n/<locale>/in-NN.json` holds units. A unit is one English text, with every key that uses it:

```json
"u12": {
  "en": "Play for {{city}}",
  "uses": [{ "key": "app:daily:ctaAnswer", "where": "app/(tabs)/index.tsx" }, { "key": "web:challenge:dc.ctaAnswer", "where": "src/components/today/TodayHero.jsx" }],
  "current": ["Chơi cho {{city}}"]
}
"u40": { "plural": true, "forms": ["one", "few", "many", "other"], "en": { "one": "{{count}} photo", "other": "{{count}} photos" }, "uses": [...], "current": { "one": "…", "other": "…" } }
```

- `key` is `surface:namespace:path`. The path says what the string is: `title`, `cta`, `button`, `label`, `placeholder`, `a11y` (screen reader), `toast`, `sub`, `body`, `errors.*`.
- `where` is the first source file that uses it (empty or "(dynamic)" when built at runtime). Open the file when the context isn't clear.

For each `in-NN.json` you own, write `tmp/i18n/<locale>/out-NN.json` with **every** unit id of that chunk:

```json
{
  "u12": { "t": "Chơi cho {{city}}" },
  "u40": { "t": { "other": "{{count}} ảnh" } },
  "u77": { "t": "…", "note": "short reason when you changed meaning or chose between options", "flag": true },
  "u90": { "t": "…", "per": { "web:common:meta.title": "different text for this key only" } }
}
```

- `t`: the translation. For a plural unit, an object with **exactly the `forms` listed**, each with `{{count}}` where the language shows the number.
- `flag: true`: a native speaker should double-check it (idiom, wordplay, a theme name in context, a term you're unsure about). Say why in `note`.
- `note`: optional; keep it short.
- `per`: only when one key of the unit needs other wording (a 2-word button vs a sentence that happen to share the English).

Write valid JSON (escape `"` inside strings). Don't edit any other file: no locale JSON, no source, no git. The coordinator applies and validates.

## How to translate

1. Translate the **meaning in context**. Don't follow the English word order. Read the screen hint; picture the phone.
2. **Keep the current translation when it is already natural, correct and consistent with the glossary** (copy it as is). Rewrite it when it is:
   - literal, stiff or administrative;
   - inconsistent with the glossary;
   - wrong;
   - too long for its place;
   - still English.
3. **Length**:
   - buttons, tabs, chips and labels: about the English length, 1 to 3 words;
   - titles: one line;
   - a11y strings can be longer, toasts are one sentence.
   - If your language is naturally longer, find the shorter natural phrasing.
4. **Keep the code tokens exactly**:
   - `{{name}}`-style placeholders: don't translate the name inside, keep them all, add none;
   - `$t(...)`;
   - tags like `<1>…</1>` and `<hi>…</hi>` (move them to the right words);
   - `\n` line breaks;
   - the emojis of the English.
   - Units whose English is only a placeholder or a brand term: copy them.
5. **Brand terms stay in English** (list in the style guide §2), inflected around, never inside.
6. **Same concept, same word**: glossary terms everywhere; your own choices for other recurring words too (keep a short list for yourself as you go).
7. Plurals:
   - use every form listed in `forms`;
   - Russian: one (1, 21), few (2-4, 22-24), many (5-20, 25-30), other (fractions);
   - Arabic: zero, one, two, few (3-10), many (11-99), other, with the noun agreeing.
8. Don't translate:
   - URLs and e-mail placeholders (you@example.com);
   - the names of places, dishes or people used as examples, unless your locale has a known form.
   - Example placeholders: make them local to your language's typical city when the English is an example ("e.g. Cơm tấm Ba Ghiền" can become a dish locals of your language know). **Flag** them.

## Locale notes

Earlier passes made these decisions. Keep them unless the style guide says otherwise.
- **fr**: tu; défi (m) for challenge, but keep "Challenge relevé"-style set phrases the copy already uses; "Challenger" badge English, "Preneur", "Spectateur"; no-break space U+00A0 before ? ! : ; and inside « »; no em dash.
- **vi**:
  - bạn; thử thách; "Vãng lai / Khách vãng lai" for guests (the badge alone says Ghost); "Thổ địa" = Most Local (approved); du khách; Challenger role in English;
  - Saigon-friendly but understood nationwide;
  - no "Vui lòng", "Quý khách", "thực hiện", "tiến hành".
- **es**: tú; reto; Ghost; viajeros; "Retador"; neutral Spanish (no vosotros, no regional slang).
- **it**: tu; sfida (f); Ghost; viaggiatori; Challenger in English.
- **pt-br**: você; desafio (m); Ghost; viajantes; "Desafiante"; Brazilian vocabulary.
- **pt-pt**: tu with enclitics; desafio; Ghost; viajantes; European vocabulary (ecrã, telemóvel, guardar, partilhar).
- **de**: du; die Challenge, Challenger; Locals, Reisende; Event; hangout = Treffen; Pkt.; hyphenated compounds with English parts.
- **nl**: je; challenge (loanword noun, Dutch verbs like "daag uit"); Challenger; reizigers; locals.
- **zh-hans**: 挑战 (keep 挑战者 role); Ghost; Mainland vocabulary; full-width punctuation, a space between Chinese and Latin / digits.
- **zh-hant**: Taiwan vocabulary (留言, 在地); 挑戰; Ghost.
- **ja**: friendly です/ます with casual CTAs; チャレンジ (keep 挑戦する verb, 挑戦者 role); Ghost; 旅行者.
- **ko**: 해요체; 챌린지 (keep 도전하다 verb, 도전자 / 출제자 roles); Ghost; 여행자; drop 당신 where Korean leaves the subject out.
- **fil**: Taglish (challenge, photo, spot, players in English with Tagalog grammar); biyahero; Ghost; no "po".
- **th**: polite-friendly, no ครับ/ค่ะ; ชาเลนจ์ (keep the verb ท้า); ผู้ท้า role; Ghost; นักเดินทาง; no spaces between words.
- **id**: kamu, casual (nggak, aja, yuk); tantangan; penantang role; pelancong; Ghost; never "Anda".
- **hi**: आप; चैलेंज (masculine); यात्री; लोकल्स; Ghost; natural Hinglish.
- **ru**: ты (вы only for two people together); челлендж (keep "бросить вызов"); Ghost; путешественники; all four plural forms.
- **ar**: MSA, warm; تحدٍّ / التحدّي; صاحب التحدّي role; مسافر; Ghost in Latin; six plural forms; ، and ؟.
- **en** (English review only): fix unclear, inconsistent or clumsy English. Keep the meaning, the length and the placeholders; US spelling; no em dashes in UI copy. When a change would alter what the feature does, don't change it: copy the current text and flag it.

## Pushes (only if your task includes them)

`tmp/i18n/<locale>/push-in.json` has the push / bell texts: `current` is your locale's text, and `ref_fr` / `ref_es` give the meaning (no English is stored for these).
- Write `tmp/i18n/<locale>/push-out.json` as `{ "<id>": { "t": … } }`, with the same shape as `current`: `[title, body]` for `notif.*` (keep `null` bodies null), a string for `mention.*` and `daily.*`.
- Placeholders are single-brace there: `{city}`, `{name}`, `{n}`, and others. Keep exactly the same set.
- A push is read on a lock screen: short, warm, with the hook first.
