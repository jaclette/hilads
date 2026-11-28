<?php

declare(strict_types=1);

require_once __DIR__ . '/Ordinal.php';

/**
 * Localized notification text (push + in-app bell).
 *
 * render($type, $locale, $data) returns [title, body] for the recipient's
 * locale, or [null, null] to mean "keep the caller's English text" - which is
 * the case for English/unknown locales and for any field we don't translate
 * (message previews and proper nouns like event/venue/city names stay as-is).
 *
 * Only fr/vi/es/it/pt-br/pt-pt/de/nl/zh-hans/zh-hant/ja/ko/fil/th/id/hi/ru/ar are translated; English is the source of truth in the call sites.
 * Conventions (match the app i18n rules): "tu" form; the brand word "vibe"
 * stays English.
 */
final class NotificationI18n
{
    private const SUPPORTED = ['fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar'];

    // [type][locale] => [titleTemplate, bodyTemplate|null]
    // bodyTemplate null ⇒ keep the caller's body (preview / proper nouns / no body).
    // Scoring v2 (docs/scoring-v2-audit.md): [type][variant][locale] => [title, body]. The
    // variant is $data['variant'] (else 'default'); 'en' is the source (call sites use
    // NotificationI18n::scoring($type, 'en', $data)). Placeholders: {rank} {points} {gap}
    // {prev} {days} {medal} {name} {count} {max}, plus {rank_ordinal} {prev_ordinal} (a rank is
    // never "#3": Ordinal::format in the recipient's language).
    private const SCORING = [
        'daily_season_result' => [
            'medal' => [
                'en'      => ["{medal} You finished {rank_ordinal} this season!", "Your season medal is on your Passport. A new season starts now."],
                'fr'      => ["{medal} Tu finis {rank_ordinal} de la saison !", "Ta médaille de saison est sur ton Passeport. Une nouvelle saison commence."],
                'vi'      => ["{medal} Bạn về {rank_ordinal} mùa này!", "Huy chương mùa đã có trong Hộ chiếu của bạn. Mùa mới bắt đầu rồi."],
                'es'      => ["{medal} ¡Terminas la temporada en {rank_ordinal} lugar!", "Tu medalla de temporada está en tu Pasaporte. Empieza una nueva temporada."],
                'it'      => ["{medal} Stagione chiusa: {rank_ordinal} posto!", "La tua medaglia di stagione è sul tuo Passaporto. Inizia una nuova stagione."],
                'pt-br'   => ["{medal} Você terminou a temporada em {rank_ordinal} lugar!", "Sua medalha da temporada está no seu Passaporte. Uma nova temporada começa agora."],
                'pt-pt'   => ["{medal} Terminaste a temporada em {rank_ordinal} lugar!", "A tua medalha da temporada está no teu Passaporte. Começa agora uma nova temporada."],
                'de'      => ["{medal} Du beendest die Saison auf dem {rank_ordinal} Platz!", "Deine Saisonmedaille ist in deinem Reisepass. Jetzt startet eine neue Saison."],
                'nl'      => ["{medal} Je eindigt het seizoen als {rank_ordinal}!", "Je seizoensmedaille staat in je Paspoort. Er begint nu een nieuw seizoen."],
                'zh-hans' => ["{medal} 本赛季你获得{rank_ordinal}！", "赛季奖牌已放进你的护照。新赛季现在开始。"],
                'zh-hant' => ["{medal} 本賽季你拿下{rank_ordinal}！", "賽季獎牌已放進你的護照。新賽季現在開始。"],
                'ja'      => ["{medal} 今シーズン {rank_ordinal}でフィニッシュ！", "シーズンメダルがパスポートに届いたよ。新しいシーズンがスタート。"],
                'ko'      => ["{medal} 이번 시즌 {rank_ordinal}로 마무리!", "시즌 메달이 여권에 추가됐어요. 새 시즌이 시작됐어요."],
                'fil'     => ["{medal} Natapos mo ang season bilang {rank_ordinal}!", "Nasa Passport mo na ang season medal mo. Magsisimula na ang bagong season."],
                'th'      => ["{medal} ซีซันนี้คุณจบ{rank_ordinal}!", "เหรียญประจำซีซันอยู่ในพาสปอร์ตของคุณแล้ว ซีซันใหม่เริ่มแล้ว"],
                'id'      => ["{medal} Kamu finis di peringkat {rank_ordinal} musim ini!", "Medali musimmu sudah ada di Paspor. Musim baru dimulai sekarang."],
                'hi'      => ["{medal} इस सीज़न आपका स्थान {rank_ordinal} रहा!", "आपका सीज़न मेडल आपके पासपोर्ट में है। नया सीज़न अभी शुरू हुआ।"],
                'ru'      => ["{medal} Итог сезона: ты {rank_ordinal}!", "Медаль сезона уже в твоём паспорте. Начинается новый сезон."],
                'ar'      => ["{medal} أنهيت الموسم في المركز {rank_ordinal}!", "ميدالية الموسم في جواز سفرك الآن. يبدأ موسم جديد."],
            ],
            'default' => [
                'en'      => ["Season results", "You finished {rank_ordinal} with {points} pts. A new season starts now."],
                'fr'      => ["Résultats de la saison", "Tu finis {rank_ordinal} avec {points} pts. Une nouvelle saison commence."],
                'vi'      => ["Kết quả mùa giải", "Bạn về {rank_ordinal} với {points} điểm. Mùa mới bắt đầu rồi."],
                'es'      => ["Resultados de la temporada", "Terminas en {rank_ordinal} lugar con {points} pts. Empieza una nueva temporada."],
                'it'      => ["Risultati della stagione", "Stagione chiusa: {rank_ordinal} posto con {points} punti. Inizia una nuova stagione."],
                'pt-br'   => ["Resultados da temporada", "Você terminou em {rank_ordinal} lugar com {points} pts. Uma nova temporada começa agora."],
                'pt-pt'   => ["Resultados da temporada", "Terminaste em {rank_ordinal} lugar com {points} pts. Começa agora uma nova temporada."],
                'de'      => ["Saisonergebnis", "Du landest mit {points} Pkt. auf dem {rank_ordinal} Platz. Jetzt startet eine neue Saison."],
                'nl'      => ["Seizoensuitslag", "Je eindigt als {rank_ordinal} met {points} ptn. Er begint nu een nieuw seizoen."],
                'zh-hans' => ["赛季结果", "你以 {points} 分获得{rank_ordinal}。新赛季现在开始。"],
                'zh-hant' => ["賽季結果", "你以 {points} 分拿下{rank_ordinal}。新賽季現在開始。"],
                'ja'      => ["シーズン結果", "{points} pt で {rank_ordinal}でフィニッシュ。新しいシーズンがスタート。"],
                'ko'      => ["시즌 결과", "{points}점으로 {rank_ordinal}를 했어요. 새 시즌이 시작됐어요."],
                'fil'     => ["Resulta ng season", "Natapos ka bilang {rank_ordinal} na may {points} pts. Magsisimula na ang bagong season."],
                'th'      => ["ผลซีซัน", "คุณจบ{rank_ordinal} ด้วย {points} แต้ม ซีซันใหม่เริ่มแล้ว"],
                'id'      => ["Hasil musim", "Kamu finis di peringkat {rank_ordinal} dengan {points} poin. Musim baru dimulai sekarang."],
                'hi'      => ["सीज़न के नतीजे", "{points} पॉइंट्स के साथ आपका स्थान {rank_ordinal} रहा। नया सीज़न अभी शुरू हुआ।"],
                'ru'      => ["Итоги сезона", "Ты {rank_ordinal} с {points} очками. Начинается новый сезон."],
                'ar'      => ["نتائج الموسم", "أنهيت في المركز {rank_ordinal} بـ {points} نقطة. يبدأ موسم جديد."],
            ],
        ],
        'daily_season_ending' => [
            'first' => [
                'en'      => ["Season ends in {days} days ⏳", "You're in first place. Hold on to it!"],
                'fr'      => ["Fin de saison dans {days} jours ⏳", "Tu es à la première place. Ne lâche rien !"],
                'vi'      => ["Mùa giải kết thúc sau {days} ngày ⏳", "Bạn đang dẫn đầu. Giữ vững nhé!"],
                'es'      => ["La temporada acaba en {days} días ⏳", "Vas en primer lugar. ¡Que no te lo quiten!"],
                'it'      => ["La stagione finisce tra {days} giorni ⏳", "Sei al primo posto. Tieni duro!"],
                'pt-br'   => ["A temporada acaba em {days} dias ⏳", "Você está em primeiro lugar. Segura essa!"],
                'pt-pt'   => ["A temporada acaba daqui a {days} dias ⏳", "Estás em primeiro lugar. Não largues!"],
                'de'      => ["Die Saison endet in {days} Tagen ⏳", "Du bist auf dem ersten Platz. Halt durch!"],
                'nl'      => ["Het seizoen eindigt over {days} dagen ⏳", "Je staat op de eerste plaats. Hou vol!"],
                'zh-hans' => ["赛季还剩 {days} 天 ⏳", "你现在是第一名，守住它！"],
                'zh-hant' => ["賽季還剩 {days} 天 ⏳", "你現在是第一名，守住它！"],
                'ja'      => ["シーズン終了まであと{days}日 ⏳", "いま 1位！このままキープしよう！"],
                'ko'      => ["시즌 종료까지 {days}일 ⏳", "지금 1위예요. 끝까지 지켜요!"],
                'fil'     => ["{days} araw na lang ang season ⏳", "Ikaw ang nangunguna. Panatilihin mo!"],
                'th'      => ["อีก {days} วันซีซันจะจบ ⏳", "ตอนนี้คุณอยู่อันดับหนึ่ง รักษาไว้ให้ได้!"],
                'id'      => ["Musim berakhir dalam {days} hari ⏳", "Kamu di posisi pertama. Pertahankan!"],
                'hi'      => ["सीज़न {days} दिन में ख़त्म ⏳", "आप पहले स्थान पर हैं। बने रहिए!"],
                'ru'      => ["До конца сезона {days} дн. ⏳", "Ты на первом месте. Удержи позицию!"],
                'ar'      => ["ينتهي الموسم خلال {days} أيام ⏳", "أنت في المركز الأول. حافظ عليه!"],
            ],
            'default' => [
                'en'      => ["Season ends in {days} days ⏳", "You're {rank_ordinal}, {gap} pts from {prev_ordinal} place. Play every day to climb."],
                'fr'      => ["Fin de saison dans {days} jours ⏳", "Tu es {rank_ordinal}, à {gap} pts du {prev_ordinal}. Joue chaque jour pour grimper."],
                'vi'      => ["Mùa giải kết thúc sau {days} ngày ⏳", "Bạn đang {rank_ordinal}, còn {gap} điểm nữa là lên {prev_ordinal}. Chơi mỗi ngày để leo hạng."],
                'es'      => ["La temporada acaba en {days} días ⏳", "Vas en {rank_ordinal} lugar, a {gap} pts del {prev_ordinal}. Juega cada día para subir."],
                'it'      => ["La stagione finisce tra {days} giorni ⏳", "Sei {rank_ordinal}, a {gap} punti da chi è {prev_ordinal}. Gioca ogni giorno per salire."],
                'pt-br'   => ["A temporada acaba em {days} dias ⏳", "Você está em {rank_ordinal} lugar, a {gap} pts do {prev_ordinal}. Jogue todo dia para subir."],
                'pt-pt'   => ["A temporada acaba daqui a {days} dias ⏳", "Estás em {rank_ordinal} lugar, a {gap} pts do {prev_ordinal}. Joga todos os dias para subir."],
                'de'      => ["Die Saison endet in {days} Tagen ⏳", "Du bist auf dem {rank_ordinal} Platz, {gap} Pkt hinter dem {prev_ordinal} Platz. Spiel jeden Tag, um aufzusteigen."],
                'nl'      => ["Het seizoen eindigt over {days} dagen ⏳", "Je staat {rank_ordinal}, {gap} ptn achter de {prev_ordinal}. Speel elke dag om te stijgen."],
                'zh-hans' => ["赛季还剩 {days} 天 ⏳", "你排{rank_ordinal}，离{prev_ordinal}还差 {gap} 分。每天玩就能往上爬。"],
                'zh-hant' => ["賽季還剩 {days} 天 ⏳", "你排{rank_ordinal}，離{prev_ordinal}還差 {gap} 分。每天玩就能往上爬。"],
                'ja'      => ["シーズン終了まであと{days}日 ⏳", "いま {rank_ordinal}、{prev_ordinal}まであと {gap} pt。毎日プレイして上を目指そう。"],
                'ko'      => ["시즌 종료까지 {days}일 ⏳", "지금 {rank_ordinal}, {prev_ordinal}까지 {gap}점. 매일 플레이해서 올라가요."],
                'fil'     => ["{days} araw na lang ang season ⏳", "Ikaw ay {rank_ordinal}, {gap} pts mula sa {prev_ordinal}. Maglaro araw-araw para umakyat."],
                'th'      => ["อีก {days} วันซีซันจะจบ ⏳", "คุณ{rank_ordinal} ห่าง{prev_ordinal} อยู่ {gap} แต้ม เล่นทุกวันเพื่อไต่อันดับ"],
                'id'      => ["Musim berakhir dalam {days} hari ⏳", "Kamu di peringkat {rank_ordinal}, {gap} poin dari peringkat {prev_ordinal}. Main tiap hari untuk naik."],
                'hi'      => ["सीज़न {days} दिन में ख़त्म ⏳", "आपका स्थान {rank_ordinal} है। {gap} पॉइंट्स और मिलें तो स्थान {prev_ordinal} होगा। ऊपर चढ़ने के लिए रोज़ खेलें।"],
                'ru'      => ["До конца сезона {days} дн. ⏳", "Ты {rank_ordinal}, а {prev_ordinal} впереди всего на {gap} очк. Играй каждый день, чтобы подняться."],
                'ar'      => ["ينتهي الموسم خلال {days} أيام ⏳", "أنت في المركز {rank_ordinal}، تفصلك {gap} نقطة عن المركز {prev_ordinal}. العب كل يوم لتتقدّم."],
            ],
        ],
        'daily_perfect_week' => [
            'default' => [
                'en'      => ["Perfect week! 🔥 +{points}", "You played all 7 days this week."],
                'fr'      => ["Semaine parfaite ! 🔥 +{points}", "Tu as joué les 7 jours de la semaine."],
                'vi'      => ["Tuần hoàn hảo! 🔥 +{points}", "Bạn đã chơi đủ 7 ngày trong tuần."],
                'es'      => ["¡Semana perfecta! 🔥 +{points}", "Has jugado los 7 días de la semana."],
                'it'      => ["Settimana perfetta! 🔥 +{points}", "Hai giocato tutti i 7 giorni della settimana."],
                'pt-br'   => ["Semana perfeita! 🔥 +{points}", "Você jogou os 7 dias da semana."],
                'pt-pt'   => ["Semana perfeita! 🔥 +{points}", "Jogaste os 7 dias da semana."],
                'de'      => ["Perfekte Woche! 🔥 +{points}", "Du hast an allen 7 Tagen der Woche gespielt."],
                'nl'      => ["Perfecte week! 🔥 +{points}", "Je hebt alle 7 dagen van de week gespeeld."],
                'zh-hans' => ["完美一周！🔥 +{points}", "这周 7 天你天天都玩了。"],
                'zh-hant' => ["完美一週！🔥 +{points}", "這週 7 天你天天都玩了。"],
                'ja'      => ["パーフェクトウィーク！🔥 +{points}", "今週7日間ぜんぶプレイしたね。"],
                'ko'      => ["퍼펙트 위크! 🔥 +{points}", "이번 주 7일 모두 플레이했어요."],
                'fil'     => ["Perfect week! 🔥 +{points}", "Naglaro ka sa lahat ng 7 araw ngayong linggo."],
                'th'      => ["สัปดาห์สมบูรณ์แบบ! 🔥 +{points}", "คุณเล่นครบทั้ง 7 วันในสัปดาห์นี้"],
                'id'      => ["Minggu sempurna! 🔥 +{points}", "Kamu main 7 hari penuh minggu ini."],
                'hi'      => ["परफ़ेक्ट वीक! 🔥 +{points}", "आपने इस हफ़्ते सातों दिन खेला।"],
                'ru'      => ["Идеальная неделя! 🔥 +{points}", "Ты играл все 7 дней на этой неделе."],
                'ar'      => ["أسبوع مثالي! 🔥 +{points}", "لعبت كل أيام الأسبوع السبعة."],
            ],
        ],
        'daily_friend_joined' => [
            'default' => [
                'en'      => ["{name} posted their first photo 🤝 +{points}", "{count}/{max} friends this season."],
                'fr'      => ["{name} a posté sa première photo 🤝 +{points}", "{count}/{max} amis cette saison."],
                'vi'      => ["{name} đã đăng ảnh đầu tiên 🤝 +{points}", "{count}/{max} bạn mùa này."],
                'es'      => ["{name} publicó su primera foto 🤝 +{points}", "{count}/{max} amigos esta temporada."],
                'it'      => ["{name} ha pubblicato la prima foto 🤝 +{points}", "{count}/{max} amici in questa stagione."],
                'pt-br'   => ["{name} postou a primeira foto 🤝 +{points}", "{count}/{max} amigos nesta temporada."],
                'pt-pt'   => ["{name} publicou a primeira foto 🤝 +{points}", "{count}/{max} amigos nesta temporada."],
                'de'      => ["{name} hat das erste Foto gepostet 🤝 +{points}", "{count}/{max} Freunde diese Saison."],
                'nl'      => ["{name} plaatste de eerste foto 🤝 +{points}", "{count}/{max} vrienden dit seizoen."],
                'zh-hans' => ["{name} 发了第一张照片 🤝 +{points}", "本赛季 {count}/{max} 位朋友。"],
                'zh-hant' => ["{name} 發了第一張照片 🤝 +{points}", "本賽季 {count}/{max} 位朋友。"],
                'ja'      => ["{name}さんが初めての写真を投稿 🤝 +{points}", "今シーズン {count}/{max} 人。"],
                'ko'      => ["{name} 님이 첫 사진을 올렸어요 🤝 +{points}", "이번 시즌 {count}/{max}명."],
                'fil'     => ["Nag-post si {name} ng unang photo 🤝 +{points}", "{count}/{max} kaibigan ngayong season."],
                'th'      => ["{name} โพสต์รูปแรกแล้ว 🤝 +{points}", "ซีซันนี้ {count}/{max} คน"],
                'id'      => ["{name} memposting foto pertamanya 🤝 +{points}", "{count}/{max} teman musim ini."],
                'hi'      => ["{name} ने पहली फ़ोटो पोस्ट की 🤝 +{points}", "इस सीज़न {count}/{max} दोस्त।"],
                'ru'      => ["{name} выложил первое фото 🤝 +{points}", "{count}/{max} друзей в этом сезоне."],
                'ar'      => ["نشر {name} أول صورة 🤝 +{points}", "{count}/{max} أصدقاء هذا الموسم."],
            ],
        ],
        'daily_friend_signed_up' => [
            'default' => [
                'en'      => ["{name} joined Hilads with your link 🎉", "When they post their first photo, you get +{points}."],
                'fr'      => ["{name} a rejoint Hilads avec ton lien 🎉", "Dès sa première photo, tu gagnes +{points}."],
                'vi'      => ["{name} đã tham gia Hilads qua link của bạn 🎉", "Khi bạn ấy đăng ảnh đầu tiên, bạn được +{points}."],
                'es'      => ["{name} se unió a Hilads con tu enlace 🎉", "Cuando publique su primera foto, ganas +{points}."],
                'it'      => ["{name} è entrato su Hilads con il tuo link 🎉", "Quando pubblica la sua prima foto, guadagni +{points}."],
                'pt-br'   => ["{name} entrou no Hilads pelo seu link 🎉", "Quando postar a primeira foto, você ganha +{points}."],
                'pt-pt'   => ["{name} juntou-se ao Hilads com o teu link 🎉", "Quando publicar a primeira foto, ganhas +{points}."],
                'de'      => ["{name} ist über deinen Link bei Hilads 🎉", "Sobald das erste Foto da ist, bekommst du +{points}."],
                'nl'      => ["{name} doet mee met Hilads via jouw link 🎉", "Zodra de eerste foto online staat, krijg je +{points}."],
                'zh-hans' => ["{name} 通过你的链接加入了 Hilads 🎉", "对方发出第一张照片后，你将获得 +{points}。"],
                'zh-hant' => ["{name} 透過你的連結加入了 Hilads 🎉", "對方發出第一張照片後，你將獲得 +{points}。"],
                'ja'      => ["{name}さんがあなたのリンクからHiladsに参加 🎉", "最初の写真を投稿したら、あなたに +{points}。"],
                'ko'      => ["{name} 님이 내 링크로 Hilads에 가입했어요 🎉", "첫 사진을 올리면 +{points}을 받아요."],
                'fil'     => ["Sumali si {name} sa Hilads gamit ang link mo 🎉", "Pag nag-post siya ng unang photo, +{points} ka."],
                'th'      => ["{name} เข้าร่วม Hilads ผ่านลิงก์ของคุณ 🎉", "เมื่อเขาโพสต์รูปแรก คุณจะได้ +{points}"],
                'id'      => ["{name} gabung ke Hilads lewat link-mu 🎉", "Saat dia memposting foto pertamanya, kamu dapat +{points}."],
                'hi'      => ["{name} आपके लिंक से Hilads से जुड़े 🎉", "उनकी पहली फ़ोटो पोस्ट होते ही आपको +{points} मिलेंगे।"],
                'ru'      => ["{name} пришёл в Hilads по твоей ссылке 🎉", "Когда друг выложит первое фото, ты получишь +{points}."],
                'ar'      => ["انضم {name} إلى Hilads عبر رابطك 🎉", "عندما ينشر أول صورة، تحصل على +{points}."],
            ],
        ],
        'daily_crew_bonus' => [
            'default' => [
                'en'      => ["Your crew is complete! 🎉 +{points}", "{max} friends joined you this season."],
                'fr'      => ["Ton crew est au complet ! 🎉 +{points}", "{max} amis t'ont rejoint cette saison."],
                'vi'      => ["Hội của bạn đã đủ! 🎉 +{points}", "{max} người bạn đã tham gia cùng bạn mùa này."],
                'es'      => ["¡Tu crew está completo! 🎉 +{points}", "{max} amigos se unieron a ti esta temporada."],
                'it'      => ["La tua crew è al completo! 🎉 +{points}", "{max} amici si sono uniti a te in questa stagione."],
                'pt-br'   => ["Sua crew está completa! 🎉 +{points}", "{max} amigos entraram com você nesta temporada."],
                'pt-pt'   => ["A tua crew está completa! 🎉 +{points}", "{max} amigos juntaram-se a ti nesta temporada."],
                'de'      => ["Deine Crew ist komplett! 🎉 +{points}", "{max} Freunde sind dir diese Saison gefolgt."],
                'nl'      => ["Je crew is compleet! 🎉 +{points}", "{max} vrienden deden dit seizoen met je mee."],
                'zh-hans' => ["你的小队集齐了！🎉 +{points}", "本赛季有 {max} 位朋友加入了你。"],
                'zh-hant' => ["你的小隊集齊了！🎉 +{points}", "本賽季有 {max} 位朋友加入了你。"],
                'ja'      => ["クルーがそろった！🎉 +{points}", "今シーズン {max} 人の友だちが参加してくれたよ。"],
                'ko'      => ["크루 완성! 🎉 +{points}", "이번 시즌 친구 {max}명이 함께했어요."],
                'fil'     => ["Kumpleto na ang crew mo! 🎉 +{points}", "{max} kaibigan ang sumali sa iyo ngayong season."],
                'th'      => ["แก๊งของคุณครบแล้ว! 🎉 +{points}", "ซีซันนี้มีเพื่อน {max} คนมาร่วมกับคุณ"],
                'id'      => ["Kru kamu lengkap! 🎉 +{points}", "{max} teman bergabung denganmu musim ini."],
                'hi'      => ["आपका क्रू पूरा हो गया! 🎉 +{points}", "इस सीज़न {max} दोस्त आपसे जुड़े।"],
                'ru'      => ["Твоя команда в сборе! 🎉 +{points}", "{max} друзей присоединились к тебе в этом сезоне."],
                'ar'      => ["اكتمل فريقك! 🎉 +{points}", "انضم إليك {max} أصدقاء هذا الموسم."],
            ],
        ],
    ];

