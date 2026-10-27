<?php

namespace App\Till;

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Facade;

/**
 * The web till's way into the POS API: an in-process HTTP client. Each call goes through
 * the full API stack (auth:sanctum, ResolveTenant, EnsureDeviceActive, staff, throttles),
 * exactly as a tablet's request would, so the web till can't do anything a paired terminal
 * couldn't. No loopback socket, so it also works under `php artisan serve` (one worker).
 *
 * The outer web request is restored afterwards (container binding, auth guards).
 */
final class TillApi
{
    /** @return array{status: int, body: array} */
    public static function call(string $method, string $uri, array $body = [], ?string $token = null, ?string $staffSession = null): array
    {
        $app = app();
        $outer = $app->make('request');
        $server = array_filter([
            'HTTP_ACCEPT' => 'application/json',
            'CONTENT_TYPE' => 'application/json',
            'HTTP_AUTHORIZATION' => $token ? "Bearer {$token}" : null,
            'HTTP_X_STAFF_SESSION' => $staffSession,
            'REMOTE_ADDR' => $outer->ip(),   // throttles still count this browser
        ]);
        $inner = Request::create('/api/v1/'.ltrim($uri, '/'), $method, [], [], [], $server, $method === 'GET' ? null : json_encode($body));

        $app['auth']->forgetGuards();
        try {
            $response = $app->make(Kernel::class)->handle($inner);
        } finally {
            $app->instance('request', $outer);
            Facade::clearResolvedInstance('request');
            $app['auth']->forgetGuards();
        }

        return ['status' => $response->getStatusCode(), 'body' => json_decode((string) $response->getContent(), true) ?? []];
    }
}
