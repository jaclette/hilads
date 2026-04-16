<?php

declare(strict_types=1);

// Load only the source classes needed for unit tests.
// We do NOT boot the full routes/app — just the classes under test.
require_once __DIR__ . '/../vendor/autoload.php';

// Minimal stubs for classes that do I/O so unit tests never touch the network or DB.
// The real implementations are in src/ and are loaded via classmap in tests that need them.

// Stub Response so tests can assert it was called without triggering exit().
if (!class_exists('Response')) {
    class Response
    {
        public static ?array $lastPayload = null;
        public static ?int   $lastStatus  = null;

        public static function json(array $data, int $status = 200): void
        {
            self::$lastPayload = $data;
            self::$lastStatus  = $status;
            throw new \RuntimeException('Response::json called with status ' . $status);
        }

        public static function reset(): void
        {
            self::$lastPayload = null;
            self::$lastStatus  = null;
        }
    }
}

// Stub Database so tests can inject a mock PDO without environment variables.
if (!class_exists('Database')) {
    class Database
    {
        private static ?\PDO $pdo = null;

        public static function pdo(): \PDO
        {
            if (self::$pdo === null) {
                throw new \RuntimeException('Database::pdo() called without a PDO instance — inject one via Database::setInstance() first');
            }
            return self::$pdo;
        }

        public static function setInstance(\PDO $pdo): void
        {
            self::$pdo = $pdo;
        }

        public static function reset(): void
        {
            self::$pdo = null;
        }
    }
}

// Load the class under test.
require_once __DIR__ . '/../src/EventRepository.php';
