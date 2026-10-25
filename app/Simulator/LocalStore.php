<?php

namespace App\Simulator;

use PDO;

/**
 * The terminal's on-device SQLite database: catalogue mirror, local sales, outbox, cursor.
 * Mirrors what the Flutter app will hold, so its behaviour under chaos is what we test.
 */
final class LocalStore
{
    public readonly PDO $db;

    public function __construct(public readonly string $path)
    {
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0777, true);
        }
        $this->db = new PDO('sqlite:'.$path, options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('PRAGMA journal_mode = WAL');
        $this->db->exec('PRAGMA synchronous = FULL');   // a killed process must not lose a committed sale
        $this->db->exec('PRAGMA busy_timeout = 5000');
        $this->migrate();
    }

    public static function fresh(string $path): self
    {
        foreach ([$path, "{$path}-wal", "{$path}-shm"] as $f) {
            if (file_exists($f)) {
                unlink($f);
            }
        }

        return new self($path);
    }

    private function migrate(): void
    {
        $this->db->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY, name TEXT, type TEXT, tax_code TEXT, track_stock INTEGER, time_billing TEXT,
                row_version INTEGER, deleted INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS variants (
                id TEXT PRIMARY KEY, product_id TEXT, sku TEXT, base_price_sen INTEGER,
                row_version INTEGER, deleted INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS price_overrides (
                id TEXT PRIMARY KEY, variant_id TEXT, scope TEXT, scope_key TEXT, price_sen INTEGER, row_version INTEGER
            );
            CREATE TABLE IF NOT EXISTS modifiers (id TEXT PRIMARY KEY, data TEXT);

            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY, receipt_no TEXT UNIQUE, total_sen INTEGER, status TEXT NOT NULL, occurred_at TEXT
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id TEXT PRIMARY KEY, order_id TEXT, variant_id TEXT,
                qty_milli INTEGER NOT NULL, unit_price_sen INTEGER, net_sen INTEGER   -- integers only, never REAL
            );
            CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, order_id TEXT, method TEXT, amount_sen INTEGER NOT NULL);
            -- order_id may be another terminal's order (voided here, rung up there)
            CREATE TABLE IF NOT EXISTS voids (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, staff_role TEXT);
            CREATE TABLE IF NOT EXISTS adjustments (
                id TEXT PRIMARY KEY, variant_id TEXT, delta_milli INTEGER NOT NULL, reason TEXT, staff_role TEXT
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, order_id TEXT, amount_sen INTEGER NOT NULL, billed_minutes INTEGER, tampered INTEGER DEFAULT 0
            );

            -- AUTOINCREMENT (not plain rowid) so a client_seq is never reused after pruning:
            -- reuse would collide with the server's (terminal_id, client_seq) idempotency key.
            CREATE TABLE IF NOT EXISTS outbox (
                client_seq INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | acked | rejected
                attempts INTEGER NOT NULL DEFAULT 0,
                not_before INTEGER,                         -- epoch ms; set when the server says retry
                result TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS outbox_status ON outbox (status, client_seq);

            CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
        SQL);
    }

    /**
     * Remote wipe: erase every row (sales, outbox, catalogue, cursor). The real app also
     * deletes the SQLCipher key from the keystore, which makes the file unreadable.
     */
    public function wipe(): void
    {
        $tables = $this->db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")->fetchAll(PDO::FETCH_COLUMN);
        $this->transaction(function (PDO $db) use ($tables) {
            foreach ($tables as $t) {
                $db->exec("DELETE FROM \"{$t}\"");
            }
        });
        $this->db->exec('VACUUM');
    }

    public function isEmpty(): bool
    {
        return (int) $this->scalar('SELECT (SELECT COUNT(*) FROM orders) + (SELECT COUNT(*) FROM outbox) + (SELECT COUNT(*) FROM variants)') === 0;
    }

    public function get(string $key, ?string $default = null): ?string
    {
        $st = $this->db->prepare('SELECT value FROM sync_state WHERE key = ?');
        $st->execute([$key]);
        $v = $st->fetchColumn();

        return $v === false ? $default : $v;
    }

    public function put(string $key, string $value): void
    {
        $this->db->prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            ->execute([$key, $value]);
    }

    public function transaction(callable $fn): mixed
    {
        $this->db->beginTransaction();
        try {
            $r = $fn($this->db);
            $this->db->commit();
            return $r;
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }

    public function all(string $sql, array $args = []): array
    {
        $st = $this->db->prepare($sql);
        $st->execute($args);

        return $st->fetchAll(PDO::FETCH_ASSOC);
    }

    public function scalar(string $sql, array $args = []): mixed
    {
        $st = $this->db->prepare($sql);
        $st->execute($args);

        return $st->fetchColumn();
    }
}