    private const T = [
        // Hilads campaign challenge push (2× points). {title} = the challenge
        // title (verbatim). Body ends with an "Are you in?" hook. English
        // recipients get the caller's fallback text (already interpolated).
        'campaign_challenge' => [
            'fr'      => ["Campagne Hilads : points x2", "{title} - points doublés ! Tu en es ?"],
            'vi'      => ["Hilads nhân đôi điểm!", "{title} - điểm x2! Chơi không?"],
            'es'      => ["Campaña Hilads: puntos x2", "{title}: ¡gana el DOBLE de puntos! ¿Te apuntas?"],
            'it'      => ["Campagna Hilads: punti x2", "{title}: punti DOPPI! Ci stai?"],
            'pt-br'   => ["Pontos em dobro na campanha Hilads", "{title}: ganhe o DOBRO de pontos. Bora?"],
            'pt-pt'   => ["Campanha Hilads: pontos x2", "{title} - ganha pontos a DOBRAR! Alinhas?"],
            'de'      => ["Hilads-Kampagne - 2× Punkte", "{title} - hol dir DOPPELTE Punkte! Bist du dabei?"],
            'nl'      => ["Hilads-campagne: 2× punten", "{title}: verdien DUBBELE punten! Doe je mee?"],
            'zh-hans' => ["Hilads 限时活动：积分翻倍", "{title}：积分翻倍！来不来？"],
            'zh-hant' => ["Hilads 活動：積分翻倍", "{title}：積分翻倍！要一起來嗎？"],
            'ja'      => ["Hiladsキャンペーン：ポイント2倍", "{title}：ポイント2倍のチャンス！参加する？"],
            'ko'      => ["Hilads 캠페인 · 포인트 2배", "{title}: 포인트 2배 찬스! 함께할래요?"],
            'fil'     => ["Hilads Campaign: 2× points", "{title}: DOBLE ang points! Sali ka?"],
            'th'      => ["แคมเปญ Hilads แต้ม 2 เท่า", "{title}: รับแต้ม 2 เท่า! เอาด้วยไหม?"],
            'id'      => ["Kampanye Hilads: poin 2×", "{title}: dapat poin DOBEL! Ikut nggak?"],
            'hi'      => ["Hilads कैंपेन: डबल पॉइंट्स", "{title}: डबल पॉइंट्स कमाएं! आप तैयार हैं?"],
            'ru'      => ["Кампания Hilads — очки x2", "{title} — получи ДВОЙНЫЕ очки! Ты в деле?"],
            'ar'      => ["حملة Hilads: نقاط مضاعفة", "{title}: اربح نقاطًا مضاعفة! هل أنت معنا؟"],
        ],
        'city_join' => [
            'fr' => ["Quelqu'un est arrivé à {city}", "{name} vient d'arriver"],
            'vi' => ["Có người vừa tới {city}", "{name} vừa tới"],
            'es' => ["Alguien acaba de llegar a {city}", "{name} acaba de llegar"],
            'it' => ["Qualcuno è appena arrivato a {city}", "Nuovo arrivo: {name}"],
            'pt-br' => ["Alguém acabou de chegar em {city}", "{name} acabou de chegar"],
            'pt-pt' => ["Alguém acabou de chegar a {city}",  "{name} acabou de chegar"],
            'de'    => ["Jemand ist gerade in {city} angekommen", "{name} ist gerade angekommen"],
            'nl'    => ["Nieuw in {city}", "{name} is net aangekomen"],
            'zh-hans' => ["有人刚到 {city}", "{name} 刚刚到了"],
            'zh-hant' => ["有人剛到 {city}", "{name} 剛到"],
            'ja'      => ["{city}に誰かがやってきた", "{name}さんが到着しました"],
            'ko'      => ["{city}에 누가 도착했어요", "{name} 님이 방금 도착했어요"],
            'fil'     => ["May bagong dating sa {city}", "Kararating lang ni {name}"],
            'th'      => ["มีคนเพิ่งมาถึง {city}", "{name} เพิ่งมาถึง"],
            'id'      => ["Ada yang baru tiba di {city}", "{name} baru aja sampai"],
            'hi'      => ["{city} में कोई अभी-अभी पहुंचा", "{name} अभी-अभी पहुंचे"],
            'ru'      => ["{city}: кто-то только что приехал", "{name} уже здесь"],
            'ar'      => ["وصل أحدهم للتو إلى {city}", "{name} وصل للتو"],
        ],
        // V6: a friend landed somewhere (worldwide arrivals are friends-only).
        'world_arrival' => [
            'fr' => ["Un ami a atterri", "{name} vient d'arriver à {city}"],
            'vi' => ["Bạn bè vừa tới nơi", "{name} vừa tới {city}"],
            'es' => ["Un amigo acaba de llegar", "{name} acaba de llegar a {city}"],
            'it' => ["Un amico è appena arrivato", "{name} è appena arrivato a {city}"],
            'pt-br' => ["Um amigo acabou de chegar", "{name} acabou de chegar em {city}"],
            'pt-pt' => ["Um amigo acabou de chegar", "{name} acabou de chegar a {city}"],
            'de'    => ["Ein Freund ist gelandet", "{name} ist gerade in {city} angekommen"],
            'nl'    => ["Een vriend is geland", "{name} is net in {city} aangekomen"],
            'zh-hans' => ["好友刚落地", "{name} 刚到 {city}"],
            'zh-hant' => ["朋友剛落地", "{name} 剛到 {city}"],
            'ja'      => ["友だちが到着", "{name}さんが{city}に着いたよ"],
            'ko'      => ["친구가 도착했어요", "{name} 님이 방금 {city}에 도착했어요"],
            'fil'     => ["May friend na dumating", "Kararating lang ni {name} sa {city}"],
            'th'      => ["เพื่อนมาถึงแล้ว", "{name} เพิ่งมาถึง{city}"],
            'id'      => ["Temanmu baru tiba", "{name} baru aja sampai di {city}"],
            'hi'      => ["आपका दोस्त पहुंच गया", "{name} अभी-अभी {city} पहुंचे"],
            'ru'      => ["Друг приземлился", "{name} только что прилетел в {city}"],
            'ar'      => ["وصل صديقك", "{name} وصل للتو إلى {city}"],
        ],
        'new_event' => [
            'fr' => ["Nouvel événement à {city}", null],
            'vi' => ["Sự kiện mới ở {city}",     null],
            'es' => ["Nuevo evento en {city}",   null],
            'it' => ["Nuovo evento a {city}",    null],
            'pt-br' => ["Novo evento em {city}", null],
            'pt-pt' => ["Novo evento em {city}", null],
            'de'    => ["Neues Event in {city}", null],
            'nl'    => ["Nieuw evenement in {city}", null],
            'zh-hans' => ["{city} 有新活动", null],
            'zh-hant' => ["{city} 有新活動", null],
            'ja'      => ["{city}で新しいイベント", null],
            'ko'      => ["{city}에 새 이벤트", null],
            'fil'     => ["May bagong event sa {city}", null],
            'th'      => ["มีกิจกรรมใหม่ใน {city}", null],
            'id'      => ["Ada acara baru di {city}", null],
            'hi'      => ["{city} में नया इवेंट", null],
            'ru'      => ["Новое событие в городе {city}", null],
            'ar'      => ["فعالية جديدة في {city}", null],
        ],
        'new_challenge' => [
            'fr' => ["Nouveau défi à {city}", null],
            'vi' => ["Thử thách mới ở {city}", null],
            'es' => ["Nuevo reto en {city}", null],
            'it' => ["Nuova sfida a {city}", null],
            'pt-br' => ["Novo desafio em {city}", null],
            'pt-pt' => ["Novo desafio em {city}", null],
            'de'    => ["Neue Challenge in {city}", null],
            'nl'    => ["Nieuwe challenge in {city}", null],
            'zh-hans' => ["{city} 有新挑战", null],
            'zh-hant' => ["{city} 有新挑戰", null],
            'ja'      => ["{city}で新しいチャレンジ", null],
            'ko'      => ["{city}에 새 챌린지", null],
            'fil'     => ["May bagong challenge sa {city}", null],
            'th'      => ["มีชาเลนจ์ใหม่ใน {city}", null],
            'id'      => ["Ada tantangan baru di {city}", null],
            'hi'      => ["{city} में नया चैलेंज", null],
            'ru'      => ["Новый челлендж в городе {city}", null],
            'ar'      => ["تحدٍّ جديد في {city}", null],
        ],
        'channel_message' => [
            'fr' => ["{name} dans le chat de la ville", null],
            'vi' => ["{name} trong chat thành phố",     null],
            'es' => ["{name} en el chat de la ciudad",  null],
            'it' => ["{name} nella chat della città",   null],
            'pt-br' => ["{name} no chat da cidade",     null],
            'pt-pt' => ["{name} no chat da cidade",     null],
            'de'    => ["{name} im Stadt-Chat",         null],
            'nl'    => ["{name} in de stadschat",        null],
            'zh-hans' => ["{name} 在城市聊天里说", null],
            'zh-hant' => ["{name} 在城市聊天室",          null],
            'ja'      => ["{name}（街のチャット）", null],
            'ko'      => ["{name} 님 · 도시 채팅", null],
            'fil'     => ["{name} sa city chat",            null],
            'th'      => ["{name} ในแชทเมือง",              null],
            'id'      => ["{name} di chat kota", null],
            'hi'      => ["{name} सिटी चैट में",              null],
            'ru'      => ["{name} в чате города",            null],
            'ar'      => ["{name} في دردشة المدينة",          null],
        ],
        'event_message' => [
            'fr' => ["{name} dans {title}", null],
            'vi' => ["{name} trong {title}", null],
            'es' => ["{name} en {title}", null],
            'it' => ["{name} in {title}", null],
            'pt-br' => ["{name} em {title}", null],
            'pt-pt' => ["{name} em {title}", null],
            'de'    => ["{name} in {title}", null],
            'nl'    => ["{name} in {title}", null],
            'zh-hans' => ["{name} 在 {title} 里说", null],
            'zh-hant' => ["{name} 在 {title}", null],
            'ja'      => ["{name}（{title}）", null],
            'ko'      => ["{name} 님 · {title}", null],
            'fil'     => ["{name} sa {title}", null],
            'th'      => ["{name} ใน {title}", null],
            'id'      => ["{name} di {title}", null],
            'hi'      => ["{name} {title} में", null],
            'ru'      => ["{name} в {title}", null],
            'ar'      => ["{name} في {title}", null],
        ],
        'topic_message' => [
            'fr' => ["{name} dans {title}", null],
            'vi' => ["{name} trong {title}", null],
            'es' => ["{name} en {title}", null],
            'it' => ["{name} in {title}", null],
            'pt-br' => ["{name} em {title}", null],
            'pt-pt' => ["{name} em {title}", null],
            'de'    => ["{name} in {title}", null],
            'nl'    => ["{name} in {title}", null],
            'zh-hans' => ["{name} 在 {title} 里说", null],
            'zh-hant' => ["{name} 在 {title}", null],
            'ja'      => ["{name}（{title}）", null],
            'ko'      => ["{name} 님 · {title}", null],
            'fil'     => ["{name} sa {title}", null],
            'th'      => ["{name} ใน {title}", null],
            'id'      => ["{name} di {title}", null],
            'hi'      => ["{name} {title} में", null],
            'ru'      => ["{name} в {title}", null],
            'ar'      => ["{name} في {title}", null],
        ],
        'dm_message' => [
            'fr' => ["{name} t'a envoyé un message",          null],
            'vi' => ["{name} vừa nhắn bạn", null],
            'es' => ["{name} te envió un mensaje", null],
            'it' => ["{name} ti ha scritto", null],
            'pt-br' => ["{name} te mandou uma mensagem", null],
            'pt-pt' => ["{name} enviou-te uma mensagem",      null],
            'de'    => ["{name} hat dir eine Nachricht geschickt", null],
            'nl'    => ["{name} stuurde je een bericht", null],
            'zh-hans' => ["{name} 给你发了条消息", null],
            'zh-hant' => ["{name} 傳訊息給你", null],
            'ja'      => ["{name}さんからメッセージ", null],
            'ko'      => ["{name} 님이 메시지를 보냈어요",         null],
            'fil'     => ["Nag-message si {name}", null],
            'th'      => ["{name} ส่งข้อความถึงคุณ",               null],
            'id'      => ["{name} ngirim pesan ke kamu", null],
            'hi'      => ["{name} ने आपको मैसेज भेजा",            null],
            'ru'      => ["{name} пишет тебе", null],
            'ar'      => ["رسالة جديدة من {name}", null],
        ],
        'event_join' => [
            'fr' => ["{name} a rejoint {title}",   null],
            'vi' => ["{name} đã vào {title}", null],
            'es' => ["{name} se unió a {title}",   null],
            'it' => ["{name} partecipa a {title}", null],
            'pt-br' => ["{name} entrou em {title}",   null],
            'pt-pt' => ["{name} juntou-se a {title}", null],
            'de'    => ["{name} ist bei {title} dabei", null],
            'nl'    => ["{name} doet mee aan {title}",    null],
            'zh-hans' => ["{name} 加入了 {title}",        null],
            'zh-hant' => ["{name} 加入了 {title}",        null],
            'ja'      => ["{name}さんが{title}に参加しました", null],
            'ko'      => ["{name} 님이 {title}에 참여했어요", null],
            'fil'     => ["Sumali si {name} sa {title}",     null],
            'th'      => ["{name} เข้าร่วม {title} แล้ว",      null],
            'id'      => ["{name} gabung ke {title}", null],
            'hi'      => ["{name} {title} में शामिल हुए",     null],
            'ru'      => ["{name} теперь в {title}", null],
            'ar'      => ["{name} انضم إلى {title}",          null],
        ],
        // Challenge creator validates → fans out to every other registered
        // participant. Both title + body are translated; English-locale users
        // get the caller's hardcoded text (see api.php POST /challenges/{id}/validate).
        'challenge_validated' => [
            'fr'      => ["Défi validé", "{name} a validé « {title} »"],
            'vi'      => ["Thử thách đã được xác nhận",          "{name} đã xác nhận \"{title}\""],
            'es'      => ["Reto validado", "{name} validó «{title}»"],
            'it'      => ["Sfida convalidata", "{name} ha convalidato «{title}»"],
            'pt-br'   => ["Desafio validado",                     "{name} validou \"{title}\""],
            'pt-pt'   => ["Desafio validado",                     "{name} validou \"{title}\""],
            'de'      => ["Challenge bestätigt", "{name} hat „{title}“ bestätigt"],
            'nl'      => ["Challenge goedgekeurd", "{name} keurde \"{title}\" goed"],
            'zh-hans' => ["挑战已确认", "{name} 确认了「{title}」"],
            'zh-hant' => ["挑戰通過驗證", "{name} 驗證了「{title}」"],
            'ja'      => ["チャレンジ確定", "{name}さんが「{title}」を確定しました"],
            'ko'      => ["챌린지 완료!", "{name} 님이 \"{title}\" 챌린지를 완료 처리했어요"],
            'fil'     => ["Validated na ang challenge", "Na-validate ni {name} ang \"{title}\""],
            'th'      => ["ยืนยันชาเลนจ์แล้ว", "{name} ยืนยัน \"{title}\" แล้ว"],
            'id'      => ["Tantangan divalidasi", "{name} memvalidasi \"{title}\""],
            'hi'      => ["चैलेंज वैलिडेट हो गया", "{name} ने \"{title}\" वैलिडेट किया"],
            'ru'      => ["Челлендж подтверждён", "{name} подтверждает «{title}»"],
            'ar'      => ["تم اعتماد التحدي", "{name} اعتمد «{title}»"],
        ],
        'friend_request_received' => [
            'fr' => ["{name} t'a envoyé une demande d'ami",      null],
            'vi' => ["{name} muốn kết bạn với bạn", null],
            'es' => ["{name} te envió una solicitud de amistad", null],
            'it' => ["{name} ti ha inviato una richiesta di amicizia", null],
            'pt-br' => ["{name} te mandou um pedido de amizade", null],
            'pt-pt' => ["{name} enviou-te um pedido de amizade",      null],
            'de'    => ["{name} hat dir eine Freundschaftsanfrage geschickt", null],
            'nl'    => ["{name} stuurde je een vriendschapsverzoek", null],
            'zh-hans' => ["{name} 想加你为好友", null],
            'zh-hant' => ["{name} 想加你好友", null],
            'ja'      => ["{name}さんから友達リクエスト", null],
            'ko'      => ["{name} 님이 친구 요청을 보냈어요",                null],
            'fil'     => ["Nag-send si {name} ng friend request", null],
            'th'      => ["{name} ส่งคำขอเป็นเพื่อนถึงคุณ",                   null],
            'id'      => ["{name} ngirim permintaan pertemanan", null],
            'hi'      => ["{name} ने आपको फ्रेंड रिक्वेस्ट भेजी",              null],
            'ru'      => ["{name} хочет добавить тебя в друзья", null],
            'ar'      => ["طلب صداقة جديد من {name}", null],
        ],
        'friend_request_accepted' => [
            'fr' => ["{name} a accepté ta demande d'ami",            null],
            'vi' => ["{name} đã đồng ý kết bạn", null],
            'es' => ["{name} aceptó tu solicitud de amistad", null],
            'it' => ["Tu e {name} adesso siete amici", null],
            'pt-br' => ["{name} aceitou seu pedido de amizade",    null],
            'pt-pt' => ["{name} aceitou o teu pedido de amizade",   null],
            'de'    => ["{name} hat deine Freundschaftsanfrage angenommen", null],
            'nl'    => ["{name} accepteerde je vriendschapsverzoek", null],
            'zh-hans' => ["{name} 通过了你的好友请求", null],
            'zh-hant' => ["{name} 接受了你的好友邀請",                     null],
            'ja'      => ["{name}さんと友達になりました", null],
            'ko'      => ["{name} 님이 친구 요청을 수락했어요",            null],
            'fil'     => ["Tinanggap ni {name} ang friend request mo", null],
            'th'      => ["{name} ตอบรับคำขอเป็นเพื่อนของคุณแล้ว",         null],
            'id'      => ["{name} nerima permintaan pertemananmu", null],
            'hi'      => ["{name} ने आपकी फ्रेंड रिक्वेस्ट स्वीकार की",       null],
            'ru'      => ["{name} теперь у тебя в друзьях", null],
            'ar'      => ["{name} قبل طلب صداقتك",                        null],
        ],
        'vibe_received' => [
            'fr' => ["{name} t'a envoyé une vibe",         null],
            'vi' => ["{name} vừa gửi bạn một vibe", null],
            'es' => ["{name} te envió una vibe", null],
            'it' => ["{name} ti ha lasciato una vibe", null],
            'pt-br' => ["{name} te mandou uma vibe", null],
            'pt-pt' => ["{name} enviou-te uma vibe",       null],
            'de'    => ["{name} hat dir einen vibe geschickt", null],
            'nl'    => ["{name} stuurde je een vibe", null],
            'zh-hans' => ["{name} 给你送了一个 vibe", null],
            'zh-hant' => ["{name} 送你一個 vibe", null],
            'ja'      => ["{name}さんからvibeが届きました", null],
            'ko'      => ["{name} 님이 vibe를 보냈어요",       null],
            'fil'     => ["Binigyan ka ni {name} ng vibe", null],
            'th'      => ["{name} ส่ง vibe ให้คุณ", null],
            'id'      => ["{name} ngasih kamu vibe", null],
            'hi'      => ["{name} ने आपको vibe भेजा",          null],
            'ru'      => ["Новый vibe от {name}", null],
            'ar'      => ["vibe جديدة من {name}", null],
        ],
        'wave' => [
            'fr' => ['{name} t\'a fait coucou 👋', null],
            'vi' => ['{name} vẫy tay chào bạn 👋', null],
            'es' => ['{name} te saludó 👋', null],
            'it' => ['{name} ti ha salutato 👋', null],
            'pt-br' => ['{name} acenou pra você 👋', null],
            'pt-pt' => ['{name} acenou-te 👋', null],
            'de' => ['{name} hat dir zugewinkt 👋', null],
            'nl' => ['{name} zwaaide naar je 👋', null],
            'zh-hans' => ['{name} 向你挥手 👋', null],
            'zh-hant' => ['{name} 向你揮手 👋', null],
            'ja' => ['{name}さんが手を振っています 👋', null],
            'ko' => ['{name} 님이 손을 흔들었어요 👋', null],
            'fil' => ['Kumaway sa\'yo si {name} 👋', null],
            'th' => ['{name} โบกมือทักคุณ 👋', null],
            'id' => ['{name} melambai ke kamu 👋', null],
            'hi' => ['{name} ने आपको हाथ हिलाया 👋', null],
            'ru' => ['{name} машет тебе 👋', null],
            'ar' => ['{name} لوّح لك 👋', null],
        ],
        'wave_back' => [
            'fr' => ['{name} t\'a fait coucou en retour 🎉', 'Dis bonjour dans une discussion'],
            'vi' => ['{name} đã vẫy tay lại 🎉', 'Nhắn một lời chào nhé'],
            'es' => ['{name} te devolvió el saludo 🎉', 'Salúdale en un chat'],
            'it' => ['{name} ha ricambiato il saluto 🎉', 'Scrivigli un ciao in chat'],
            'pt-br' => ['{name} acenou de volta 🎉', 'Diga oi numa conversa'],
            'pt-pt' => ['{name} acenou-te de volta 🎉', 'Diz olá numa conversa'],
            'de' => ['{name} hat zurückgewinkt 🎉', 'Sag Hallo in einem Chat'],
            'nl' => ['{name} zwaaide terug 🎉', 'Zeg hoi in een chat'],
            'zh-hans' => ['{name} 也向你挥手了 🎉', '去聊天里打个招呼吧'],
            'zh-hant' => ['{name} 也向你揮手了 🎉', '去聊天裡打個招呼吧'],
            'ja' => ['{name}さんが手を振り返しました 🎉', 'チャットであいさつしよう'],
            'ko' => ['{name} 님도 손을 흔들었어요 🎉', '채팅으로 인사해 보세요'],
            'fil' => ['Kumaway pabalik si {name} 🎉', 'Mag-hi sa isang chat'],
            'th' => ['{name} โบกมือตอบแล้ว 🎉', 'ทักทายกันในแชทเลย'],
            'id' => ['{name} balas melambai 🎉', 'Sapa dia di chat'],
            'hi' => ['{name} ने भी हाथ हिलाया 🎉', 'चैट में हाय कहें'],
            'ru' => ['{name} машет в ответ 🎉', 'Поздоровайся в чате'],
            'ar' => ['{name} لوّح لك بالمقابل 🎉', 'قل مرحبًا في محادثة'],
        ],
        'profile_view' => [
            'fr' => ["{name} a regardé ton profil",   null],
            'vi' => ["{name} vừa xem hồ sơ của bạn", null],
            'es' => ["{name} pasó por tu perfil", null],
            'it' => ["{name} ha dato un'occhiata al tuo profilo", null],
            'pt-br' => ["{name} visitou seu perfil", null],
            'pt-pt' => ["{name} viu o teu perfil",     null],
            'de'    => ["{name} hat sich dein Profil angesehen", null],
            'nl'    => ["{name} bekeek je profiel", null],
            'zh-hans' => ["{name} 看了你的主页", null],
            'zh-hant' => ["{name} 看了你的個人資料",         null],
            'ja'      => ["{name}さんがプロフィールを見ました", null],
            'ko'      => ["{name} 님이 내 프로필을 봤어요", null],
            'fil'     => ["Sinilip ni {name} ang profile mo", null],
            'th'      => ["{name} แวะดูโปรไฟล์ของคุณ", null],
            'id'      => ["{name} ngecek profilmu", null],
            'hi'      => ["{name} ने आपकी प्रोफ़ाइल देखी", null],
            'ru'      => ["{name} смотрит твой профиль", null],
            'ar'      => ["{name} زار ملفك الشخصي", null],
        ],
        'join_request' => [
            'fr' => ["{name} veut rejoindre", "{name} demande à rejoindre {title}"],
            'vi' => ["{name} muốn tham gia", "{name} xin vào {title}"],
            'es' => ["{name} quiere unirse",   "{name} pidió unirse a {title}"],
            'it' => ["{name} vuole unirsi",    "{name} ha chiesto di unirsi a {title}"],
            'pt-br' => ["{name} quer entrar", "{name} pediu pra entrar em {title}"],
            'pt-pt' => ["{name} quer juntar-se",    "{name} pediu para se juntar a {title}"],
            'de'    => ["{name} will mitmachen", "{name} möchte bei {title} mitmachen"],
            'nl'    => ["{name} wil meedoen", "{name} wil meedoen met {title}"],
            'zh-hans' => ["{name} 想加入",          "{name} 申请加入 {title}"],
            'zh-hant' => ["{name} 想加入",          "{name} 申請加入 {title}"],
            'ja'      => ["{name}さんが参加したがっています", "{name}さんが{title}への参加をリクエストしました"],
            'ko'      => ["{name} 님이 함께하고 싶대요", "{name} 님이 {title} 참여를 요청했어요"],
            'fil'     => ["Gustong sumali ni {name}", "Nag-request si {name} na sumali sa {title}"],
            'th'      => ["{name} อยากเข้าร่วม",          "{name} ขอเข้าร่วม {title}"],
            'id'      => ["{name} mau gabung", "{name} minta gabung ke {title}"],
            'hi'      => ["{name} जुड़ना चाहते हैं", "{name} {title} में जुड़ना चाहते हैं"],
            'ru'      => ["{name} хочет присоединиться", "{name} просится в {title}"],
            'ar'      => ["{name} يريد الانضمام", "{name} طلب الانضمام إلى {title}"],
        ],
        // Group result reveal - fires to EVERY participant when a group
        // challenge resolves. Winner-CONCEALING on purpose ("tap to see"); the
        // outcome lives in data for the reveal modal. {name} = challenger.
        'challenge_group_result_photo' => [
            'fr'      => ["{name} a choisi la photo gagnante", "{title} · Touche pour voir qui a gagné"],
            'vi'      => ["{name} đã chọn ảnh thắng", "{title} · Bấm xem ai thắng"],
            'es'      => ["{name} eligió la foto ganadora",     "{title} · Toca para ver quién ganó"],
            'it'      => ["{name} ha scelto la foto vincente",  "{title} · Tocca per vedere chi ha vinto"],
            'pt-br'   => ["{name} escolheu a foto vencedora", "{title} · Toque pra ver quem ganhou"],
            'pt-pt'   => ["{name} escolheu a foto vencedora",   "{title} · Toca para ver quem ganhou"],
            'de'      => ["{name} hat das Siegerfoto gewählt", "{title} · Tipp drauf und schau, wer gewonnen hat"],
            'nl'      => ["{name} heeft de winnende foto gekozen", "{title} · Tik om te zien wie er won"],
            'zh-hans' => ["{name} 选出了获胜照片", "{title} · 点开看看谁赢了"],
            'zh-hant' => ["{name} 選出了冠軍照片", "{title} · 點開看看誰贏了"],
            'ja'      => ["{name}さんが優勝写真を選びました", "{title} · タップして誰が勝ったか見よう"],
            'ko'      => ["{name} 님이 우승 사진을 골랐어요", "{title} · 눌러서 누가 이겼는지 확인해 보세요"],
            'fil'     => ["Pinili na ni {name} ang panalong photo", "{title} · I-tap para makita kung sino'ng nanalo"],
            'th'      => ["{name} เลือกรูปที่ชนะแล้ว",            "{title} · แตะเพื่อดูว่าใครชนะ"],
            'id'      => ["{name} udah milih foto pemenang", "{title} · Ketuk buat lihat siapa yang menang"],
            'hi'      => ["{name} ने जीतने वाली फ़ोटो चुन ली", "{title} · टैप करें और देखें कौन जीता"],
            'ru'      => ["{name}: победное фото выбрано", "{title} · Нажми, чтобы узнать победителя"],
            'ar'      => ["{name} اختار الصورة الفائزة", "{title} · اضغط لترى من فاز"],
        ],
        'challenge_group_result_meet' => [
            'fr'      => ["{name} a validé le rendez-vous", "{title} · Touche pour voir comment ça s'est passé"],
            'vi'      => ["{name} đã xác nhận buổi gặp", "{title} · Bấm xem kết quả"],
            'es'      => ["{name} validó el encuentro",     "{title} · Toca para ver cómo fue"],
            'it'      => ["{name} ha convalidato l'incontro", "{title} · Tocca per vedere com'è andata"],
            'pt-br'   => ["{name} validou o encontro", "{title} · Toque pra ver como foi"],
            'pt-pt'   => ["{name} validou o encontro",      "{title} · Toca para ver como correu"],
            'de'      => ["{name} hat das Treffen bestätigt", "{title} · Tipp drauf und schau, wie's lief"],
            'nl'      => ["{name} heeft de meet bevestigd", "{title} · Tik om te zien hoe het ging"],
            'zh-hans' => ["{name} 确认了见面", "{title} · 点开看看结果"],
            'zh-hant' => ["{name} 確認了見面", "{title} · 點開看看結果"],
            'ja'      => ["{name}さんがミートを確定しました", "{title} · タップしてどうだったか見よう"],
            'ko'      => ["{name} 님이 만남을 확정했어요", "{title} · 눌러서 어땠는지 확인해 보세요"],
            'fil'     => ["Na-validate ni {name} ang meet", "{title} · I-tap para makita kung kumusta"],
            'th'      => ["{name} ยืนยันการเจอกันแล้ว", "{title} · แตะเพื่อดูว่าเป็นยังไง"],
            'id'      => ["{name} memvalidasi ketemuan", "{title} · Ketuk buat lihat hasilnya"],
            'hi'      => ["{name} ने मीट वैलिडेट की", "{title} · टैप करें और देखें कैसा रहा"],
            'ru'      => ["{name}: встреча подтверждена", "{title} · Нажми, чтобы узнать, как прошло"],
            'ar'      => ["{name} أكّد اللقاء", "{title} · اضغط لترى كيف جرى"],
        ],
        // Group join - fires to the CREATOR when a user JOINS their group
        // challenge (no approval; many can join). Body references the title.
        'challenge_group_join' => [
            'fr'      => ["Nouveau participant", "{name} a rejoint ton défi « {title} »"],
            'vi'      => ["Có người mới tham gia", "{name} đã vào thử thách \"{title}\" của bạn"],
            'es'      => ["Nuevo participante", "{name} se unió a tu reto «{title}»"],
            'it'      => ["Nuovo partecipante", "{name} partecipa alla tua sfida «{title}»"],
            'pt-br'   => ["Gente nova no desafio", "{name} entrou no seu desafio \"{title}\""],
            'pt-pt'   => ["Novo participante",      "{name} juntou-se ao teu desafio \"{title}\""],
            'de'      => ["Neu dabei", "{name} macht bei deiner Challenge „{title}“ mit"],
            'nl'      => ["Nieuwe deelnemer", "{name} doet mee met je challenge \"{title}\""],
            'zh-hans' => ["新成员加入", "{name} 加入了你的挑战「{title}」"],
            'zh-hant' => ["新成員加入", "{name} 加入了你的挑戰「{title}」"],
            'ja'      => ["新しい参加者", "{name}さんが「{title}」に参加しました"],
            'ko'      => ["새 참가자", "{name} 님이 \"{title}\" 챌린지에 들어왔어요"],
            'fil'     => ["May bagong sumali", "Sumali si {name} sa challenge mong \"{title}\""],
            'th'      => ["มีคนเข้าร่วมใหม่", "{name} เข้าร่วมชาเลนจ์ \"{title}\" ของคุณ"],
            'id'      => ["Peserta baru", "{name} gabung ke tantanganmu \"{title}\""],
            'hi'      => ["नया खिलाड़ी", "{name} आपके चैलेंज \"{title}\" में शामिल हुए"],
            'ru'      => ["Новый участник", "{name} теперь в твоём челлендже «{title}»"],
            'ar'      => ["مشارك جديد", "{name} انضم إلى تحدّيك «{title}»"],
        ],
        // ── International mode notifications ────────────────────────────────
        // Proof submitted - fires to the CREATOR when the acceptor uploads
        // a proof. Body carries the challenge title verbatim.
        'challenge_proof_submitted' => [
            'fr'      => ["Nouvelle preuve à valider", "{name} a envoyé une preuve pour « {title} »"],
            'vi'      => ["Có bằng chứng mới chờ duyệt", "{name} vừa gửi bằng chứng cho \"{title}\""],
            'es'      => ["Nueva prueba para revisar", "{name} envió una prueba para «{title}»"],
            'it'      => ["Nuova prova da controllare", "{name} ha inviato una prova per «{title}»"],
            'pt-br'   => ["Nova prova pra revisar",           "{name} mandou uma prova pra \"{title}\""],
            'pt-pt'   => ["Nova prova para rever",            "{name} enviou uma prova para \"{title}\""],
            'de'      => ["Neuer Beweis zum Prüfen", "{name} hat einen Beweis für „{title}“ geschickt"],
            'nl'      => ["Nieuw bewijs om te beoordelen", "{name} stuurde bewijs voor \"{title}\""],
            'zh-hans' => ["有新证明待确认", "{name} 为「{title}」发来了证明"],
            'zh-hant' => ["有新證明等你審核", "{name} 為「{title}」傳來證明"],
            'ja'      => ["確認待ちの写真が届きました", "{name}さんが「{title}」の写真を送りました"],
            'ko'      => ["새 인증 사진이 왔어요", "{name} 님이 \"{title}\" 인증 사진을 보냈어요"],
            'fil'     => ["May bagong proof na iche-check", "Nag-send si {name} ng proof para sa \"{title}\""],
            'th'      => ["มีหลักฐานใหม่รอตรวจ", "{name} ส่งหลักฐานสำหรับ \"{title}\" แล้ว"],
            'id'      => ["Ada bukti baru buat dicek", "{name} ngirim bukti untuk \"{title}\""],
            'hi'      => ["नया प्रूफ, चेक करें", "{name} ने \"{title}\" का प्रूफ भेजा"],
            'ru'      => ["Новое фото на проверку", "Фото от {name} для «{title}»"],
            'ar'      => ["إثبات جديد للمراجعة", "{name} أرسل إثباتًا لـ«{title}»"],
        ],
        // Cross-city heads-up - fires to users in CITY B when someone in
        // CITY A creates an international challenge targeting them. Two
        // city placeholders: {originCity} = where the challenge came from,
        // {city} = recipient's own city (target). No actor name - the
        // creator's identity is intentionally generic on this fan-out
        // (it's a city-wide ping, not a personal invite - those use
        // challenge_invitation for individual targeting).
        'challenge_international_target' => [
            'fr'      => ["Nouveau défi international",       "Quelqu'un de {originCity} cherche un challenger à {city}"],
            'vi'      => ["Thử thách quốc tế mới", "Có người ở {originCity} đang tìm Challenger ở {city}"],
            'es'      => ["Nuevo reto internacional", "Alguien de {originCity} le lanza un reto a {city}"],
            'it'      => ["Nuova sfida internazionale", "Qualcuno da {originCity} lancia una sfida a {city}"],
            'pt-br'   => ["Novo desafio internacional", "Alguém em {originCity} procura um desafiante em {city}"],
            'pt-pt'   => ["Novo desafio internacional", "Alguém em {originCity} procura quem aceite um desafio em {city}"],
            'de'      => ["Neue internationale Challenge", "Jemand aus {originCity} sucht einen Challenger in {city}"],
            'nl'      => ["Nieuwe internationale challenge", "Iemand uit {originCity} daagt {city} uit"],
            'zh-hans' => ["新的跨城挑战", "有位来自 {originCity} 的人在 {city} 寻找挑战者"],
            'zh-hant' => ["新的跨城挑戰", "{originCity} 有人在 {city} 找挑戰者"],
            'ja'      => ["新しい国際チャレンジ", "{originCity}の誰かが{city}で挑戦者を募集中"],
            'ko'      => ["새 국제 챌린지", "{originCity}에서 {city}의 도전자를 찾고 있어요"],
            'fil'     => ["Bagong international challenge", "May taga-{originCity} na naghahanap ng challenger sa {city}"],
            'th'      => ["ชาเลนจ์ข้ามเมืองมาใหม่", "มีคนจาก {originCity} หาผู้รับคำท้าใน {city}"],
            'id'      => ["Tantangan internasional baru", "Ada orang di {originCity} yang nyari penantang di {city}"],
            'hi'      => ["नया इंटरनेशनल चैलेंज", "{originCity} से कोई {city} में चैलेंजर ढूंढ रहा है"],
            'ru'      => ["Новый международный челлендж", "Кто-то из города {originCity} ищет участника в городе {city}"],
            'ar'      => ["تحدٍّ دولي جديد", "شخص من {originCity} يبحث عن متحدٍّ في {city}"],
        ],
        // Personal challenge invitation: "{name} challenges you" with the
        // challenge title kept verbatim in the body (the title is a proper
        // piece of user content - translating it would change the meaning).
        'challenge_invitation' => [
            'fr'      => ["{name} te défie",                 null],
            'vi'      => ["{name} thách bạn",                null],
            'es'      => ["{name} te reta",                  null],
            'it'      => ["{name} ti sfida",                 null],
            'pt-br'   => ["{name} te desafia",               null],
            'pt-pt'   => ["{name} desafia-te",               null],
            'de'      => ["{name} fordert dich heraus",      null],
            'nl'      => ["{name} daagt je uit",             null],
            'zh-hans' => ["{name} 向你发起了挑战", null],
            'zh-hant' => ["{name} 向你下戰帖", null],
            'ja'      => ["{name}さんからチャレンジが届きました", null],
            'ko'      => ["{name} 님이 도전장을 보냈어요", null],
            'fil'     => ["Hinahamon ka ni {name}",          null],
            'th'      => ["{name} ท้าคุณ",                    null],
            'id'      => ["{name} menantangmu",              null],
            'hi'      => ["{name} ने आपको चैलेंज दिया", null],
            'ru'      => ["{name} бросает тебе вызов",        null],
            'ar'      => ["{name} يتحدّاك", null],
        ],
        'join_request_accepted' => [
            'fr' => ["Tu y es !", "{name} t'a ajouté à {title}"],
            'vi' => ["Bạn vào rồi!", "{name} đã thêm bạn vào {title}"],
            'es' => ["¡Ya estás dentro!", "{name} te añadió a {title}"],
            'it' => ["Sei dentro!", "{name} ti ha aggiunto a {title}"],
            'pt-br' => ["Você entrou!", "{name} te adicionou em {title}"],
            'pt-pt' => ["Já estás dentro!", "{name} adicionou-te a {title}"],
            'de'    => ["Du bist dabei!",  "{name} hat dich zu {title} hinzugefügt"],
            'nl'    => ["Je bent erbij!", "{name} heeft je aan {title} toegevoegd"],
            'zh-hans' => ["你加入啦！", "{name} 把你拉进了 {title}"],
            'zh-hant' => ["你加入了！", "{name} 把你加進了 {title}"],
            'ja'      => ["参加できました！", "{name}さんが{title}に追加してくれました"],
            'ko'      => ["함께하게 됐어요!", "{name} 님이 {title}에 추가해 줬어요"],
            'fil'     => ["Pasok ka na!", "In-add ka ni {name} sa {title}"],
            'th'      => ["เข้าร่วมแล้ว!", "{name} เพิ่มคุณเข้า {title} แล้ว"],
            'id'      => ["Kamu masuk!", "{name} nambahin kamu ke {title}"],
            'hi'      => ["आप अंदर हैं!", "{name} ने आपको {title} में जोड़ लिया"],
            'ru'      => ["Ты в деле!", "{name} открывает тебе доступ к {title}"],
            'ar'      => ["أنت معهم الآن!", "{name} أضافك إلى {title}"],
        ],
    ];

