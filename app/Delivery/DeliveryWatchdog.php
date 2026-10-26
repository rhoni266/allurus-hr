<?php

namespace App\Delivery;

use App\Kitchen\KitchenPresence;
use App\Models\DeliveryConnection;

/**
 * Pauses a store on its platform when nobody in the kitchen can see new orders, and opens
 * it again when someone can. Watches stores that auto-accept (an auto-accepting store with
 * a dark kitchen would otherwise take orders it can only leave to time out) and any with
 * settings.pause_when_kitchen_quiet.
 *
 * Quiet means KitchenPresence says no for pos.delivery.pause_after_seconds in a row,
 * measured from the first tick that saw it. A store paused by hand (pause_reason 'manual')
 * is never reopened here. If the platform call fails, nothing changes and the next tick
 * tries again.
 */
final class DeliveryWatchdog
{
    public function __construct(private ProviderRegistry $providers) {}

    /** @return 'paused'|'resumed'|null */
    public function check(DeliveryConnection $c): ?string
    {
        if (! in_array($c->status, ['active', 'paused'], true)) {
            return null;
        }
        $listening = KitchenPresence::isListening($c->tenant_id, $c->outlet_id);

        if ($listening) {
            if ($c->kitchen_quiet_since !== null) {
                $c->update(['kitchen_quiet_since' => null]);
            }
            if ($c->status === 'paused' && $c->pause_reason === 'kitchen_quiet') {
                $this->providers->get($c->provider)->setStoreOpen($c, true, 'kitchen_back');
                $c->update(['status' => 'active', 'paused_at' => null, 'pause_reason' => null]);

                return 'resumed';
            }

            return null;
        }

        if (! ($c->auto_accept || ($c->settings['pause_when_kitchen_quiet'] ?? false)) || $c->status !== 'active') {
            return null;
        }
        if ($c->kitchen_quiet_since === null) {
            $c->update(['kitchen_quiet_since' => now()]);

            return null;
        }
        if ($c->kitchen_quiet_since->diffInSeconds(now()) < config('pos.delivery.pause_after_seconds')) {
            return null;
        }

        $this->providers->get($c->provider)->setStoreOpen($c, false, 'kitchen_quiet');
        $c->update(['status' => 'paused', 'paused_at' => now(), 'pause_reason' => 'kitchen_quiet']);

        return 'paused';
    }
}
