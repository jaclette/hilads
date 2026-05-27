<?php

declare(strict_types=1);

/**
 * Localized notification text (push + in-app bell).
 *
 * render($type, $locale, $data) returns [title, body] for the recipient's
 * locale, or [null, null] to mean "keep the caller's English text" — which is
 * the case for English/unknown locales and for any field we don't translate
 * (message previews and proper nouns like event/venue/city names stay as-is).
 *
 * Only fr/vi/es/it/pt-br/pt-pt/de/nl/zh-hans/zh-hant/ja are translated; English is the source of truth in the call sites.
 * Conventions (match the app i18n rules): "tu" form; the brand word "vibe"
 * stays English.
 */
final class NotificationI18n
{
    private const SUPPORTED = ['fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja'];

    // [type][locale] => [titleTemplate, bodyTemplate|null]
    // bodyTemplate null ⇒ keep the caller's body (preview / proper nouns / no body).
    private const T = [
        'city_join' => [
            'fr' => ["👀 Quelqu'un est arrivé à {city}", "{name} vient d'arriver"],
            'vi' => ["👀 Có người vừa đến {city}",        "{name} vừa đến"],
            'es' => ["👀 Alguien acaba de llegar a {city}", "{name} acaba de llegar"],
            'it' => ["👀 Qualcuno è appena arrivato a {city}", "{name} è appena arrivato"],
            'pt-br' => ["👀 Alguém acabou de chegar em {city}", "{name} acabou de chegar"],
            'pt-pt' => ["👀 Alguém acabou de chegar a {city}",  "{name} acabou de chegar"],
            'de'    => ["👀 Jemand ist gerade in {city} angekommen", "{name} ist gerade angekommen"],
            'nl'    => ["👀 Er is net iemand aangekomen in {city}", "{name} is net aangekomen"],
            'zh-hans' => ["👀 有人刚到达{city}", "{name} 刚刚到达"],
            'zh-hant' => ["👀 有人剛抵達{city}", "{name} 剛剛抵達"],
            'ja'      => ["👀 {city}に誰かが到着しました", "{name} が到着しました"],
        ],
        'new_event' => [
            'fr' => ["🔥 Nouvel événement à {city}", null],
            'vi' => ["🔥 Sự kiện mới ở {city}",     null],
            'es' => ["🔥 Nuevo evento en {city}",   null],
            'it' => ["🔥 Nuovo evento a {city}",    null],
            'pt-br' => ["🔥 Novo evento em {city}", null],
            'pt-pt' => ["🔥 Novo evento em {city}", null],
            'de'    => ["🔥 Neues Event in {city}", null],
            'nl'    => ["🔥 Nieuw evenement in {city}", null],
            'zh-hans' => ["🔥 {city}有新活动", null],
            'zh-hant' => ["🔥 {city}有新活動", null],
            'ja'      => ["🔥 {city}で新しいイベント", null],
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
            'zh-hans' => ["{name} 在城市聊天里",          null],
            'zh-hant' => ["{name} 在城市聊天室",          null],
            'ja'      => ["{name}（シティチャット）",      null],
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
            'zh-hans' => ["{name} 在 {title}", null],
            'zh-hant' => ["{name} 在 {title}", null],
            'ja'      => ["{name}（{title}）", null],
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
            'zh-hans' => ["{name} 在 {title}", null],
            'zh-hant' => ["{name} 在 {title}", null],
            'ja'      => ["{name}（{title}）", null],
        ],
        'dm_message' => [
            'fr' => ["{name} t'a envoyé un message",          null],
            'vi' => ["{name} đã gửi cho bạn một tin nhắn",     null],
            'es' => ["{name} te ha enviado un mensaje",       null],
            'it' => ["{name} ti ha inviato un messaggio",     null],
            'pt-br' => ["{name} te enviou uma mensagem",      null],
            'pt-pt' => ["{name} enviou-te uma mensagem",      null],
            'de'    => ["{name} hat dir eine Nachricht geschickt", null],
            'nl'    => ["{name} heeft je een bericht gestuurd",   null],
            'zh-hans' => ["{name} 给你发了一条消息",              null],
            'zh-hant' => ["{name} 傳了一則訊息給你",              null],
            'ja'      => ["{name} からメッセージが届きました",     null],
        ],
        'event_join' => [
            'fr' => ["👋 {name} a rejoint {title}",   null],
            'vi' => ["👋 {name} đã tham gia {title}", null],
            'es' => ["👋 {name} se unió a {title}",   null],
            'it' => ["👋 {name} si è unito a {title}", null],
            'pt-br' => ["👋 {name} entrou em {title}",   null],
            'pt-pt' => ["👋 {name} juntou-se a {title}", null],
            'de'    => ["👋 {name} ist {title} beigetreten", null],
            'nl'    => ["👋 {name} doet mee aan {title}",    null],
            'zh-hans' => ["👋 {name} 加入了 {title}",        null],
            'zh-hant' => ["👋 {name} 加入了 {title}",        null],
            'ja'      => ["👋 {name} が {title} に参加しました", null],
        ],
        'friend_request_received' => [
            'fr' => ["{name} t'a envoyé une demande d'ami",      null],
            'vi' => ["{name} đã gửi cho bạn lời mời kết bạn",     null],
            'es' => ["{name} te ha enviado una solicitud de amistad", null],
            'it' => ["{name} ti ha inviato una richiesta di amicizia", null],
            'pt-br' => ["{name} te enviou um pedido de amizade",      null],
            'pt-pt' => ["{name} enviou-te um pedido de amizade",      null],
            'de'    => ["{name} hat dir eine Freundschaftsanfrage geschickt", null],
            'nl'    => ["{name} heeft je een vriendschapsverzoek gestuurd",   null],
            'zh-hans' => ["{name} 给你发送了好友请求",                       null],
            'zh-hant' => ["{name} 傳送了好友邀請給你",                       null],
            'ja'      => ["{name} から友達リクエストが届きました",            null],
        ],
        'friend_request_accepted' => [
            'fr' => ["{name} a accepté ta demande d'ami 🎉",            null],
            'vi' => ["{name} đã chấp nhận lời mời kết bạn của bạn 🎉",   null],
            'es' => ["{name} ha aceptado tu solicitud de amistad 🎉",   null],
            'it' => ["{name} ha accettato la tua richiesta di amicizia 🎉", null],
            'pt-br' => ["{name} aceitou seu pedido de amizade 🎉",    null],
            'pt-pt' => ["{name} aceitou o teu pedido de amizade 🎉",   null],
            'de'    => ["{name} hat deine Freundschaftsanfrage angenommen 🎉", null],
            'nl'    => ["{name} heeft je vriendschapsverzoek geaccepteerd 🎉", null],
            'zh-hans' => ["{name} 接受了你的好友请求 🎉",                     null],
            'zh-hant' => ["{name} 接受了你的好友邀請 🎉",                     null],
            'ja'      => ["{name} があなたの友達リクエストを承認しました 🎉",   null],
        ],
        'vibe_received' => [
            'fr' => ["{name} t'a envoyé une vibe ✨",         null],
            'vi' => ["{name} đã gửi cho bạn một vibe ✨",      null],
            'es' => ["{name} te ha enviado una vibe ✨",      null],
            'it' => ["{name} ti ha inviato una vibe ✨",      null],
            'pt-br' => ["{name} te enviou uma vibe ✨",       null],
            'pt-pt' => ["{name} enviou-te uma vibe ✨",       null],
            'de'    => ["{name} hat dir eine vibe geschickt ✨", null],
            'nl'    => ["{name} heeft je een vibe gestuurd ✨",  null],
            'zh-hans' => ["{name} 给你发了一个 vibe ✨",         null],
            'zh-hant' => ["{name} 傳了一個 vibe 給你 ✨",        null],
            'ja'      => ["{name} から vibe が届きました ✨",     null],
        ],
        'profile_view' => [
            'fr' => ["👀 {name} a regardé ton profil",   null],
            'vi' => ["👀 {name} đã xem hồ sơ của bạn",    null],
            'es' => ["👀 {name} ha visto tu perfil",      null],
            'it' => ["👀 {name} ha visto il tuo profilo", null],
            'pt-br' => ["👀 {name} viu seu perfil",       null],
            'pt-pt' => ["👀 {name} viu o teu perfil",     null],
            'de'    => ["👀 {name} hat dein Profil angesehen", null],
            'nl'    => ["👀 {name} heeft je profiel bekeken",  null],
            'zh-hans' => ["👀 {name} 看了你的个人资料",         null],
            'zh-hant' => ["👀 {name} 看了你的個人資料",         null],
            'ja'      => ["👀 {name} があなたのプロフィールを見ました", null],
        ],
        'join_request' => [
            'fr' => ["{name} veut rejoindre",  "{name} a demandé à rejoindre {title}"],
            'vi' => ["{name} muốn tham gia",   "{name} đã yêu cầu tham gia {title}"],
            'es' => ["{name} quiere unirse",   "{name} pidió unirse a {title}"],
            'it' => ["{name} vuole unirsi",    "{name} ha chiesto di unirsi a {title}"],
            'pt-br' => ["{name} quer entrar",       "{name} pediu para entrar em {title}"],
            'pt-pt' => ["{name} quer juntar-se",    "{name} pediu para se juntar a {title}"],
            'de'    => ["{name} möchte beitreten",  "{name} hat angefragt, {title} beizutreten"],
            'nl'    => ["{name} wil meedoen",       "{name} heeft gevraagd om mee te doen aan {title}"],
            'zh-hans' => ["{name} 想加入",          "{name} 申请加入 {title}"],
            'zh-hant' => ["{name} 想加入",          "{name} 申請加入 {title}"],
            'ja'      => ["{name} が参加を希望しています", "{name} が {title} への参加をリクエストしました"],
        ],
        'join_request_accepted' => [
            'fr' => ["Tu y es ! 🎉",        "{name} t'a ajouté à {title}"],
            'vi' => ["Bạn được nhận! 🎉",   "{name} đã thêm bạn vào {title}"],
            'es' => ["¡Ya estás dentro! 🎉", "{name} te ha añadido a {title}"],
            'it' => ["Ci sei! 🎉",          "{name} ti ha aggiunto a {title}"],
            'pt-br' => ["Você entrou! 🎉",   "{name} adicionou você a {title}"],
            'pt-pt' => ["Já estás dentro! 🎉", "{name} adicionou-te a {title}"],
            'de'    => ["Du bist dabei! 🎉",  "{name} hat dich zu {title} hinzugefügt"],
            'nl'    => ["Je bent erbij! 🎉",  "{name} heeft je toegevoegd aan {title}"],
            'zh-hans' => ["你加入了！🎉",     "{name} 把你加入了 {title}"],
            'zh-hant' => ["你加入了！🎉",     "{name} 把你加入了 {title}"],
            'ja'      => ["参加できました！🎉", "{name} があなたを {title} に追加しました"],
        ],
    ];

