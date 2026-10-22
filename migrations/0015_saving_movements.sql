-- A deposit could only be the one amount you opened it with.
--
-- Top-ups and partial withdrawals happen (a flexible account, taking out part of a matured
-- deposit), and the only way to record one was to edit the principal, which rewrote the
-- deposit's whole history: the savings chart showed it holding the new amount from the
-- day it opened. So each change is a dated row, signed like all money here (+ top-up,
-- − withdrawal), and the value is replayed from them (`currentValue` in `lib/savings.ts`).
CREATE TABLE IF NOT EXISTS saving_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  saving_id  INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saving_movements_saving ON saving_movements(saving_id);
