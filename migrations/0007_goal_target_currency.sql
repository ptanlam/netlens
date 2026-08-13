-- A goal target that is really denominated in another currency.
--
-- "Race to $100k" was stored as ₫2,600,000,000 — $100k at whatever the rate happened to be
-- the day it was typed. The dong moves and the stored number doesn't, so the target quietly
-- drifts away from the thing it means: the same goal is $99k one month and $101k the next
-- without anybody touching it. Store what you actually said (100000 USD) and convert on
-- read at the latest rate.
--
-- `target` stays whole VND and stays authoritative for every VND goal — nothing about the
-- existing ones changes. For a foreign-denominated goal it becomes a *cache* of the last
-- conversion, refreshed by `syncFxTargets` whenever a new rate lands. That is deliberate:
-- a raw `SELECT` (a CSV export, a hand query, a future feature that hasn't heard of
-- currencies) still sees a current VND figure, and a goal still has a sane target on the
-- day the FX feed is down.
--
-- `target_amount` is whole units of `target_ccy` — whole dollars. A target is a round
-- number you say out loud; nobody saves toward $100,000.37, and cents would only invite a
-- minor-unit mixup with `target`'s whole dong.
ALTER TABLE goals ADD COLUMN target_ccy TEXT NOT NULL DEFAULT 'VND';
ALTER TABLE goals ADD COLUMN target_amount INTEGER;