    // Mention is the only type whose title depends on where the mention happened.
    private const MENTION = [
        'fr' => [
            'titled' => "{name} t'a mentionné dans {title}",        // event / topic
            'city'   => "{name} t'a mentionné dans le chat de la ville",
        ],
        'vi' => [
            'titled' => "{name} đã nhắc đến bạn trong {title}",
            'city'   => "{name} đã nhắc đến bạn trong chat thành phố",
        ],
        'es' => [
            'titled' => "{name} te ha mencionado en {title}",
            'city'   => "{name} te ha mencionado en el chat de la ciudad",
        ],
        'it' => [
            'titled' => "{name} ti ha menzionato in {title}",
            'city'   => "{name} ti ha menzionato nella chat della città",
        ],
        'pt-br' => [
            'titled' => "{name} mencionou você em {title}",
            'city'   => "{name} mencionou você no chat da cidade",
        ],
        'pt-pt' => [
            'titled' => "{name} mencionou-te em {title}",
            'city'   => "{name} mencionou-te no chat da cidade",
        ],
        'de' => [
            'titled' => "{name} hat dich in {title} erwähnt",
            'city'   => "{name} hat dich im Stadt-Chat erwähnt",
        ],
        'nl' => [
            'titled' => "{name} heeft je genoemd in {title}",
            'city'   => "{name} heeft je genoemd in de stadschat",
        ],
        'zh-hans' => [
            'titled' => "{name} 在 {title} 提到了你",
            'city'   => "{name} 在城市聊天里提到了你",
        ],
        'zh-hant' => [
            'titled' => "{name} 在 {title} 提到了你",
            'city'   => "{name} 在城市聊天室提到了你",
        ],
        'ja' => [
            'titled' => "{name} が {title} であなたにメンションしました",
            'city'   => "{name} がシティチャットであなたにメンションしました",
        ],
    ];

    /** True if we have translations for this type — lets callers skip the locale lookup. */
    public static function isTranslatable(string $type): bool
    {
        return $type === 'mention' || $type === 'friend_added' || isset(self::T[$type]);
    }

    /** @return array{0: ?string, 1: ?string} [title, body]; nulls mean "keep caller's text". */
    public static function render(string $type, string $locale, array $data): array
    {
        if (!in_array($locale, self::SUPPORTED, true)) return [null, null];

        $params = [
            '{name}'  => self::name($type, $data),
            '{city}'  => (string) ($data['cityName'] ?? ''),
            '{title}' => (string) ($data['eventTitle'] ?? $data['topicTitle'] ?? $data['title'] ?? ''),
        ];

        if ($type === 'mention') {
            $hasTitle  = ($data['eventTitle'] ?? $data['topicTitle'] ?? null) !== null;
            $titleTpl  = self::MENTION[$locale][$hasTitle ? 'titled' : 'city'];
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
            default                    => 'senderName',
        };
        return (string) ($data[$key] ?? $data['name'] ?? $data['senderName'] ?? '');
    }
}
