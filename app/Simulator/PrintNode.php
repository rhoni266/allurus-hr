<?php

namespace App\Simulator;

use Illuminate\Support\Facades\Http;
use PDO;

/**
 * Reference print node: a small device on the outlet's LAN that dials out to the cloud,
 * pulls print jobs from the feed and drives the kitchen printer. What the real agent (an
 * Android box or a Raspberry Pi) must do, run under chaos.
 *
 * The rule that makes it safe: a job is marked `printing` in local storage BEFORE it is sent
 * to the printer, and `printed` after. A crash between the two leaves the node unsure
 * whether paper came out, so on restart it does NOT print again: it reports the job as
 * `print_uncertain` to the server, where a person decides. Every other job prints exactly
 * once, however often the node crashes, loses acks or misses the doorbell.
 */
final class PrintNode
{
    public const CRASH_POINTS = ['after_mark', 'after_print', 'before_ack'];

    private PDO $db;
    public int $droppedAcks = 0;

    public function __construct(
        private string $baseUrl,
        private string $token,
        private string $printerId,
        string $storePath,
        private Paper $paper,
        private Chaos $chaos,
    ) {
        $this->db = new PDO('sqlite:'.$storePath, options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('PRAGMA journal_mode = WAL');
        $this->db->exec('PRAGMA synchronous = FULL');
        $this->db->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, kind TEXT, label TEXT,
                state TEXT NOT NULL            -- seen | printing | printed | uncertain | acked
            );
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
        SQL);
        // restart: anything caught mid-print can't be known to have printed or not
        $this->db->exec("UPDATE jobs SET state = 'uncertain' WHERE state = 'printing'");
    }

    public function heartbeat(string $status = 'ok'): void
    {
        $this->http()->post('/api/v1/kitchen/heartbeat', ['printers' => [['id' => $this->printerId, 'status' => $status]]])->throw();
    }

    /** Pull the feed to head; remember queued jobs for this printer. */
    public function pull(): int
    {
        $cursor = (int) ($this->get('cursor') ?? 0);
        $new = 0;
        do {
            $res = $this->http()->get('/api/v1/sync/pull', ['cursor' => $cursor, 'limit' => 200])->throw()->json();
            $ins = $this->db->prepare("INSERT OR IGNORE INTO jobs (id, kind, label, state) VALUES (?, ?, ?, 'seen')");
            foreach ($res['changes'] as $c) {
                $d = $c['data'] ?? null;
                if ($c['entity'] === 'print_job' && $d && $d['printer_id'] === $this->printerId && $d['status'] === 'queued') {
                    $ins->execute([$c['id'], $d['kind'], $d['payload']['label'] ?? '']);
                    $new += $ins->rowCount();
                }
            }
            $cursor = $res['next_cursor'];
            $this->put('cursor', (string) $cursor);
        } while ($res['has_more']);

        return $new;
    }

    /**
     * Print every job not printed yet. $crashAt (one of CRASH_POINTS) kills the node at
     * that point of the $crashOnJob-th job: the caller throws this object away and starts
     * a new one on the same files, as a reboot would.
     */
    public function printAll(?string $crashAt = null, int $crashOnJob = 1): void
    {
        $n = 0;
        foreach ($this->db->query("SELECT id FROM jobs WHERE state = 'seen' ORDER BY rowid")->fetchAll(PDO::FETCH_COLUMN) as $id) {
            $n++;
            $this->setState($id, 'printing');
            $this->crashIf($crashAt === 'after_mark' && $n === $crashOnJob);
            $this->paper->print($id);
            $this->crashIf($crashAt === 'after_print' && $n === $crashOnJob);
            $this->setState($id, 'printed');
        }
        $this->crashIf($crashAt === 'before_ack');
    }

    /** Ack printed and uncertain jobs. A lost response just means acking again next round. */
    public function ackAll(): void
    {
        foreach ($this->db->query("SELECT id, state FROM jobs WHERE state IN ('printed', 'uncertain')")->fetchAll(PDO::FETCH_ASSOC) as $j) {
            $body = $j['state'] === 'printed' ? ['result' => 'printed'] : ['result' => 'failed', 'error' => 'print_uncertain'];
            $res = $this->http()->post("/api/v1/kitchen/print-jobs/{$j['id']}/ack", $body);
            if ($this->chaos->chance($this->chaos->dropResponse)) {
                $this->droppedAcks++;   // the server recorded it; the node never hears
                continue;
            }
            $res->throw();
            $this->setState($j['id'], 'acked');
        }
    }

    public function pending(): int
    {
        return (int) $this->db->query("SELECT COUNT(*) FROM jobs WHERE state <> 'acked'")->fetchColumn();
    }

    private function setState(string $id, string $state): void
    {
        $this->db->prepare('UPDATE jobs SET state = ? WHERE id = ?')->execute([$state, $id]);
    }

    private function crashIf(bool $now): void
    {
        if ($now) {
            throw new NodeCrashed;
        }
    }

    private function http(): \Illuminate\Http\Client\PendingRequest
    {
        return Http::baseUrl($this->baseUrl)->withToken($this->token)->acceptJson()->timeout(30);
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
