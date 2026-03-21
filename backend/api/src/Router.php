<?php

declare(strict_types=1);

class Router
{
    private array $routes = [];

    public function add(string $method, string $path, callable $handler): void
    {
        $this->routes[] = [$method, $path, $handler];
    }

    public function dispatch(string $method, string $uri): void
    {
        $allowedMethods = [];

        foreach ($this->routes as [$routeMethod, $routePath, $handler]) {
            $params = $this->match($routePath, $uri);
            if ($params === null) {
                continue;
            }

            if ($method !== $routeMethod) {
                $allowedMethods[] = $routeMethod;
                continue;
            }

            $handler($params);
            return;
        }

        if (!empty($allowedMethods)) {
            header('Allow: ' . implode(', ', $allowedMethods));
            Response::json(['error' => 'Method Not Allowed'], 405);
            return;
        }

        Response::json(['error' => 'Not Found', 'path' => $uri], 404);
    }

    private function match(string $routePath, string $uri): ?array
    {
        $pattern = preg_replace('/\{(\w+)\}/', '(?P<$1>[^/]+)', $routePath);
        $pattern = '#^' . $pattern . '$#';

        if (!preg_match($pattern, $uri, $matches)) {
            return null;
        }

        return array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
    }
}
