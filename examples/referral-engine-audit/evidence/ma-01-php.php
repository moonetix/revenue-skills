<?php
// Proof for MA-01 on the PHP port: php money-audit/evidence/ma-01-php.php
// Expected on correct code: both late-dated payouts are refused with insufficient_balance
// and both balances end at 0. Exit code 1 means the flaw is present.

declare(strict_types=1);

require __DIR__ . '/../../php/autoload.php';

use Moonetix\ReferralEngine\MemoryStore;
use Moonetix\ReferralEngine\ReferralEngine;
use Moonetix\ReferralEngine\ReferralException;

function referrerWith500(): ReferralEngine
{
    $engine = new ReferralEngine(['store' => new MemoryStore(), 'plan' => ['type' => 'percentage', 'rateBps' => 1000]]);
    $engine->attach(['refereeId' => 'b', 'referrerId' => 'a', 'at' => 0]);
    $engine->recordEarning(['earningId' => 'e1', 'refereeId' => 'b', 'amount' => 5000, 'at' => 1]);
    return $engine;
}

function attempt(ReferralEngine $engine, array $payout): string
{
    try {
        return $engine->recordPayout($payout)['status'];
    } catch (ReferralException $e) {
        return $e->errorCode;
    }
}

$bad = 0;

$engine = referrerWith500();
$engine->recordPayout(['payoutId' => 'p1', 'referrerId' => 'a', 'amount' => 500, 'at' => 200]);
$second = attempt($engine, ['payoutId' => 'p2', 'referrerId' => 'a', 'amount' => 500, 'at' => 150]);
$available = $engine->balance('a', 300)['available'];
echo "payout dated before a recorded payout: {$second}, available afterwards {$available}\n";
$bad += $second === 'insufficient_balance' && $available === 0 ? 0 : 1;

$engine = referrerWith500();
$engine->reverseEarning(['earningId' => 'e1', 'at' => 200]);
$late = attempt($engine, ['payoutId' => 'p1', 'referrerId' => 'a', 'amount' => 500, 'at' => 150]);
$available = $engine->balance('a', 300)['available'];
echo "payout dated before a recorded clawback: {$late}, available afterwards {$available}\n";
$bad += $late === 'insufficient_balance' && $available === 0 ? 0 : 1;

echo $bad === 0 ? "OK: late-dated payouts are refused\n" : "FLAW PRESENT: {$bad} of 2 late-dated payouts were recorded\n";
exit($bad === 0 ? 0 : 1);