    // Mention is the only type whose title depends on where the mention happened.
    private const MENTION = [
        'fr' => [
            'titled' => "{name} t'a mentionné dans {title}",        // event / topic
            'city'   => "{name} t'a mentionné à {city}",            // {city} = city name
            'world'  => "{name} t'a mentionné dans le canal Monde",
        ],
        'vi' => [
            'titled' => "{name} nhắc bạn trong {title}",
            'city'   => "{name} nhắc bạn ở {city}",
            'world'  => "{name} nhắc bạn trong kênh Thế giới",
        ],
        'es' => [
            'titled' => "{name} te mencionó en {title}",
            'city'   => "{name} te mencionó en {city}",
            'world'  => "{name} te mencionó en el canal Mundo",
        ],
        'it' => [
            'titled' => "{name} ti ha menzionato in {title}",
            'city'   => "{name} ti ha menzionato nella chat di {city}",
            'world'  => "{name} ti ha menzionato nel canale Mondo",
        ],
        'pt-br' => [
            'titled' => "{name} te mencionou em {title}",
            'city'   => "{name} te mencionou em {city}",
            'world'  => "{name} te mencionou no canal Mundo",
        ],
        'pt-pt' => [
            'titled' => "{name} mencionou-te em {title}",
            'city'   => "{name} mencionou-te em {city}",
            'world'  => "{name} mencionou-te no canal Mundo",
        ],
        'de' => [
            'titled' => "{name} hat dich in {title} erwähnt",
            'city'   => "{name} hat dich in {city} erwähnt",
            'world'  => "{name} hat dich im Welt-Kanal erwähnt",
        ],
        'nl' => [
            'titled' => "{name} heeft je vermeld in {title}",
            'city'   => "{name} heeft je vermeld in {city}",
            'world'  => "{name} heeft je vermeld in het World-kanaal",
        ],
        'zh-hans' => [
            'titled' => "{name} 在 {title} 里提到了你",
            'city'   => "{name} 在 {city} 提到了你",
            'world'  => "{name} 在 World 频道提到了你",
        ],
        'zh-hant' => [
            'titled' => "{name} 在 {title} 提到你",
            'city'   => "{name} 在 {city} 提到你",
            'world'  => "{name} 在 World 頻道提到你",
        ],
        'ja' => [
            'titled' => "{name}さんが{title}であなたをメンションしました",
            'city'   => "{name}さんが{city}であなたをメンションしました",
            'world'  => "{name}さんがWorldチャンネルであなたをメンションしました",
        ],
        'ko' => [
            'titled' => "{name} 님이 {title}에서 나를 언급했어요",
            'city'   => "{name} 님이 {city}에서 나를 언급했어요",
            'world'  => "{name} 님이 세계 채널에서 나를 언급했어요",
        ],
        'fil' => [
            'titled' => "Ni-mention ka ni {name} sa {title}",
            'city'   => "Ni-mention ka ni {name} sa {city}",
            'world'  => "Ni-mention ka ni {name} sa World channel",
        ],
        'th' => [
            'titled' => "{name} กล่าวถึงคุณใน {title}",
            'city'   => "{name} กล่าวถึงคุณใน {city}",
            'world'  => "{name} กล่าวถึงคุณในแชนเนล World",
        ],
        'id' => [
            'titled' => "{name} nge-mention kamu di {title}",
            'city'   => "{name} nge-mention kamu di {city}",
            'world'  => "{name} nge-mention kamu di channel World",
        ],
        'hi' => [
            'titled' => "{name} ने आपको {title} में मेंशन किया",
            'city'   => "{name} ने आपको {city} में मेंशन किया",
            'world'  => "{name} ने आपको World चैनल में मेंशन किया",
        ],
        'ru' => [
            'titled' => "{name} упоминает тебя в {title}",
            'city'   => "{name} упоминает тебя в чате города {city}",
            'world'  => "{name} упоминает тебя в канале «Мир»",
        ],
        'ar' => [
            'titled' => "{name} ذكرك في {title}",
            'city'   => "{name} ذكرك في {city}",
            'world'  => "{name} ذكرك في قناة العالم",
        ],
    ];

