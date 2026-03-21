<?php

declare(strict_types=1);

class NicknameGenerator
{
    private static array $adjectives = [
        'Blue', 'Red', 'Wild', 'Cool', 'Fast', 'Brave', 'Dark', 'Free',
        'Gold', 'Iron', 'Lazy', 'Mad', 'Neon', 'Odd', 'Pink', 'Quick',
        'Rusty', 'Shy', 'Tiny', 'Urban', 'Vast', 'Warm', 'Zany', 'Crazy',
    ];

    private static array $nouns = [
        'Tiger', 'Eagle', 'Panda', 'Shark', 'Wolf', 'Fox', 'Bear', 'Lion',
        'Hawk', 'Owl', 'Deer', 'Frog', 'Crab', 'Mule', 'Seal', 'Toad',
        'Lynx', 'Mink', 'Newt', 'Puma', 'Raven', 'Swan', 'Viper', 'Banana',
    ];

    public static function generate(): string
    {
        $adjective = self::$adjectives[array_rand(self::$adjectives)];
        $noun = self::$nouns[array_rand(self::$nouns)];
        $number = random_int(1, 99);

        return $adjective . $noun . $number;
    }
}
