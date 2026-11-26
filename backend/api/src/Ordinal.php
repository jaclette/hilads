<?php

declare(strict_types=1);

/**
 * A rank as an ordinal in a language ("1st", "12e", "3.º", "2位", "第3名"), never "#3" (owner's rule
 * 2026-11-26: no "#" for ranks anywhere). Same table as the apps (apps/mobile/src/lib/ordinal.ts,
 * apps/web/src/lib/ordinal.js). Push texts write {rank_ordinal} (DailyPushText::render fills it).
 */
final class Ordinal
{
    private const HI = [1 => 'ला', 2 => 'रा', 3 => 'रा', 4 => 'था', 6 => 'ठा'];

    public static function format(int $n, string $locale = 'en'): string
    {
        switch (strtolower($locale)) {
            case 'fr': return $n === 1 ? '1er' : "{$n}e";
            case 'es': case 'pt-pt': return "{$n}.º";
            case 'pt-br': case 'it': return "{$n}º";
            case 'de': return "{$n}.";
            case 'nl': return "{$n}e";
            case 'ru': return "{$n}-й";
            case 'ja': return "{$n}位";
            case 'ko': return "{$n}위";
            case 'zh-hans': case 'zh-hant': return "第{$n}名";
            case 'th': return "อันดับ {$n}";
            case 'vi': return "hạng {$n}";
            case 'id': return "ke-{$n}";
            case 'fil': return "ika-{$n}";
            case 'hi': return $n . (self::HI[$n] ?? 'वां');
            case 'ar': return "الـ{$n}";
            default:
                $m100 = $n % 100;
                $s = ($m100 >= 11 && $m100 <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][$n % 10] ?? 'th');
                return $n . $s;
        }
    }
}
