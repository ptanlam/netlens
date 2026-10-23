-- Rolling a matured deposit into a new term is the same money, not new saving. A new deposit
-- can now point at the one it was rolled over from, so the streak counts only what you added
-- on top of the old deposit's payout (`freshPrincipal` in `lib/savings.ts`).
ALTER TABLE savings ADD COLUMN rolled_from INTEGER;
