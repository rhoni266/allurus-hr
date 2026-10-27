<?php

namespace App\Simulator;

use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use PDO;

/**
 * Reference KDS screen: mirrors the outlet's kitchen tickets from the feed and records each
 * tap (preparing / ready / bumped) as a ticket.status mutation in a local outbox, in the
 * same SQLite transaction as the screen update. The cook never waits for the network; the
 * outbox drains when it can, deduped server-side by (device, client_seq) and event id.
 *
 * What the Flutter KDS must do, run under chaos.
 */
final class Kds
{
    private const RANK = ['new' => 0, 'late' => 0, 'preparing' => 1, 'ready' => 2, 'bumped' => 3, 'cancelled' => 9];

    private PDO $db;
    public int $transportFailures = 0;

    public function __construct(private SyncClient $client, string $storePath)
    {
        foreach ([$storePath, "{$storePath}-wal", "{$storePath}-shm"] as $f) {
            @unlink($f);
        }
        $this->db = new PDO('sqlite:'.$storePath, options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('PRAGMA journal_mode = WAL');
        $this->db->exec('PRAGMA synchronous = FULL');
        $this->db->exec(<<<'SQL'
            CREATE TABLE tickets (id TEXT PRIMARY KEY, source TEXT, label TEXT, status TEXT NOT NULL);
            CREATE TABLE outbox (
                client_seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', result TEXT     -- pending | acked | rejected
            );
            CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT);
        SQL);
    }

    /** Pull to head. The screen keeps a tap the server hasn't heard yet; otherwise the server wins. */
    public function pull(): bool
    {
        do {
            try {
                $page = $this->client->pull((int) ($this->get('cursor') ?? 0));
            } catch (TransportFailure) {
                $this->transportFailures++;
                return false;
            }
            $up = $this->db->prepare(<<<'SQL'
                INSERT INTO tickets (id, source, label, status) VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status = excluded.status
                WHERE excluded.status = 'cancelled' OR ? > (CASE tickets.status WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'bumped' THEN 3 ELSE 0 END)
            SQL);
            foreach ($page['changes'] as $c) {
                if ($c['entity'] === 'kitchen_ticket' && ($d = $c['data'] ?? null)) {
                    $up->execute([$c['id'], $d['source'], $d['label'], $d['status'], self::RANK[$d['status']] ?? 0]);
                }
            }
            $this->put('cursor', (string) $page['next_cursor']);
        } while ($page['has_more']);

        return true;
    }

    /** @return list<array{id: string, source: string, status: string}> oldest first */
    public function tickets(): array
    {
        return $this->db->query('SELECT id, source, label, status FROM tickets ORDER BY rowid')->fetchAll(PDO::FETCH_ASSOC);
    }

    /** A cook's tap: the screen moves at once, the mutation waits in the outbox. */
    public function tap(string $ticketId, string $status): void
    {
        $this->db->beginTransaction();
        $this->db->prepare('UPDATE tickets SET status = ? WHERE id = ? AND status <> ?')->execute([$status, $ticketId, 'cancelled']);
        $at = CarbonImmutable::now()->toIso8601ZuluString('microsecond');
        $this->db->prepare('INSERT INTO outbox (id, payload, created_at) VALUES (?, ?, ?)')->execute([(string) Str::uuid7(),
            json_encode(['event_id' => (string) Str::uuid7(), 'ticket_id' => $ticketId, 'status' => $status, 'occurred_at' => $at]), $at]);
        $this->db->commit();
    }

    /** Push until the outbox is empty, or give up after $maxRounds failed rounds in a row. */
    public function drain(int $maxRounds = 200): bool
    {
        $failures = 0;
        while ($rows = $this->db->query("SELECT * FROM outbox WHERE status = 'pending' ORDER BY client_seq LIMIT 50")->fetchAll(PDO::FETCH_ASSOC)) {
            try {
                $results = $this->client->push(array_map(fn ($r) => [
                    'id' => $r['id'], 'client_seq' => (int) $r['client_seq'], 'type' => 'ticket.status',
                    'payload' => json_decode($r['payload'], true), 'client_created_at' => $r['created_at'],
                ], $rows), $this->pending());
            } catch (TransportFailure) {
                $this->transportFailures++;
                if (++$failures >= $maxRounds) {
                    return false;
                }
                usleep(20_000);
                continue;
            }
            $failures = 0;
            $st = $this->db->prepare('UPDATE outbox SET status = ?, result = ? WHERE client_seq = ?');
            foreach ($results as $r) {
                if ($r['status'] !== 'retry') {
                    $st->execute([$r['status'] === 'rejected' ? 'rejected' : 'acked', json_encode($r['result']), $r['client_seq']]);
                }
            }
        }

        return true;
    }

    public function pending(): int
    {
        return (int) $this->db->query("SELECT COUNT(*) FROM outbox WHERE status = 'pending'")->fetchColumn();
    }

    /** @return array<string, int> local outbox rows by status */
    public function outbox(): array
    {
        return $this->db->query('SELECT status, COUNT(*) FROM outbox GROUP BY status')->fetchAll(PDO::FETCH_KEY_PAIR);
    }

    /** Event ids this screen created (to compare with what the server stored). */
    public function eventIds(): array
    {
        return array_map(fn ($p) => json_decode($p, true)['event_id'], $this->db->query('SELECT payload FROM outbox')->fetchAll(PDO::FETCH_COLUMN));
    }

    private function get(string $key): ?string
    {
        $st = $this->db->prepare('SELECT value FROM state WHERE key = ?');
        $st->execute([$key]);
        $v = $st->fetchColumn();

        return $v === false ? null : $v;
    }

    private function put(string $key, string $value): void
    {
        $this->db->prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')->execute([$key, $value]);
    }
}