    /** True if we have translations for this type - lets callers skip the locale lookup. */
    public static function isTranslatable(string $type): bool
    {
        return $type === 'mention' || $type === 'friend_added' || isset(self::T[$type]) || isset(self::SCORING[$type]);
    }

    /** @return array{0: ?string, 1: ?string} [title, body]; nulls mean "keep caller's text". */
    public static function render(string $type, string $locale, array $data): array
    {
        if (!in_array($locale, self::SUPPORTED, true)) return [null, null];

        $params = [
            '{name}'       => self::name($type, $data),
            // City names as the app shows them in this locale ("Saigon", vi "Sài Gòn").
            '{city}'       => CityNames::short((string) ($data['cityName'] ?? ''), $locale),
            // Cross-city heads-up: {originCity} is where the challenge was
            // CREATED, {city} is the RECIPIENT's city (where they live).
            '{originCity}' => CityNames::short((string) ($data['originCityName'] ?? ''), $locale),
            // challengeTitle joins the fallback chain so the challenge_* push
            // bodies can interpolate the challenge name from their callers.
            '{title}'      => (string) ($data['eventTitle'] ?? $data['topicTitle'] ?? $data['challengeTitle'] ?? $data['title'] ?? ''),
        ];

        if ($type === 'mention') {
            // titled = event/topic/challenge (has {title}); world = World channel
            // (scope=world); else city (interpolates the {city} name). challengeTitle
            // MUST be in this check or challenge mentions fall to the city variant
            // and render "mentioned you at " with an empty city name.
            $hasTitle = ($data['eventTitle'] ?? $data['topicTitle'] ?? $data['challengeTitle'] ?? null) !== null;
            $variant  = $hasTitle ? 'titled' : (($data['scope'] ?? null) === 'world' ? 'world' : 'city');
            $titleTpl = self::MENTION[$locale][$variant] ?? self::MENTION[$locale]['city'];
            return [strtr($titleTpl, $params), null];
        }

        if (isset(self::SCORING[$type])) {
            return self::scoring($type, $locale, $data);
        }

        // friend_added is a legacy alias for the accepted-request copy.
        if ($type === 'friend_added') $type = 'friend_request_accepted';

        $tpl = self::T[$type][$locale] ?? null;
        if ($tpl === null) return [null, null];

        $title = strtr($tpl[0], $params);
        $body  = $tpl[1] !== null ? strtr($tpl[1], $params) : null;
        return [$title, $body];
    }

