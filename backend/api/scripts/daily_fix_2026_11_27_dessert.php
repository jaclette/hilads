<?php
/**
 * One-off: the 2026-11-27 challenge ("dessert at night") becomes about dessert at any time of day.
 * Changes ONLY its title (headline_i18n) and its subtitle line (text_i18n, plus subtitle_i18n when it is
 * set), in English and the 18 other languages, through the back office's own functions (audited, the
 * day's cache cleared). Cover, theme, context, twists, question, date, status, points: untouched.
 *
 *   php scripts/daily_fix_2026_11_27_dessert.php            # DRY RUN (default): shows the record now and what would change
 *   php scripts/daily_fix_2026_11_27_dessert.php --apply    # writes it
 */

declare(strict_types=1);

$apply = in_array('--apply', array_slice($argv, 1), true);
$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) && getenv($m[1]) === false) putenv($m[1] . '=' . trim($m[2], "\"' "));
    }
}
require_once __DIR__ . '/../vendor/autoload.php';
foreach (glob(__DIR__ . '/../src/*.php') as $f) require_once $f;

const DATE = '2026-11-27';
const OLD_EN_TITLE = 'Find where locals go for dessert at night.';

$TITLE = [
    'en' => 'Find where locals go for dessert.',
    'fr' => 'Trouve où les locaux prennent le dessert.',
    'vi' => 'Tìm chỗ dân địa phương ăn tráng miệng.',
    'es' => 'Encuentra dónde toman el postre los locales.',
    'it' => 'Trova dove vanno i locali per il dolce.',
    'pt-br' => 'Ache onde a galera come doce.',
    'pt-pt' => 'Encontra onde os locais comem sobremesa.',
    'de' => 'Finde den Nachtisch-Spot der Einheimischen.',
    'nl' => 'Vind waar locals een toetje halen.',
    'zh-hans' => '找到当地人吃甜品的地方。',
    'zh-hant' => '找到當地人吃甜點的地方。',
    'ja' => '地元の人のデザート店を探そう。',
    'ko' => '현지인들의 디저트 맛집을 찾아보세요.',
    'fil' => 'Hanapin ang panghimagas-spot ng mga lokal.',
    'th' => 'หาร้านของหวานของคนท้องถิ่น',
    'id' => 'Temukan tempat pencuci mulut favorit warga.',
    'hi' => 'मीठा खाने का लोकल ठिकाना खोजें।',
    'ru' => 'Найди, где местные едят десерт.',
    'ar' => 'اعثر على مكان الحلوى المفضل لدى السكان.',
];
$SUBTITLE = [
    'en' => 'Find where locals go for something sweet, and order what they get.',
    'fr' => 'Trouve où les locaux vont manger un truc sucré, et commande comme eux.',
    'vi' => 'Tìm nơi người địa phương đi ăn đồ ngọt, và gọi món giống họ.',
    'es' => 'Encuentra dónde van los locales a comer algo dulce, y pide lo mismo que ellos.',
    'it' => 'Scopri dove vanno i locali per qualcosa di dolce, e ordina quello che prendono loro.',
    'pt-br' => 'Descubra onde os moradores vão comer um docinho, e peça o mesmo que eles.',
    'pt-pt' => 'Descobre onde os locais vão comer um doce, e pede o mesmo que eles.',
    'de' => 'Finde heraus, wo Einheimische etwas Süßes essen, und bestell das Gleiche.',
    'nl' => 'Zoek waar locals iets zoets gaan halen, en bestel wat zij nemen.',
    'zh-hans' => '找到当地人去吃甜食的地方，点他们点的。',
    'zh-hant' => '找到當地人去吃甜食的地方，點他們點的。',
    'ja' => '地元の人が甘いものを食べに行く場所を見つけて、みんなと同じものを頼もう。',
    'ko' => '현지인들이 단것을 먹으러 가는 곳을 찾아, 그들이 먹는 걸 주문해 보세요.',
    'fil' => 'Hanapin kung saan pumupunta ang mga lokal para sa matamis, at umorder ng kapareho nila.',
    'th' => 'หาว่าคนท้องถิ่นไปกินของหวานที่ไหน แล้วสั่งแบบเดียวกับเขา',
    'id' => 'Temukan ke mana warga lokal pergi untuk makan yang manis, lalu pesan yang sama dengan mereka.',
    'hi' => 'पता करें कि लोग कुछ मीठा खाने कहाँ जाते हैं, और वही ऑर्डर करें जो वे लेते हैं।',
    'ru' => 'Найди, куда местные ходят за сладким, и закажи то же, что и они.',
    'ar' => 'ابحث عن المكان الذي يذهب إليه السكان المحليون لتناول شيء حلو، واطلب ما يطلبونه.',
];

