<?php

declare(strict_types=1);

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
        // Take-on request - fires to the CREATOR when a registered user
        // hits "Accept" on their open challenge. Body references the
        // challenge title (proper user content, kept verbatim).
        'challenge_takeon_request' => [
            'fr'      => ["Nouvelle demande", "{name} veut relever « {title} »"],
            'vi'      => ["Có người muốn nhận lời", "{name} muốn nhận \"{title}\""],
            'es'      => ["Nueva solicitud", "{name} quiere aceptar «{title}»"],
            'it'      => ["Nuova richiesta", "{name} vuole accettare «{title}»"],
            'pt-br'   => ["Novo pedido", "{name} quer encarar \"{title}\""],
            'pt-pt'   => ["Novo pedido",                                "{name} quer aceitar \"{title}\""],
            'de'      => ["Neue Anfrage", "{name} will „{title}“ annehmen"],
            'nl'      => ["Nieuw verzoek", "{name} wil \"{title}\" aangaan"],
            'zh-hans' => ["有人想接招", "{name} 想接下「{title}」"],
            'zh-hant' => ["有人想接挑戰", "{name} 想接下「{title}」"],
            'ja'      => ["新しいリクエスト", "{name}さんが「{title}」に挑戦したがっています"],
            'ko'      => ["새 도전 신청", "{name} 님이 \"{title}\" 챌린지에 도전하고 싶대요"],
            'fil'     => ["Bagong request", "Gustong gawin ni {name} ang \"{title}\""],
            'th'      => ["มีคนขอรับคำท้า", "{name} อยากรับคำท้า \"{title}\""],
            'id'      => ["Permintaan baru", "{name} mau ikut \"{title}\""],
            'hi'      => ["नई रिक्वेस्ट",                                  "{name} \"{title}\" लेना चाहते हैं"],
            'ru'      => ["Новая заявка",                                "{name} хочет принять «{title}»"],
            'ar'      => ["طلب جديد", "{name} يريد خوض «{title}»"],
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
        // Take-on approved - fires to the ACCEPTOR when the creator
        // accepts their request. Time to plan the meet-up.
        'challenge_takeon_approved' => [
            'fr'      => ["Défi accepté", "{name} a accepté ta demande pour « {title} ». On s'organise !"],
            'vi'      => ["Bạn được nhận rồi!", "{name} đồng ý cho bạn nhận \"{title}\". Lên kèo thôi!"],
            'es'      => ["Reto aceptado", "{name} aceptó tu solicitud para «{title}». ¡A organizarse!"],
            'it'      => ["Sfida accettata", "{name} ha accettato la tua richiesta per «{title}». Ora organizzatevi!"],
            'pt-br'   => ["Pedido aceito", "{name} aceitou seu pedido pra \"{title}\". Hora de combinar!"],
            'pt-pt'   => ["Desafio aceite",      "{name} aceitou o teu pedido para \"{title}\". Hora de planear!"],
            'de'      => ["Challenge angenommen", "{name} hat deine Anfrage zu „{title}“ angenommen. Zeit zum Planen!"],
            'nl'      => ["Verzoek geaccepteerd", "{name} heeft je verzoek voor \"{title}\" geaccepteerd. Tijd om te plannen!"],
            'zh-hans' => ["挑战接上了", "{name} 接受了你对「{title}」的请求，快约个时间吧！"],
            'zh-hant' => ["挑戰接受了", "{name} 接受了你對「{title}」的請求。來約時間吧！"],
            'ja'      => ["リクエストが承認されました", "{name}さんが「{title}」のリクエストを承認。予定を立てよう！"],
            'ko'      => ["도전 수락!", "{name} 님이 \"{title}\" 도전을 수락했어요. 이제 약속을 잡아요!"],
            'fil'     => ["Tanggap ka na!", "Tinanggap ni {name} ang request mo para sa \"{title}\". Magplano na kayo!"],
            'th'      => ["คำขอผ่านแล้ว!", "{name} ตอบรับคำขอ \"{title}\" ของคุณ ได้เวลาวางแผนแล้ว!"],
            'id'      => ["Tantangan diterima", "{name} nerima permintaanmu untuk \"{title}\". Yuk, atur rencananya!"],
            'hi'      => ["चैलेंज मंज़ूर", "{name} ने \"{title}\" के लिए आपकी रिक्वेस्ट मान ली। अब प्लान बनाएं!"],
            'ru'      => ["Заявка принята", "{name}: заявка на «{title}» принята. Пора договариваться!"],
            'ar'      => ["تم قبول طلبك", "{name} قبل طلبك لـ«{title}». حان وقت التخطيط!"],
        ],
        // Take-on rejected - same surface, less happy outcome.
        'challenge_takeon_rejected' => [
            'fr'      => ["Demande refusée", "{name} a refusé ta demande pour « {title} »."],
            'vi'      => ["Yêu cầu bị từ chối", "{name} đã từ chối yêu cầu nhận \"{title}\"."],
            'es'      => ["Solicitud rechazada", "{name} rechazó tu solicitud para «{title}»."],
            'it'      => ["Richiesta rifiutata", "{name} ha rifiutato la tua richiesta per «{title}»."],
            'pt-br'   => ["Pedido recusado", "{name} recusou seu pedido pra \"{title}\"."],
            'pt-pt'   => ["Pedido recusado",         "{name} recusou o teu pedido para \"{title}\"."],
            'de'      => ["Anfrage abgelehnt", "{name} hat deine Anfrage zu „{title}“ abgelehnt."],
            'nl'      => ["Verzoek afgewezen", "{name} heeft je verzoek voor \"{title}\" afgewezen."],
            'zh-hans' => ["请求被拒绝", "{name} 拒绝了你对「{title}」的请求。"],
            'zh-hant' => ["請求被拒絕", "{name} 拒絕了你對「{title}」的請求。"],
            'ja'      => ["リクエストは見送られました", "{name}さんが「{title}」のリクエストを見送りました。"],
            'ko'      => ["신청이 거절됐어요", "{name} 님이 \"{title}\" 신청을 거절했어요."],
            'fil'     => ["Hindi tinanggap ang request", "Tinanggihan ni {name} ang request mo para sa \"{title}\"."],
            'th'      => ["คำขอไม่ผ่าน", "{name} ปฏิเสธคำขอ \"{title}\" ของคุณ"],
            'id'      => ["Permintaan ditolak",      "{name} menolak permintaanmu untuk \"{title}\"."],
            'hi'      => ["रिक्वेस्ट नामंज़ूर", "{name} ने \"{title}\" के लिए आपकी रिक्वेस्ट नहीं मानी।"],
            'ru'      => ["Заявка отклонена", "{name}: заявка на «{title}» отклонена."],
            'ar'      => ["تم رفض الطلب", "{name} رفض طلبك لـ«{title}»."],
        ],
        // Creator restarted the challenge from zero → the removed taker is told.
        'challenge_restarted' => [
            'fr'      => ["Défi relancé", "{name} a relancé « {title} », ta participation repart à zéro"],
            'vi'      => ["Thử thách chơi lại từ đầu", "{name} đã cho \"{title}\" chơi lại từ đầu - lượt tham gia của bạn đã bị hủy"],
            'es'      => ["Reto reiniciado", "{name} reinició «{title}» desde cero"],
            'it'      => ["Sfida ricominciata", "{name} ha fatto ripartire «{title}» da zero: la tua partecipazione è annullata"],
            'pt-br'   => ["Desafio reiniciado", "{name} reiniciou \"{title}\" e zerou a participação"],
            'pt-pt'   => ["Desafio reiniciado",       "{name} reiniciou \"{title}\" - a participação foi reposta"],
            'de'      => ["Challenge neu gestartet", "{name} hat „{title}“ neu gestartet, deine Teilnahme wurde zurückgesetzt"],
            'nl'      => ["Challenge opnieuw gestart", "{name} heeft \"{title}\" opnieuw gestart, je deelname is gereset"],
            'zh-hans' => ["挑战重新开始", "{name} 重新开始了「{title}」，参与记录已重置"],
            'zh-hant' => ["挑戰重新開始", "{name} 重新開始了「{title}」，參與進度已重置"],
            'ja'      => ["チャレンジがリスタート", "{name}さんが「{title}」をやり直しました。参加はリセットされています"],
            'ko'      => ["챌린지 다시 시작", "{name} 님이 \"{title}\" 챌린지를 처음부터 다시 시작해서 참여가 초기화됐어요"],
            'fil'     => ["Ni-restart ang challenge", "Ni-restart ni {name} ang \"{title}\", na-reset ang pagsali mo"],
            'th'      => ["ชาเลนจ์เริ่มใหม่แล้ว", "{name} เริ่ม \"{title}\" ใหม่ การเข้าร่วมถูกรีเซ็ตแล้ว"],
            'id'      => ["Tantangan dimulai ulang", "{name} memulai ulang \"{title}\", partisipasimu direset"],
            'hi'      => ["चैलेंज फिर से शुरू", "{name} ने \"{title}\" फिर से शुरू किया, आपकी भागीदारी रीसेट हो गई"],
            'ru'      => ["Челлендж перезапущен", "{name}: «{title}» запущен заново, участие сброшено"],
            'ar'      => ["أُعيد إطلاق التحدي", "{name} أعاد إطلاق «{title}»، وأُعيد ضبط مشاركتك"],
        ],
        // Taker abandoned an active take-on → the creator's challenge reopens.
        'challenge_acceptor_left' => [
            'fr'      => ["Défi abandonné", "{name} a quitté le défi « {title} »"],
            'vi'      => ["Có người bỏ thử thách", "{name} đã rời thử thách \"{title}\""],
            'es'      => ["Reto abandonado", "{name} dejó el reto «{title}»"],
            'it'      => ["Sfida abbandonata", "{name} ha lasciato la sfida «{title}»"],
            'pt-br'   => ["Alguém saiu do desafio", "{name} saiu do desafio \"{title}\""],
            'pt-pt'   => ["Desafio abandonado", "{name} saiu do desafio \"{title}\""],
            'de'      => ["Challenge verlassen", "{name} hat die Challenge „{title}“ verlassen"],
            'nl'      => ["Challenge verlaten", "{name} heeft je challenge \"{title}\" verlaten"],
            'zh-hans' => ["有人退出了挑战", "{name} 退出了挑战「{title}」"],
            'zh-hant' => ["有人退出挑戰", "{name} 退出了挑戰「{title}」"],
            'ja'      => ["チャレンジから離脱", "{name}さんが「{title}」から抜けました"],
            'ko'      => ["도전자가 나갔어요", "{name} 님이 \"{title}\" 챌린지에서 나갔어요."],
            'fil'     => ["May umalis sa challenge", "Umalis si {name} sa \"{title}\"."],
            'th'      => ["มีคนถอนตัวจากชาเลนจ์", "{name} ออกจากชาเลนจ์ \"{title}\""],
            'id'      => ["Tantangan ditinggal", "{name} keluar dari tantangan \"{title}\""],
            'hi'      => ["चैलेंज छोड़ा", "{name} ने \"{title}\" छोड़ दिया।"],
            'ru'      => ["Участник вышел", "{name} больше не участвует в «{title}»."],
            'ar'      => ["انسحاب من التحدي", "{name} انسحب من التحدي «{title}»."],
        ],
        // Date proposed - fires to the OTHER party (whoever didn't
        // propose) when a date is put forward on the meet-up thread.
        // Until this push existed the propose-date flow was WS-only,
        // so a backgrounded recipient never learned a date was waiting.
        'challenge_date_proposed' => [
            'fr'      => ["Date proposée", "{name} propose une date pour « {title} »"],
            'vi'      => ["Có ngày hẹn mới", "{name} đề xuất ngày cho \"{title}\""],
            'es'      => ["Fecha propuesta", "{name} propone una fecha para «{title}»"],
            'it'      => ["Nuova data proposta", "{name} propone una data per «{title}»"],
            'pt-br'   => ["Nova data proposta", "{name} propôs uma data pra \"{title}\""],
            'pt-pt'   => ["Data proposta",             "{name} propôs uma data para \"{title}\""],
            'de'      => ["Termin vorgeschlagen", "{name} schlägt einen Termin für „{title}“ vor"],
            'nl'      => ["Nieuwe datum voorgesteld", "{name} stelt een datum voor bij \"{title}\""],
            'zh-hans' => ["有人提议了日期", "{name} 为「{title}」提议了一个日期"],
            'zh-hant' => ["有人提議日期", "{name} 為「{title}」提議了日期"],
            'ja'      => ["日程の提案", "{name}さんが「{title}」の日程を提案しました"],
            'ko'      => ["날짜 제안", "{name} 님이 \"{title}\" 날짜를 제안했어요"],
            'fil'     => ["May proposed na petsa", "Nag-propose si {name} ng petsa para sa \"{title}\""],
            'th'      => ["มีคนเสนอวันนัด", "{name} เสนอวันนัดสำหรับ \"{title}\""],
            'id'      => ["Ada usulan tanggal", "{name} ngusulin tanggal untuk \"{title}\""],
            'hi'      => ["नई तारीख़ का सुझाव", "{name} ने \"{title}\" के लिए तारीख़ सुझाई"],
            'ru'      => ["Новая дата", "{name} предлагает дату для «{title}»"],
            'ar'      => ["موعد مقترح", "{name} اقترح موعدًا لـ«{title}»"],
        ],
        // Date approved - fires to the PROPOSER when the other party
        // signs off on their proposal. Counterpart to
        // challenge_date_proposed; both lock the meet-up calendar.
        'challenge_date_approved' => [
            'fr'      => ["Date confirmée", "{name} a validé ta date pour « {title} »"],
            'vi'      => ["Chốt ngày rồi!", "{name} đã đồng ý ngày bạn chọn cho \"{title}\""],
            'es'      => ["Fecha confirmada", "{name} confirmó tu fecha para «{title}»"],
            'it'      => ["Data confermata", "{name} ha confermato la tua data per «{title}»"],
            'pt-br'   => ["Data confirmada", "{name} confirmou sua data pra \"{title}\""],
            'pt-pt'   => ["Data confirmada",           "{name} confirmou a tua data para \"{title}\""],
            'de'      => ["Termin bestätigt", "{name} hat deinen Termin für „{title}“ bestätigt"],
            'nl'      => ["Datum bevestigd", "{name} heeft je datum voor \"{title}\" bevestigd"],
            'zh-hans' => ["日期定了", "{name} 确认了你为「{title}」提议的日期"],
            'zh-hant' => ["日期確定了", "{name} 確認了你為「{title}」提議的日期"],
            'ja'      => ["日程が決まりました", "{name}さんが「{title}」の日程を承認しました"],
            'ko'      => ["날짜 확정", "{name} 님이 \"{title}\" 날짜를 확정했어요"],
            'fil'     => ["Confirmed na ang petsa", "Kinumpirma ni {name} ang petsa mo para sa \"{title}\""],
            'th'      => ["วันนัดลงตัวแล้ว", "{name} ตกลงวันที่คุณเสนอสำหรับ \"{title}\""],
            'id'      => ["Tanggal dikonfirmasi", "{name} setuju sama tanggalmu untuk \"{title}\""],
            'hi'      => ["तारीख़ पक्की", "{name} ने \"{title}\" के लिए आपकी तारीख़ मंज़ूर की"],
            'ru'      => ["Дата подтверждена", "{name} подтверждает твою дату для «{title}»"],
            'ar'      => ["تم تأكيد الموعد", "{name} أكّد موعدك لـ«{title}»"],
        ],
        // Verdict approved - fires to the ACCEPTOR after the meet-up,
        // the creator marked it as done.
        'challenge_verdict_approved' => [
            'fr'      => ["Défi accompli", "{name} a validé « {title} » : c'est accompli"],
            'vi'      => ["Hoàn thành thử thách!", "{name} xác nhận bạn đã hoàn thành \"{title}\""],
            'es'      => ["Reto cumplido", "{name} marcó «{title}» como cumplido"],
            'it'      => ["Sfida completata", "{name} ha segnato «{title}» come completata"],
            'pt-br'   => ["Desafio cumprido",         "{name} marcou \"{title}\" como cumprido"],
            'pt-pt'   => ["Desafio cumprido",         "{name} marcou \"{title}\" como cumprido"],
            'de'      => ["Challenge geschafft", "{name} hat „{title}“ als geschafft markiert"],
            'nl'      => ["Challenge geslaagd", "{name} heeft \"{title}\" op voltooid gezet"],
            'zh-hans' => ["挑战完成", "{name} 确认「{title}」已完成"],
            'zh-hant' => ["挑戰完成", "{name} 把「{title}」標記為完成"],
            'ja'      => ["チャレンジ達成", "{name}さんが「{title}」を達成にしました"],
            'ko'      => ["챌린지 성공!", "{name} 님이 \"{title}\" 챌린지를 완료로 표시했어요"],
            'fil'     => ["Tapos na!", "Minarkahan ni {name} na tapos na ang \"{title}\""],
            'th'      => ["ชาเลนจ์สำเร็จ!", "{name} ยืนยันว่า \"{title}\" สำเร็จแล้ว"],
            'id'      => ["Tantangan selesai", "{name} menandai \"{title}\" selesai"],
            'hi'      => ["चैलेंज पूरा!", "{name} ने \"{title}\" को पूरा मार्क किया"],
            'ru'      => ["Челлендж выполнен", "{name}: «{title}» выполнен!"],
            'ar'      => ["تم إنجاز التحدي", "{name} أكّد إنجاز «{title}»"],
        ],
        // Verdict rejected - same surface, no-show / didn't really meet.
        'challenge_verdict_rejected' => [
            'fr'      => ["Défi clôturé", "{name} a clôturé « {title} »"],
            'vi'      => ["Thử thách đã đóng",       "{name} đã đóng \"{title}\""],
            'es'      => ["Reto cerrado", "{name} cerró «{title}»"],
            'it'      => ["Sfida chiusa", "{name} ha chiuso «{title}»"],
            'pt-br'   => ["Desafio encerrado",        "{name} encerrou \"{title}\""],
            'pt-pt'   => ["Desafio encerrado",        "{name} encerrou \"{title}\""],
            'de'      => ["Challenge beendet", "{name} hat „{title}“ beendet"],
            'nl'      => ["Challenge afgesloten", "{name} heeft \"{title}\" afgesloten"],
            'zh-hans' => ["挑战已关闭", "{name} 关闭了「{title}」"],
            'zh-hant' => ["挑戰已關閉",                "{name} 關閉了「{title}」"],
            'ja'      => ["チャレンジ終了", "{name}さんが「{title}」を終了しました"],
            'ko'      => ["챌린지 종료", "{name} 님이 \"{title}\" 챌린지를 종료했어요"],
            'fil'     => ["Sarado na ang challenge", "Isinara ni {name} ang \"{title}\""],
            'th'      => ["ปิดชาเลนจ์แล้ว",            "{name} ปิด \"{title}\" แล้ว"],
            'id'      => ["Tantangan ditutup",        "{name} menutup \"{title}\""],
            'hi'      => ["चैलेंज बंद",                  "{name} ने \"{title}\" बंद किया"],
            'ru'      => ["Челлендж закрыт", "{name}: «{title}» закрыт"],
            'ar'      => ["تم إغلاق التحدي", "{name} أغلق «{title}»"],
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
        // Proof approved - fires to the ACCEPTOR after the creator's verdict.
        // Final terminal state for the acceptance.
        'challenge_proof_approved' => [
            'fr'      => ["Preuve validée", "{name} a validé ta preuve pour « {title} »"],
            'vi'      => ["Bằng chứng đã được duyệt", "{name} đã duyệt bằng chứng của bạn cho \"{title}\""],
            'es'      => ["Prueba aprobada", "{name} aprobó tu prueba para «{title}»"],
            'it'      => ["Prova approvata", "{name} ha approvato la tua prova per «{title}»"],
            'pt-br'   => ["Prova aprovada",         "{name} aprovou sua prova de \"{title}\""],
            'pt-pt'   => ["Prova aprovada",         "{name} aprovou a tua prova para \"{title}\""],
            'de'      => ["Beweis bestätigt", "{name} hat deinen Beweis für „{title}“ bestätigt"],
            'nl'      => ["Bewijs goedgekeurd", "{name} heeft je bewijs voor \"{title}\" goedgekeurd"],
            'zh-hans' => ["证明通过了", "{name} 通过了你为「{title}」提交的证明"],
            'zh-hant' => ["證明通過了", "{name} 通過了你為「{title}」傳的證明"],
            'ja'      => ["写真が承認されました", "{name}さんが「{title}」の写真を承認しました"],
            'ko'      => ["인증 통과!", "{name} 님이 \"{title}\" 인증 사진을 승인했어요"],
            'fil'     => ["Tanggap ang proof mo", "Tinanggap ni {name} ang proof mo para sa \"{title}\""],
            'th'      => ["หลักฐานผ่านแล้ว", "{name} ยืนยันหลักฐานของคุณสำหรับ \"{title}\""],
            'id'      => ["Bukti diterima", "{name} nerima buktimu untuk \"{title}\""],
            'hi'      => ["प्रूफ मंज़ूर", "{name} ने \"{title}\" के लिए आपका प्रूफ मंज़ूर किया"],
            'ru'      => ["Фото принято", "{name}: твоё фото для «{title}» принято"],
            'ar'      => ["تم قبول الإثبات", "{name} قبل إثباتك لـ«{title}»"],
        ],
        // Proof rejected - fires to the ACCEPTOR. The reason is intentionally
        // NOT in the localized body: it's user-typed content that the creator
        // wrote in their own language, and the recipient sees it in full on
        // the in-app screen. Keeping the push short + the screen detailed
        // reads better than a 200-char rejection in the notification tray.
        'challenge_proof_rejected' => [
            'fr'      => ["Preuve refusée", "{name} a refusé ta preuve pour « {title} »"],
            'vi'      => ["Bằng chứng bị từ chối", "{name} đã từ chối bằng chứng của bạn cho \"{title}\""],
            'es'      => ["Prueba rechazada", "{name} rechazó tu prueba para «{title}»"],
            'it'      => ["Prova rifiutata", "{name} ha rifiutato la tua prova per «{title}»"],
            'pt-br'   => ["Prova recusada", "{name} recusou sua prova de \"{title}\""],
            'pt-pt'   => ["Prova rejeitada",        "{name} rejeitou a tua prova para \"{title}\""],
            'de'      => ["Beweis abgelehnt", "{name} hat deinen Beweis für „{title}“ abgelehnt"],
            'nl'      => ["Bewijs afgewezen", "{name} heeft je bewijs voor \"{title}\" afgewezen"],
            'zh-hans' => ["证明没通过", "{name} 没通过你为「{title}」提交的证明"],
            'zh-hant' => ["證明沒通過", "{name} 退回了你為「{title}」傳的證明"],
            'ja'      => ["写真が却下されました", "{name}さんが「{title}」の写真を却下しました"],
            'ko'      => ["인증이 거절됐어요", "{name} 님이 \"{title}\" 인증 사진을 거절했어요"],
            'fil'     => ["Hindi tinanggap ang proof", "Tinanggihan ni {name} ang proof mo para sa \"{title}\""],
            'th'      => ["หลักฐานไม่ผ่าน", "{name} ปฏิเสธหลักฐานของคุณสำหรับ \"{title}\""],
            'id'      => ["Bukti ditolak",          "{name} menolak buktimu untuk \"{title}\""],
            'hi'      => ["प्रूफ नामंज़ूर", "{name} ने \"{title}\" के लिए आपका प्रूफ नामंज़ूर किया"],
            'ru'      => ["Фото не принято", "{name}: твоё фото для «{title}» не принято"],
            'ar'      => ["تم رفض الإثبات", "{name} رفض إثباتك لـ«{title}»"],
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
        // First rating just landed → the OTHER party (the recipient) hasn't
        // rated yet. Tapping the push opens the challenge so the
        // RatePromptLaunchGate surfaces the RateSheet.
        'rating_received' => [
            'fr'      => ["{name} t'a donné une note", "À toi de noter !"],
            'vi'      => ["{name} vừa chấm điểm bạn", "Tới lượt bạn chấm lại nè"],
            'es'      => ["{name} te valoró", "Ahora te toca a ti"],
            'it'      => ["Hai ricevuto una valutazione da {name}", "Ora tocca a te valutare"],
            'pt-br'   => ["{name} te avaliou",               "Sua vez de avaliar"],
            'pt-pt'   => ["{name} avaliou-te", "Agora avalias tu"],
            'de'      => ["{name} hat dich bewertet",        "Du bist dran"],
            'nl'      => ["{name} heeft je beoordeeld", "Jij bent aan de beurt om te beoordelen"],
            'zh-hans' => ["{name} 给你打了分", "轮到你给 TA 打分了"],
            'zh-hant' => ["{name} 給你評分了", "換你評分了"],
            'ja'      => ["{name}さんがあなたを評価しました", "次はあなたが評価する番です"],
            'ko'      => ["{name} 님이 평가를 남겼어요", "이제 평가할 차례예요"],
            'fil'     => ["Ni-rate ka ni {name}", "Ikaw naman ang mag-rate"],
            'th'      => ["{name} ให้คะแนนคุณแล้ว", "ตาคุณให้คะแนนบ้างแล้ว"],
            'id'      => ["{name} udah ngasih kamu nilai", "Sekarang giliranmu ngasih nilai"],
            'hi'      => ["{name} ने आपको रेट किया",           "अब आपकी बारी"],
            'ru'      => ["{name} ставит тебе оценку", "Твоя очередь оценить"],
            'ar'      => ["{name} قيّمك", "حان دورك للتقييم"],
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
        return $type === 'mention' || $type === 'friend_added' || isset(self::T[$type]);
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

        // friend_added is a legacy alias for the accepted-request copy.
        if ($type === 'friend_added') $type = 'friend_request_accepted';

        $tpl = self::T[$type][$locale] ?? null;
        if ($tpl === null) return [null, null];

        $title = strtr($tpl[0], $params);
        $body  = $tpl[1] !== null ? strtr($tpl[1], $params) : null;
        return [$title, $body];
    }

    /** Resolve the actor name from whichever data key the call site used. */
    private static function name(string $type, array $data): string
    {
        $key = match ($type) {
            'city_join'                => 'arriverName',
            'friend_request_accepted',
            'friend_added'             => 'accepterName',
            'vibe_received'            => 'actorName',
            'profile_view'             => 'viewerName',
            'join_request'             => 'requesterName',
            'challenge_invitation'     => 'inviterName',
            'challenge_takeon_request',
            'challenge_group_join',
            'challenge_acceptor_left',
            'challenge_proof_submitted' => 'acceptorName',
            'challenge_takeon_approved',
            'challenge_takeon_rejected',
            'challenge_restarted',
            'challenge_proof_approved',
            'challenge_proof_rejected' => 'creatorName',
            // verdict_* both already pass senderName=creatorName, so the
            // default key picks it up - no explicit mapping needed.
            // challenge_international_target uses {originCity} not {name}.
            default                    => 'senderName',
        };
        return (string) ($data[$key] ?? $data['name'] ?? $data['senderName'] ?? '');
    }
}