    /**
     * A scoring v2 notification's [title, body] in $locale ('en' = the source text), the variant
     * from $data['variant']. [null, null] for an unknown type or locale.
     */
    public static function scoring(string $type, string $locale, array $data): array
    {
        $variants = self::SCORING[$type] ?? null;
        if ($variants === null) return [null, null];
        $tpl = ($variants[(string) ($data['variant'] ?? 'default')] ?? $variants['default'] ?? [])[$locale] ?? null;
        if ($tpl === null) return [null, null];
        $params = [];
        foreach (['rank', 'points', 'gap', 'prev', 'days', 'medal', 'name', 'count', 'max'] as $k) {
            $params['{' . $k . '}'] = (string) ($data[$k] ?? '');
        }
        // Ranks read as ordinals in the language ("3rd", "3e", "第3名"), never "#3" (owner's rule).
        foreach (['rank', 'prev'] as $k) {
            $params['{' . $k . '_ordinal}'] = isset($data[$k]) && $data[$k] !== '' ? Ordinal::format((int) $data[$k], $locale) : '';
        }
        return [strtr($tpl[0], $params), strtr($tpl[1], $params)];
    }

    /** Resolve the actor name from whichever data key the call site used. */
    private static function name(string $type, array $data): string
    {
        $key = match ($type) {
            'city_join'                => 'arriverName',
            'world_arrival'            => 'nickname',
            'friend_request_accepted',
            'friend_added'             => 'accepterName',
            'vibe_received',
            'wave',
            'wave_back'                => 'actorName',
            'profile_view'             => 'viewerName',
            'join_request'             => 'requesterName',
            'challenge_invitation'     => 'inviterName',
            'challenge_group_join',
            'challenge_proof_submitted' => 'acceptorName',
            // challenge_international_target uses {originCity} not {name}.
            default                    => 'senderName',
        };
        return (string) ($data[$key] ?? $data['name'] ?? $data['senderName'] ?? '');
    }
}
