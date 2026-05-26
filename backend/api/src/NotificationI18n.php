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
 * Only fr/vi are translated; English is the source of truth in the call sites.
 * Conventions (match the app i18n rules): "tu" form; the brand word "vibe"
 * stays English.
 */
final class NotificationI18n
{
    private const SUPPORTED = ['fr', 'vi'];

    // [type][locale] => [titleTemplate, bodyTemplate|null]
    // bodyTemplate null ⇒ keep the caller's body (preview / proper nouns / no body).
    private const T = [
        'city_join' => [
            'fr' => ["👀 Quelqu'un est arrivé à {city}", "{name} vient d'arriver"],
            'vi' => ["👀 Có người vừa đến {city}",        "{name} vừa đến"],
        ],
        'new_event' => [
            'fr' => ["🔥 Nouvel événement à {city}", null],
            'vi' => ["🔥 Sự kiện mới ở {city}",     null],
        ],
        'channel_message' => [
            'fr' => ["{name} dans le chat de la ville", null],
            'vi' => ["{name} trong chat thành phố",     null],
        ],
        'event_message' => [
            'fr' => ["{name} dans {title}", null],
            'vi' => ["{name} trong {title}", null],
        ],
        'topic_message' => [
            'fr' => ["{name} dans {title}", null],
            'vi' => ["{name} trong {title}", null],
        ],
        'dm_message' => [
            'fr' => ["{name} t'a envoyé un message",          null],
            'vi' => ["{name} đã gửi cho bạn một tin nhắn",     null],
        ],
        'event_join' => [
            'fr' => ["👋 {name} a rejoint {title}",   null],
            'vi' => ["👋 {name} đã tham gia {title}", null],
        ],
        'friend_request_received' => [
            'fr' => ["{name} t'a envoyé une demande d'ami",      null],
            'vi' => ["{name} đã gửi cho bạn lời mời kết bạn",     null],
        ],
        'friend_request_accepted' => [
            'fr' => ["{name} a accepté ta demande d'ami 🎉",            null],
            'vi' => ["{name} đã chấp nhận lời mời kết bạn của bạn 🎉",   null],
        ],
        'vibe_received' => [
            'fr' => ["{name} t'a envoyé une vibe ✨",         null],
            'vi' => ["{name} đã gửi cho bạn một vibe ✨",      null],
        ],
        'profile_view' => [
            'fr' => ["👀 {name} a regardé ton profil",   null],
            'vi' => ["👀 {name} đã xem hồ sơ của bạn",    null],
        ],
        'join_request' => [
            'fr' => ["{name} veut rejoindre",  "{name} a demandé à rejoindre {title}"],
            'vi' => ["{name} muốn tham gia",   "{name} đã yêu cầu tham gia {title}"],
        ],
        'join_request_accepted' => [
            'fr' => ["Tu y es ! 🎉",        "{name} t'a ajouté à {title}"],
            'vi' => ["Bạn được nhận! 🎉",   "{name} đã thêm bạn vào {title}"],
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
