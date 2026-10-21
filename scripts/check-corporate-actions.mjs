// Self-check for lib/corporate-actions.ts: node scripts/check-corporate-actions.mjs
import assert from 'node:assert/strict';
import { missedActions } from '../lib/corporate-actions.ts';

const inst = [{ name: 'FPT', asset_type: 'Stocks', quantity: 700 }];
const buys = [
  { instrument: 'FPT', date: '2026-02-26', amount: 50000000, quantity: 500 },
  { instrument: 'FPT', date: '2026-06-10', amount: 20000000, quantity: 200 },
];
// Yahoo's figures for FPT: the May dividend reads 909.09 because the later 11:10 split
// adjusted it down from ₫1,000.
const events = {
  FPT: {
    dividends: [{ date: '2026-05-28', amount: 909.0909 }, { date: '2025-12-01', amount: 909.0909 }],
    splits: [{ date: '2026-09-21', numerator: 11, denominator: 10 }, { date: '2026-12-01', numerator: 11, denominator: 10 }],
  },
};
const run = (txs, dismissed = []) => missedActions(inst, txs, events, new Set(dismissed), '2026-10-21');

const found = run(buys);
assert.deepEqual(found.map((a) => [a.key, a.held, a.value]), [
  // 700 held, 11:10 → 70 bonus units.
  ['FPT:bonus:2026-09-21', 700, 70],
  // 500 held before the June buy, ₫1,000 a share un-adjusted, less 5% tax.
  ['FPT:dividend:2026-05-28', 500, 475000],
]);
// Before the first transaction and after today: neither suggested.
assert.ok(!found.some((a) => a.date === '2025-12-01' || a.date === '2026-12-01'));

// Recorded (dated when the shares arrived, two weeks late) or dismissed: not suggested again.
const recorded = [...buys, { instrument: 'FPT', date: '2026-10-05', amount: 0, quantity: 70 }];
assert.deepEqual(run(recorded).map((a) => a.key), ['FPT:dividend:2026-05-28']);
assert.deepEqual(run(buys, ['FPT:dividend:2026-05-28']).map((a) => a.key), ['FPT:bonus:2026-09-21']);
// A sell isn't a dividend: a negative amount needs quantity 0, not just any quantity.
assert.equal(run([...buys, { instrument: 'FPT', date: '2026-06-01', amount: -1, quantity: -1 }]).length, 2);

// A later event counts the bonus units of an earlier missed one: 15% then 10%.
const two = {
  FPT: {
    dividends: [{ date: '2026-09-01', amount: 1000 }],
    splits: [{ date: '2026-07-01', numerator: 115, denominator: 100 }],
  },
};
const both = missedActions(inst, buys, two, new Set(), '2026-10-21');
// 700 × 15% = 105 bonus, then the dividend on 805 shares.
assert.deepEqual(both.map((a) => [a.kind, a.held, a.value]), [['dividend', 805, 764750], ['bonus', 700, 105]]);
// Once the bonus is recorded the holding is 805 and the dividend still reads 805, not 910.
const after = missedActions(
  [{ ...inst[0], quantity: 805 }], [...buys, { instrument: 'FPT', date: '2026-07-01', amount: 0, quantity: 105 }],
  two, new Set(), '2026-10-21');
assert.deepEqual(after.map((a) => [a.kind, a.held]), [['dividend', 805]]);
console.log('ok');
