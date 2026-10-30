# City switcher (app namespace `cities`): strings to check, per locale

# cities: flags for a native (fr, vi, es, it, pt-br, pt-pt, de, nl, fil)

- all, filterEvents: English source "🎉 Most Local Events" reads as the Most Local brand; the chip sorts by event count, so all locales say "most events". The English should probably be "🎉 Most events".
- all, playsIn: rewritten as "you play for {{city}}" (glossary play-for verb) on a search result that counts for a nearby bigger city. Check it reads as an explanation, not a CTA (zh/ja use "counts for").
- all, topCities: "Top cities right now" written as "cities of the moment" (fr/es/it/pt-pt), "trending" (pt-br, de) or "most popular" (nl). Check it still fits under any of the 4 filters.
- fr, filterOnline: "🟢 Plus de monde en ligne" is the longest chip in the row; "🟢 Les plus connectées" is a shorter alternative.
- vi, online / filterOnline: "đang online" / "Đông người online nhất" (loanword) instead of the stiff "trực tuyến"; confirm.
- vi, hangout: "{{count}} buổi tụ tập" (needs a classifier). Check it against the hangout word used elsewhere in vi.
- es, hangout: "quedada" is Spain-flavored; LatAm readers may prefer "junta" or "plan" (neutral Spanish rule).
- es, msgs: "msj / msjs" (Latin American texting abbreviation); Spain readers write "mens." or "msg".
- pt-br, hangout: "rolê" is also the glossary word for plan (Hi plan); hangouts and plans share one word in pt-br.
- de, msgs: "Nachr." is correct but stiff; there is no casual short German form, and "Nachrichten" may be too long for the stats row.
- nl, msgs: "ber." replaced with the full "bericht/berichten" for clarity; check the stats row still fits.
- nl, filterEvents: "🎉 Meeste evenementen" is long for a chip; consider "🎉 Meeste events".
- fil: every "lungsod" replaced with "city" (glossary); plurals unified as singular nouns ("{{count}} challenge"), as in the recent fil review.
- fil, msgs: kept "mensahe"; "msg" or "message" may read more natural in Taglish.

# City switcher, locales B: strings to check with a native

- all locales `playsIn`: now the glossary "play for {{city}}" (zh 为/為{{city}}出战, ja {{city}}代表で参加, ko {{city}} 대표로 참여, th เล่นให้, id Main untuk, hi के लिए खेलें, ru Играешь за, ar تلعب لأجل) on a search result meaning "picking this plays for {{city}}"; confirm it reads as a row caption, not an order.
- ar plurals (challenges, members, events, hangout, msgs): zero now "لا …" without the number, one/two without the number (تحدٍّ واحد / تحدّيان); rows only show counts > 0, check many forms (تحدّيًا، عضوًا، لقاءً).
- ar `online`: "متصل الآن: {{count}}" to avoid number agreement on a non-plural key; a native may prefer another shape.
- ru plurals: `other` (fractions) set to genitive singular (челленджа, участника, события, тусовки, сообщения); msgs now full "сообщение/я/й" instead of "сообщ.", check it fits the row.
- ru `changeLimit`: rewritten "На сегодня лимит смены города исчерпан" to avoid the gendered "менял".
- ru `backToLocation` / `useMyLocation`: shortened to "геопозиция" wording; check length on a 360 dp row.
- hi `hangout`: other "मुलाक़ातें" (real plural), other loanword counts unchanged in both forms.
- hi `firstTimeTitle`: चुनो → चुनें to keep आप.
- ja filter chips now all "〜順" (アクティブ順, オンラインが多い順…); `youreHere` chip "今ここ" instead of あなたはここにいます.
- ko filter chips all "〜 순"; `youreHere` chip "지금 여기".
- th `events` count now อีเวนต์ (matching the filter chip) instead of กิจกรรม; `members` "สมาชิก {{count}} คน".
- zh-hans/zh-hant `topCities`: 此刻最热闹 / 現在最熱鬧 instead of 最活跃/最熱門; check tone vs the 🔥 最活跃 chip.
- id casual tone (rame, nggak ketemu, nemuin): confirm level of slang is fine on a list screen.
