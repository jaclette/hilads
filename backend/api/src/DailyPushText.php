<?php

declare(strict_types=1);

/**
 * Daily Challenge push phrases in the app's 18 other locales (English lives in
 * DailyPushes, unchanged). Fixed text written once, no provider. Phrased so no
 * plural or ordinal rule is needed ("#2", "Votes: 3"). Brand terms stay
 * English: Daily Challenge, Local Twist. "tu" form where the language has one.
 *
 * Placeholders: {text} challenge text, {rank}, {city}, {n}, {name}, {h} hours.
 */
final class DailyPushText
{
    public const KEYS = ['frame', 'world', 'city_best', 'city_rank', 'votes', 'winner', 'winner_nocity',
                         'reminder', 'digest_votes', 'digest_twist', 'picked_tomorrow', 'picked_today', 'top10'];

    private const T = [
        'fr' => [
            'frame' => "Daily Challenge du jour : {text}",
            'world' => "Hier, ta preuve était #{rank} dans le monde 🏆",
            'city_best' => "Hier, ta preuve était la meilleure de {city} 🔥",
            'city_rank' => "Hier, ta preuve était #{rank} à {city}.",
            'votes' => "Votes pour ta preuve d'hier : {n}.",
            'winner' => "Gagnant d'hier : {name} à {city} · ♥ {n}.",
            'winner_nocity' => "Gagnant d'hier : {name} · ♥ {n}.",
            'reminder' => "Plus que {h} h pour le Daily Challenge du jour.",
            'digest_votes' => "Votes pour ta preuve : {n}.",
            'digest_twist' => "Ont relevé ton Local Twist : {n}.",
            'picked_tomorrow' => "Ton Local Twist a été choisi pour le Daily Challenge de demain à {city} 🎉",
            'picked_today' => "Ton Local Twist a été choisi pour le Daily Challenge du jour à {city} 🎉",
            'top10' => "Tu es dans le top 10 du jour ! 🏆 Ta preuve est #{rank} dans le monde en ce moment.",
        ],
        'vi' => [
            'frame' => "Daily Challenge hôm nay: {text}",
            'world' => "Hôm qua bằng chứng của bạn đứng #{rank} thế giới 🏆",
            'city_best' => "Hôm qua bằng chứng của bạn hay nhất {city} 🔥",
            'city_rank' => "Hôm qua bằng chứng của bạn đứng #{rank} ở {city}.",
            'votes' => "Bình chọn cho bằng chứng hôm qua của bạn: {n}.",
            'winner' => "Người thắng hôm qua: {name} ở {city} · ♥ {n}.",
            'winner_nocity' => "Người thắng hôm qua: {name} · ♥ {n}.",
            'reminder' => "Chỉ còn {h} giờ cho Daily Challenge hôm nay.",
            'digest_votes' => "Bình chọn cho bằng chứng của bạn: {n}.",
            'digest_twist' => "Số người đã làm Local Twist của bạn: {n}.",
            'picked_tomorrow' => "Local Twist của bạn đã được chọn cho Daily Challenge ngày mai ở {city} 🎉",
            'picked_today' => "Local Twist của bạn đã được chọn cho Daily Challenge hôm nay ở {city} 🎉",
            'top10' => "Bạn đang trong top 10 hôm nay! 🏆 Bằng chứng của bạn đang đứng #{rank} thế giới.",
        ],
        'es' => [
            'frame' => "Daily Challenge de hoy: {text}",
            'world' => "Ayer tu prueba quedó #{rank} en el mundo 🏆",
            'city_best' => "Ayer tu prueba fue la mejor de {city} 🔥",
            'city_rank' => "Ayer tu prueba quedó #{rank} en {city}.",
            'votes' => "Votos a tu prueba de ayer: {n}.",
            'winner' => "Ganador de ayer: {name} en {city} · ♥ {n}.",
            'winner_nocity' => "Ganador de ayer: {name} · ♥ {n}.",
            'reminder' => "Solo quedan {h} h para el Daily Challenge de hoy.",
            'digest_votes' => "Votos a tu prueba: {n}.",
            'digest_twist' => "Completaron tu Local Twist: {n}.",
            'picked_tomorrow' => "Tu Local Twist fue elegido para el Daily Challenge de mañana en {city} 🎉",
            'picked_today' => "Tu Local Twist fue elegido para el Daily Challenge de hoy en {city} 🎉",
            'top10' => "¡Estás en el top 10 de hoy! 🏆 Tu prueba va #{rank} en el mundo ahora mismo.",
        ],
        'it' => [
            'frame' => "Daily Challenge di oggi: {text}",
            'world' => "Ieri la tua prova era #{rank} nel mondo 🏆",
            'city_best' => "Ieri la tua prova era la migliore di {city} 🔥",
            'city_rank' => "Ieri la tua prova era #{rank} a {city}.",
            'votes' => "Voti alla tua prova di ieri: {n}.",
            'winner' => "Vincitore di ieri: {name} a {city} · ♥ {n}.",
            'winner_nocity' => "Vincitore di ieri: {name} · ♥ {n}.",
            'reminder' => "Mancano solo {h} h al Daily Challenge di oggi.",
            'digest_votes' => "Voti alla tua prova: {n}.",
            'digest_twist' => "Hanno completato il tuo Local Twist: {n}.",
            'picked_tomorrow' => "Il tuo Local Twist è stato scelto per il Daily Challenge di domani a {city} 🎉",
            'picked_today' => "Il tuo Local Twist è stato scelto per il Daily Challenge di oggi a {city} 🎉",
            'top10' => "Sei nella top 10 di oggi! 🏆 La tua prova è #{rank} nel mondo in questo momento.",
        ],
        'pt-br' => [
            'frame' => "Daily Challenge de hoje: {text}",
            'world' => "Ontem sua prova ficou em #{rank} no mundo 🏆",
            'city_best' => "Ontem sua prova foi a melhor de {city} 🔥",
            'city_rank' => "Ontem sua prova ficou em #{rank} em {city}.",
            'votes' => "Votos na sua prova de ontem: {n}.",
            'winner' => "Vencedor de ontem: {name} em {city} · ♥ {n}.",
            'winner_nocity' => "Vencedor de ontem: {name} · ♥ {n}.",
            'reminder' => "Faltam só {h} h para o Daily Challenge de hoje.",
            'digest_votes' => "Votos na sua prova: {n}.",
            'digest_twist' => "Completaram seu Local Twist: {n}.",
            'picked_tomorrow' => "Seu Local Twist foi escolhido para o Daily Challenge de amanhã em {city} 🎉",
            'picked_today' => "Seu Local Twist foi escolhido para o Daily Challenge de hoje em {city} 🎉",
            'top10' => "Você está no top 10 de hoje! 🏆 Sua prova está em #{rank} no mundo agora.",
        ],
        'pt-pt' => [
            'frame' => "Daily Challenge de hoje: {text}",
            'world' => "Ontem a tua prova ficou em #{rank} no mundo 🏆",
            'city_best' => "Ontem a tua prova foi a melhor de {city} 🔥",
            'city_rank' => "Ontem a tua prova ficou em #{rank} em {city}.",
            'votes' => "Votos na tua prova de ontem: {n}.",
            'winner' => "Vencedor de ontem: {name} em {city} · ♥ {n}.",
            'winner_nocity' => "Vencedor de ontem: {name} · ♥ {n}.",
            'reminder' => "Faltam só {h} h para o Daily Challenge de hoje.",
            'digest_votes' => "Votos na tua prova: {n}.",
            'digest_twist' => "Completaram o teu Local Twist: {n}.",
            'picked_tomorrow' => "O teu Local Twist foi escolhido para o Daily Challenge de amanhã em {city} 🎉",
            'picked_today' => "O teu Local Twist foi escolhido para o Daily Challenge de hoje em {city} 🎉",
            'top10' => "Estás no top 10 de hoje! 🏆 A tua prova está em #{rank} no mundo neste momento.",
        ],
        'de' => [
            'frame' => "Daily Challenge von heute: {text}",
            'world' => "Gestern war dein Beweis #{rank} weltweit 🏆",
            'city_best' => "Gestern war dein Beweis der beste in {city} 🔥",
            'city_rank' => "Gestern war dein Beweis #{rank} in {city}.",
            'votes' => "Stimmen für deinen Beweis von gestern: {n}.",
            'winner' => "Gewinner von gestern: {name} in {city} · ♥ {n}.",
            'winner_nocity' => "Gewinner von gestern: {name} · ♥ {n}.",
            'reminder' => "Nur noch {h} Std. für die heutige Daily Challenge.",
            'digest_votes' => "Stimmen für deinen Beweis: {n}.",
            'digest_twist' => "Haben deinen Local Twist gemacht: {n}.",
            'picked_tomorrow' => "Dein Local Twist wurde für die Daily Challenge von morgen in {city} gewählt 🎉",
            'picked_today' => "Dein Local Twist wurde für die heutige Daily Challenge in {city} gewählt 🎉",
            'top10' => "Du bist in den Top 10 von heute! 🏆 Dein Beweis ist gerade #{rank} weltweit.",
        ],
        'nl' => [
            'frame' => "Daily Challenge van vandaag: {text}",
            'world' => "Gisteren stond je bewijs #{rank} wereldwijd 🏆",
            'city_best' => "Gisteren was je bewijs het beste van {city} 🔥",
            'city_rank' => "Gisteren stond je bewijs #{rank} in {city}.",
            'votes' => "Stemmen op je bewijs van gisteren: {n}.",
            'winner' => "Winnaar van gisteren: {name} in {city} · ♥ {n}.",
            'winner_nocity' => "Winnaar van gisteren: {name} · ♥ {n}.",
            'reminder' => "Nog maar {h} u voor de Daily Challenge van vandaag.",
            'digest_votes' => "Stemmen op je bewijs: {n}.",
            'digest_twist' => "Deden je Local Twist: {n}.",
            'picked_tomorrow' => "Je Local Twist is gekozen voor de Daily Challenge van morgen in {city} 🎉",
            'picked_today' => "Je Local Twist is gekozen voor de Daily Challenge van vandaag in {city} 🎉",
            'top10' => "Je staat in de top 10 van vandaag! 🏆 Je bewijs staat nu #{rank} wereldwijd.",
        ],
        'zh-hans' => [
            'frame' => "今天的 Daily Challenge：{text}",
            'world' => "昨天你的证明位列全球第 {rank} 🏆",
            'city_best' => "昨天你的证明是{city}最佳 🔥",
            'city_rank' => "昨天你的证明在{city}排名第 {rank}。",
            'votes' => "你昨天的证明获得的票数：{n}。",
            'winner' => "昨天的冠军：{name}（{city}）· ♥ {n}。",
            'winner_nocity' => "昨天的冠军：{name} · ♥ {n}。",
            'reminder' => "今天的 Daily Challenge 只剩 {h} 小时。",
            'digest_votes' => "你的证明获得的票数：{n}。",
            'digest_twist' => "完成你的 Local Twist 的人数：{n}。",
            'picked_tomorrow' => "你的 Local Twist 被选为明天{city}的 Daily Challenge 🎉",
            'picked_today' => "你的 Local Twist 被选为今天{city}的 Daily Challenge 🎉",
            'top10' => "你进入了今天的前 10 名！🏆 你的证明目前位列全球第 {rank}。",
        ],
        'zh-hant' => [
            'frame' => "今天的 Daily Challenge：{text}",
            'world' => "昨天你的證明位列全球第 {rank} 🏆",
            'city_best' => "昨天你的證明是{city}最佳 🔥",
            'city_rank' => "昨天你的證明在{city}排名第 {rank}。",
            'votes' => "你昨天的證明獲得的票數：{n}。",
            'winner' => "昨天的冠軍：{name}（{city}）· ♥ {n}。",
            'winner_nocity' => "昨天的冠軍：{name} · ♥ {n}。",
            'reminder' => "今天的 Daily Challenge 只剩 {h} 小時。",
            'digest_votes' => "你的證明獲得的票數：{n}。",
            'digest_twist' => "完成你的 Local Twist 的人數：{n}。",
            'picked_tomorrow' => "你的 Local Twist 被選為明天{city}的 Daily Challenge 🎉",
            'picked_today' => "你的 Local Twist 被選為今天{city}的 Daily Challenge 🎉",
            'top10' => "你進入了今天的前 10 名！🏆 你的證明目前位列全球第 {rank}。",
        ],
        'ja' => [
            'frame' => "今日の Daily Challenge：{text}",
            'world' => "昨日のあなたの証明は世界 #{rank} 🏆",
            'city_best' => "昨日のあなたの証明は {city} のベスト 🔥",
            'city_rank' => "昨日のあなたの証明は {city} で #{rank}。",
            'votes' => "昨日のあなたの証明への票数：{n}。",
            'winner' => "昨日の勝者：{name}（{city}）· ♥ {n}。",
            'winner_nocity' => "昨日の勝者：{name} · ♥ {n}。",
            'reminder' => "今日の Daily Challenge は残り {h} 時間。",
            'digest_votes' => "あなたの証明への票数：{n}。",
            'digest_twist' => "あなたの Local Twist を達成した人：{n}。",
            'picked_tomorrow' => "あなたの Local Twist が明日の {city} の Daily Challenge に選ばれました 🎉",
            'picked_today' => "あなたの Local Twist が今日の {city} の Daily Challenge に選ばれました 🎉",
            'top10' => "今日のトップ10入り！🏆 あなたの証明は今、世界 #{rank}。",
        ],
        'ko' => [
            'frame' => "오늘의 Daily Challenge: {text}",
            'world' => "어제 내 인증이 세계 #{rank}였어요 🏆",
            'city_best' => "어제 내 인증이 {city} 최고였어요 🔥",
            'city_rank' => "어제 내 인증이 {city}에서 #{rank}였어요.",
            'votes' => "어제 내 인증이 받은 표: {n}.",
            'winner' => "어제의 우승자: {name} ({city}) · ♥ {n}.",
            'winner_nocity' => "어제의 우승자: {name} · ♥ {n}.",
            'reminder' => "오늘의 Daily Challenge가 {h}시간 남았어요.",
            'digest_votes' => "내 인증이 받은 표: {n}.",
            'digest_twist' => "내 Local Twist를 완료한 사람: {n}.",
            'picked_tomorrow' => "내 Local Twist가 내일 {city} Daily Challenge에 선택됐어요 🎉",
            'picked_today' => "내 Local Twist가 오늘 {city} Daily Challenge에 선택됐어요 🎉",
            'top10' => "오늘의 톱 10에 들었어요! 🏆 내 인증이 지금 세계 #{rank} 순위예요.",
        ],
        'fil' => [
            'frame' => "Daily Challenge ngayon: {text}",
            'world' => "Kahapon, #{rank} sa mundo ang proof mo 🏆",
            'city_best' => "Kahapon, ang proof mo ang pinakamahusay sa {city} 🔥",
            'city_rank' => "Kahapon, #{rank} sa {city} ang proof mo.",
            'votes' => "Mga boto sa proof mo kahapon: {n}.",
            'winner' => "Nanalo kahapon: {name} sa {city} · ♥ {n}.",
            'winner_nocity' => "Nanalo kahapon: {name} · ♥ {n}.",
            'reminder' => "{h} oras na lang para sa Daily Challenge ngayon.",
            'digest_votes' => "Mga boto sa proof mo: {n}.",
            'digest_twist' => "Gumawa ng Local Twist mo: {n}.",
            'picked_tomorrow' => "Napili ang Local Twist mo para sa Daily Challenge bukas sa {city} 🎉",
            'picked_today' => "Napili ang Local Twist mo para sa Daily Challenge ngayon sa {city} 🎉",
            'top10' => "Nasa top 10 ka ngayong araw! 🏆 #{rank} sa mundo ang proof mo ngayon.",
        ],
        'th' => [
            'frame' => "Daily Challenge วันนี้: {text}",
            'world' => "เมื่อวานหลักฐานของคุณอยู่อันดับ #{rank} ของโลก 🏆",
            'city_best' => "เมื่อวานหลักฐานของคุณดีที่สุดใน {city} 🔥",
            'city_rank' => "เมื่อวานหลักฐานของคุณอยู่อันดับ #{rank} ใน {city}",
            'votes' => "โหวตให้หลักฐานเมื่อวานของคุณ: {n}",
            'winner' => "ผู้ชนะเมื่อวาน: {name} ที่ {city} · ♥ {n}",
            'winner_nocity' => "ผู้ชนะเมื่อวาน: {name} · ♥ {n}",
            'reminder' => "เหลือเวลาอีก {h} ชม. สำหรับ Daily Challenge วันนี้",
            'digest_votes' => "โหวตให้หลักฐานของคุณ: {n}",
            'digest_twist' => "คนที่ทำ Local Twist ของคุณ: {n}",
            'picked_tomorrow' => "Local Twist ของคุณถูกเลือกสำหรับ Daily Challenge พรุ่งนี้ใน {city} 🎉",
            'picked_today' => "Local Twist ของคุณถูกเลือกสำหรับ Daily Challenge วันนี้ใน {city} 🎉",
            'top10' => "คุณติดท็อป 10 ของวันนี้! 🏆 หลักฐานของคุณอยู่อันดับ #{rank} ของโลกตอนนี้",
        ],
        'id' => [
            'frame' => "Daily Challenge hari ini: {text}",
            'world' => "Kemarin buktimu peringkat #{rank} di dunia 🏆",
            'city_best' => "Kemarin buktimu yang terbaik di {city} 🔥",
            'city_rank' => "Kemarin buktimu peringkat #{rank} di {city}.",
            'votes' => "Suara untuk buktimu kemarin: {n}.",
            'winner' => "Pemenang kemarin: {name} di {city} · ♥ {n}.",
            'winner_nocity' => "Pemenang kemarin: {name} · ♥ {n}.",
            'reminder' => "Tinggal {h} jam untuk Daily Challenge hari ini.",
            'digest_votes' => "Suara untuk buktimu: {n}.",
            'digest_twist' => "Yang menyelesaikan Local Twist-mu: {n}.",
            'picked_tomorrow' => "Local Twist-mu terpilih untuk Daily Challenge besok di {city} 🎉",
            'picked_today' => "Local Twist-mu terpilih untuk Daily Challenge hari ini di {city} 🎉",
            'top10' => "Kamu masuk top 10 hari ini! 🏆 Buktimu sekarang peringkat #{rank} di dunia.",
        ],
        'hi' => [
            'frame' => "आज का Daily Challenge: {text}",
            'world' => "कल आपका प्रूफ दुनिया में #{rank} रहा 🏆",
            'city_best' => "कल आपका प्रूफ {city} में सबसे अच्छा रहा 🔥",
            'city_rank' => "कल आपका प्रूफ {city} में #{rank} रहा।",
            'votes' => "कल के आपके प्रूफ को मिले वोट: {n}।",
            'winner' => "कल के विजेता: {name}, {city} · ♥ {n}।",
            'winner_nocity' => "कल के विजेता: {name} · ♥ {n}।",
            'reminder' => "आज के Daily Challenge के लिए सिर्फ़ {h} घंटे बचे हैं।",
            'digest_votes' => "आपके प्रूफ को मिले वोट: {n}।",
            'digest_twist' => "आपका Local Twist पूरा करने वाले: {n}।",
            'picked_tomorrow' => "आपका Local Twist {city} में कल के Daily Challenge के लिए चुना गया 🎉",
            'picked_today' => "आपका Local Twist {city} में आज के Daily Challenge के लिए चुना गया 🎉",
            'top10' => "आप आज के टॉप 10 में हैं! 🏆 आपका प्रूफ अभी दुनिया में #{rank} है।",
        ],
        'ru' => [
            'frame' => "Daily Challenge дня: {text}",
            'world' => "Вчера твоё доказательство заняло #{rank} в мире 🏆",
            'city_best' => "Вчера твоё доказательство было лучшим в {city} 🔥",
            'city_rank' => "Вчера твоё доказательство заняло #{rank} в {city}.",
            'votes' => "Голосов за твоё вчерашнее доказательство: {n}.",
            'winner' => "Победитель вчера: {name}, {city} · ♥ {n}.",
            'winner_nocity' => "Победитель вчера: {name} · ♥ {n}.",
            'reminder' => "До конца Daily Challenge осталось {h} ч.",
            'digest_votes' => "Голосов за твоё доказательство: {n}.",
            'digest_twist' => "Выполнили твой Local Twist: {n}.",
            'picked_tomorrow' => "Твой Local Twist выбран для завтрашнего Daily Challenge в {city} 🎉",
            'picked_today' => "Твой Local Twist выбран для сегодняшнего Daily Challenge в {city} 🎉",
            'top10' => "Ты в топ-10 сегодня! 🏆 Твоё доказательство сейчас #{rank} в мире.",
        ],
        'ar' => [
            'frame' => "Daily Challenge اليوم: {text}",
            'world' => "أمس كان دليلك #{rank} في العالم 🏆",
            'city_best' => "أمس كان دليلك الأفضل في {city} 🔥",
            'city_rank' => "أمس كان دليلك #{rank} في {city}.",
            'votes' => "الأصوات لدليلك أمس: {n}.",
            'winner' => "فائز الأمس: {name} في {city} · ♥ {n}.",
            'winner_nocity' => "فائز الأمس: {name} · ♥ {n}.",
            'reminder' => "تبقّى {h} ساعة على Daily Challenge اليوم.",
            'digest_votes' => "الأصوات لدليلك: {n}.",
            'digest_twist' => "أنجزوا Local Twist الخاص بك: {n}.",
            'picked_tomorrow' => "اختير Local Twist الخاص بك لـ Daily Challenge الغد في {city} 🎉",
            'picked_today' => "اختير Local Twist الخاص بك لـ Daily Challenge اليوم في {city} 🎉",
            'top10' => "أنت ضمن أفضل 10 اليوم! 🏆 دليلك الآن #{rank} في العالم.",
        ],
    ];

    /** True when this locale has a catalog (every non-English app locale). */
    public static function has(string $locale): bool
    {
        return isset(self::T[$locale]);
    }

    /** A phrase with its placeholders filled, or null for English / unknown locales. */
    public static function render(string $key, string $locale, array $vars = []): ?string
    {
        $tpl = self::T[$locale][$key] ?? null;
        if ($tpl === null) {
            return null;
        }
        $repl = [];
        foreach ($vars as $k => $v) {
            $repl['{' . $k . '}'] = (string) $v;
        }
        return strtr($tpl, $repl);
    }

    /** The whole catalog (tests: every locale has every key, placeholders match). */
    public static function catalog(): array
    {
        return self::T;
    }
}
