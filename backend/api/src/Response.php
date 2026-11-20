<?php

declare(strict_types=1);

class Response
{
    /**
     * @param array       $data        Data to encode (used when $preEncoded is null).
     * @param int         $status      HTTP status code.
     * @param string|null $preEncoded  Optional pre-encoded JSON string. When supplied,
     *                                 $data is ignored and json_encode is skipped - useful
     *                                 when the caller needs to measure serialisation time
     *                                 separately and avoid encoding the payload twice.
     */
    public static function json(array $data, int $status = 200, ?string $preEncoded = null): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo $preEncoded ?? json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        exit;
    }

    /**
     * Send the whole response now and keep running, for slow side effects (push fan-out).
     * Render runs mod_php (no fastcgi_finish_request): a Content-Length and "Connection: close"
     * let the client finish reading while the script goes on. The caller must exit when done.
     */
    public static function jsonAndContinue(array $data, int $status = 200): void
    {
        $body = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        ignore_user_abort(true);
        set_time_limit(60);
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Length: ' . strlen((string) $body));
        header('Connection: close');
        echo $body;
        flush();
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        }
    }
}
