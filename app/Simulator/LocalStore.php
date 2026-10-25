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
                id TEXT PRIMARY KEY, name TEXT, track_stock INTEGER, row_version INTEGER, deleted INTEGER DEFAULT 0
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
                id TEXT PRIMARY KEY, receipt_no TEXT UNIQUE, total_sen INTEGER, occurred_at TEXT
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id TEXT PRIMARY KEY, order_id TEXT, variant_id TEXT, qty REAL, unit_price_sen INTEGER
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
                result TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS outbox_status ON outbox (status, client_seq);

            CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
        SQL);
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
