# Allurus time-billing spec — version 1

How a timed resource (snooker table, karaoke room, gaming PC) is charged. `app/Billing/TimeBilling.php` and the terminal's port must both pass `vectors.json`. Same change rule as pricing: vectors first, bump `spec_version`, then every implementation.

Integer-only. The rate is the snapshot frozen when the session started, so a central rate change never alters a running session.

## Input

```jsonc
{
  "rate": { "rate_sen": 1500, "unit_minutes": 60, "min_minutes": 30, "round_to": 15, "round": "up" },
  "elapsed_seconds": 2820,   // floor(ended_at) - floor(started_at), in whole Unix seconds
  "paused_seconds": 0
}
```

## Algorithm

1. `billable = elapsed_seconds - paused_seconds`.
2. `minutes = ceil(billable / 60)` — any started minute counts.
3. `minutes = max(minutes, min_minutes)` — the minimum charge.
4. Round to `round_to` minutes: `up` → `ceil(minutes / round_to) × round_to`; `down` → `floor(minutes / round_to) × round_to`.
5. `amount_sen = div_half_up(minutes × rate_sen, unit_minutes)` (`div_half_up` as in the pricing spec).

Output: `{ "billable_seconds", "billed_minutes", "amount_sen" }`.

## Errors

`invalid_duration` (elapsed < 0, paused < 0, or paused > elapsed) and `invalid_rate` (`unit_minutes` or `round_to` < 1, negative `rate_sen` or `min_minutes`, `round` not `up`/`down`, or any non-integer).
