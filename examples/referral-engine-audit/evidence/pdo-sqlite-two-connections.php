<?php
// Supports the "clear on SQLite" part of the balance-races coverage:
//   php money-audit/evidence/pdo-sqlite-two-connections.php <empty directory for the test databases>
// Two PdoStore connections to one SQLite file each try to pay 500 from a balance of 500. The
// second payout runs between the first one's balance check and its insert. On SQLite one of
// them must fail with "database is locked" in both journal modes.

declare(strict_types=1);

require __DIR__ . '/../../php/autoload.php';

use Moonetix\ReferralEngine\PdoStore;
use Moonetix\ReferralEngine\ReferralEngine;
use Moonetix\ReferralEngine\Store;

final class Interleave implements Store
{
    /** @var callable|null */
    public $before = null;

    public function __construct(private Store $inner)
    {
    }

    public function getReferral(string $refereeId): ?array
    {
        return $this->inner->getReferral($refereeId);
    }

    public function insertReferral(array $referral): bool
    {
        return $this->inner->insertReferral($referral);
    }

    public function listEntries(array $filter = []): array
    {
        return $this->inner->listEntries($filter);
    }

    public function appendEntries(array $entries): bool
    {
        if ($this->before !== null) {
            $before = $this->before;
            $this->before = null;
            $before();
        }
        return $this->inner->appendEntries($entries);
    }

    public function withLock(string $key, callable $fn): mixed
    {
        return $this->inner->withLock($key, $fn);
    }
}

$dir = rtrim($argv[1] ?? '', '/');
if ($dir === '' || !is_dir($dir)) {
    fwrite(STDERR, "usage: php pdo-sqlite-two-connections.php <directory>\n");
    exit(2);
}
$attempt = static function (ReferralEngine $engine, string $id): string {
    try {
        return $engine->recordPayout(['payoutId' => $id, 'referrerId' => 'a', 'amount' => 500, 'at' => 10])['status'];
    } catch (Throwable $e) {
        return get_class($e) . ': ' . $e->getMessage();
    }
};
foreach (['delete', 'wal'] as $mode) {
    $file = "{$dir}/two-connections-{$mode}.sqlite";
    $open = static function () use ($file, $mode): PDO {
        $pdo = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_TIMEOUT => 1]);
        $pdo->exec("PRAGMA journal_mode = {$mode}");
        return $pdo;
    };
    $first = $open();
    $first->exec((string)file_get_contents(__DIR__ . '/../../schema/sqlite.sql'));
    $storeA = new Interleave(new PdoStore($first));
    $plan = ['type' => 'percentage', 'rateBps' => 1000];
    $a = new ReferralEngine(['store' => $storeA, 'plan' => $plan]);
    $b = new ReferralEngine(['store' => new PdoStore($open()), 'plan' => $plan]);
    $a->attach(['refereeId' => 'b', 'referrerId' => 'a', 'at' => 0]);
    $a->recordEarning(['earningId' => 'e1', 'refereeId' => 'b', 'amount' => 5000, 'at' => 1]);
    $resultB = '';
    $storeA->before = static function () use ($b, $attempt, &$resultB): void {
        $resultB = $attempt($b, 'pB');
    };
    $resultA = $attempt($a, 'pA');
    echo "journal_mode {$mode}: connection A: {$resultA} | connection B: {$resultB} | balance ", json_encode($b->balance('a', 100)), "\n";
}
