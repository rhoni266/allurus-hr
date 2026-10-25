<?php

namespace App\Billing;

/**
 * Charges a timed session. Implements spec/time-billing/SPEC.md; checked against
 * spec/time-billing/vectors.json. Integer-only and framework-free, like PricingEngine.
 */
final class TimeBilling
{
    public const SPEC_VERSION = 1;

    /**
     * @param array{rate_sen:int, unit_minutes:int, min_minutes:int, round_to:int, round:string} $rate snapshot frozen at start
     * @return array{billable_seconds:int, billed_minutes:int, amount_sen:int}
     */
    public static function charge(array $rate, int $elapsedSeconds, int $pausedSeconds = 0): array
    {
        foreach (['rate_sen', 'unit_minutes', 'min_minutes', 'round_to'] as $k) {
            if (! is_int($rate[$k] ?? null)) {
                throw new PricingException('invalid_rate', "{$k} must be an integer");
            }
        }
        if ($rate['unit_minutes'] < 1 || $rate['round_to'] < 1 || $rate['rate_sen'] < 0 || $rate['min_minutes'] < 0
            || ! in_array($rate['round'] ?? null, ['up', 'down'], true)) {
            throw new PricingException('invalid_rate');
        }
        if ($elapsedSeconds < 0 || $pausedSeconds < 0 || $pausedSeconds > $elapsedSeconds) {
            throw new PricingException('invalid_duration');
        }

        $billable = $elapsedSeconds - $pausedSeconds;
        $minutes = max(intdiv($billable + 59, 60), $rate['min_minutes']);
        $step = $rate['round_to'];
        $minutes = $rate['round'] === 'up' ? intdiv($minutes + $step - 1, $step) * $step : intdiv($minutes, $step) * $step;

        return [
            'billable_seconds' => $billable,
            'billed_minutes' => $minutes,
            'amount_sen' => PricingEngine::divHalfUp($minutes * $rate['rate_sen'], $rate['unit_minutes']),
        ];
    }

    /** Spec step 0: elapsed = floor(ended) - floor(started), whole Unix seconds. */
    public static function elapsedSeconds(\DateTimeInterface $startedAt, \DateTimeInterface $endedAt): int
    {
        return $endedAt->getTimestamp() - $startedAt->getTimestamp();
    }
}