$pdo = Database::pdo();
$rows = $pdo->query("SELECT id, challenge_date::text AS date, status, theme, headline_i18n, text_i18n, subtitle_i18n, context_i18n
                     FROM daily_challenges WHERE challenge_date = '" . DATE . "' AND NOT coalesce(is_reserve, false)")->fetchAll(PDO::FETCH_ASSOC);
if (count($rows) !== 1) { fwrite(STDERR, 'Expected exactly one challenge dated ' . DATE . ', found ' . count($rows) . ".\n"); exit(1); }
$c = $rows[0];
$headline = json_decode((string) $c['headline_i18n'], true) ?: [];
$text     = json_decode((string) $c['text_i18n'], true) ?: [];
$subtitle = json_decode((string) ($c['subtitle_i18n'] ?? ''), true) ?: [];
$context  = json_decode((string) $c['context_i18n'], true) ?: [];

echo "Challenge {$c['id']} · {$c['date']} · {$c['status']} · theme {$c['theme']}\n";
echo "  title (headline) now:  " . ($headline['en'] ?? '(none)') . "\n";
echo "  text now:              " . ($text['en'] ?? '(none)') . "\n";
echo "  subtitle field now:    " . ($subtitle['en'] ?? '(empty: the apps show the text under the title)') . "\n";
if (($headline['en'] ?? '') !== OLD_EN_TITLE) {
    fwrite(STDERR, "\nThe English title isn't \"" . OLD_EN_TITLE . "\": stopping, nothing changed (already fixed, or another record).\n");
    exit(1);
}
echo "\nNew title (en):    {$TITLE['en']}\nNew subtitle (en): {$SUBTITLE['en']}\n";
foreach ($TITLE as $l => $v) {
    if (mb_strlen($v) > DailyAdminService::HEADLINE_MAX) { fwrite(STDERR, "Title ({$l}) over " . DailyAdminService::HEADLINE_MAX . " characters.\n"); exit(1); }
}
if (!$apply) { echo "\nDRY RUN: nothing changed. Run again with --apply to write it.\n"; exit(0); }

$others = static fn(array $m): array => array_diff_key($m, ['en' => true, '_src' => true]);
// Subtitle line: the text's English, then its 18 translations (the context's translations passed back unchanged).
DailyAdminService::updateChallenge($c['id'], ['text' => $SUBTITLE['en']]);
DailyAdminService::setChallengeTranslations($c['id'], $others($SUBTITLE), $others($context));
// That save also re-stamps the context (its _src marker): put the context back exactly as it was.
$pdo->prepare("UPDATE daily_challenges SET context_i18n = ?::jsonb WHERE id = ?")->execute([(string) $c['context_i18n'], $c['id']]);
// Title: the headline, English + 18 (saved last: it also clears the day's cache, after the context is back).
DailyAdminService::setChallengeHeadline($c['id'], $TITLE['en'], $others($TITLE));
// The separate subtitle field, only when it was set (then it is what the apps show).
if (($subtitle['en'] ?? '') !== '') {
    DailyAdminService::setChallengeSubtitle($c['id'], $SUBTITLE['en'], $others($SUBTITLE));
    echo "subtitle field updated too\n";
}
$after = $pdo->query("SELECT headline_i18n, text_i18n, context_i18n, cover_url FROM daily_challenges WHERE id = " . $pdo->quote($c['id']))->fetch(PDO::FETCH_ASSOC);
$ctxAfter = json_decode((string) $after['context_i18n'], true) ?: [];
echo "\nDone. Title: " . (json_decode((string) $after['headline_i18n'], true)['en'] ?? '') . "\n";
echo "Text: " . (json_decode((string) $after['text_i18n'], true)['en'] ?? '') . "\n";
echo "Context unchanged: " . ($ctxAfter == $context ? 'yes' : 'NO, check it') . "\n";
