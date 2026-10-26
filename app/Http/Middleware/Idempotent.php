<?php

namespace App\Http\Middleware;

use App\Database\Timestamps;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * `Idempotency-Key` for non-sync POSTs (alias `idempotent`, after ResolveTenant). A terminal
 * that retries after a lost response gets the first answer back (Idempotent-Replayed: true)
 * instead of doing the work twice.
 *
 *   no header                          428 idempotency_key_required
 *   same key, different request        422 idempotency_key_reused
 *   same key while the first runs      409 idempotency_key_in_progress
 *
 * Keys are per device. A 5xx isn't stored, so the client can retry with the same key.
 */
class Idempotent
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');
        if (! is_string($key) || $key === '' || strlen($key) > 128) {
            return response()->json(['error' => 'idempotency_key_required'], 428);
        }

        $tenantId = TenantContext::require();
        $scope = $request->user()->id;
        $hash = hash('sha256', $request->method().' '.$request->path().' '.$request->getContent());

        $inserted = DB::table('idempotency_keys')->insertOrIgnore([
            'id' => (string) Str::uuid7(), 'tenant_id' => $tenantId, 'scope' => $scope, 'key' => $key,
            'request_hash' => $hash, 'created_at' => now()->format(Timestamps::FORMAT),
        ]);
        $row = fn () => DB::table('idempotency_keys')->where('tenant_id', $tenantId)->where('scope', $scope)->where('key', $key);

        if ($inserted === 0) {
            $prior = $row()->first();
            if ($prior->request_hash !== $hash) {
                return response()->json(['error' => 'idempotency_key_reused'], 422);
            }
            if ($prior->status_code === null) {
                return response()->json(['error' => 'idempotency_key_in_progress'], 409);
            }

            return response()->json(json_decode($prior->response, true), $prior->status_code, ['Idempotent-Replayed' => 'true']);
        }

        try {
            $response = $next($request);
        } catch (\Throwable $e) {
            $row()->delete();
            throw $e;
        }

        if ($response->getStatusCode() >= 500) {
            $row()->delete();
        } else {
            $row()->update(['status_code' => $response->getStatusCode(), 'response' => $response->getContent() ?: 'null']);
        }

        return $response;
    }
}
