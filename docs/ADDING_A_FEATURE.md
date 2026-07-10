# Adding a feature (a new tracked entity)

`savings` and `debts` were built this way and are the best copy templates. Say you
want to add `goals`. Do these seven edits, in order.

### 1. Table — `lib/db.ts`, inside the `SCHEMA` string
```sql
CREATE TABLE IF NOT EXISTS goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  target     INTEGER NOT NULL,
  -- …fields…
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```
`CREATE TABLE IF NOT EXISTS` = the whole migration. Money columns are `INTEGER` (VND).

### 2. Type — `lib/types.ts`
```ts
export interface Goal {
  id: number;
  name: string | null;
  target: number;
  created_at: string;
}
```
Keep this file free of Node imports — it's shared with client components.

### 3. CRUD — `lib/db.ts`
Add `import type { Goal }` to the top import and the `export type` re-export, then:
```ts
export function listGoals(): Goal[] { return getDb().prepare("SELECT * FROM goals ORDER BY id DESC").all() as Goal[]; }
export function getGoal(id: number): Goal | undefined { return getDb().prepare("SELECT * FROM goals WHERE id=?").get(id) as Goal | undefined; }
export function addGoal(name: string | null, target: number) { getDb().prepare("INSERT INTO goals(name, target) VALUES (?,?)").run(name, Math.round(target)); }
export function updateGoal(id: number, name: string | null, target: number) { /* UPDATE … WHERE id=? */ }
export function deleteGoal(id: number) { getDb().prepare("DELETE FROM goals WHERE id=?").run(id); }
```

### 4. Actions — `app/actions.ts`
Add `/goals` to `revalidateAll()`'s path list, then add validated mutations that
return `{ ok, message }`. Use the existing `num()` / `str()` helpers and the
discriminated-union parse pattern (see `parseSaving` / `parseDebt` — return
`{ ok:true, value } | { ok:false, message }`, never a bare `{ error }` union, which
confuses TS inference).
```ts
export async function addGoal(fd: FormData) {
  const p = parseGoal(fd);
  if (!p.ok) return { ok: false, message: p.message };
  db.addGoal(p.value.name, p.value.target);
  revalidateAll();
  return { ok: true, message: "Goal saved." };
}
```

### 5. Client manager — `components/goals-manager.tsx`
Copy `components/debts-manager.tsx` and adapt. It contains: a `Form` (server-action
form with `useTransition`, `toast`, `formRef.reset()` on add), summary `<Card>`s, list
rows, an edit `<Dialog>`, and delete with `confirm()`. Start it with `"use client"`.

### 6. Page — `app/goals/page.tsx`
```tsx
import { connection } from "next/server";
import * as db from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoalsManager } from "@/components/goals-manager";

export default async function GoalsPage() {
  await connection();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader><CardTitle>Goals</CardTitle><CardDescription>…</CardDescription></CardHeader>
        <CardContent><GoalsManager goals={db.listGoals()} /></CardContent>
      </Card>
    </div>
  );
}
```

### 7. Nav — `components/nav.tsx`
Add `{ href: "/goals", label: "Goals" }` to `LINKS`. This one array feeds both the
desktop nav and the mobile drawer — no other nav edit needed.

### If it affects net worth
Also read it in `app/page.tsx` and pass it into `components/net-worth.tsx`.

---

## Gotchas that will bite you

- **Server action → client**: you can import a `"use server"` action directly into a
  client component (see `tx-row-actions.tsx`). Fine.
- **Base UI `<Select>` / `<Dialog>`**: use the wrappers in `components/ui/`. A
  `<Button render={<Link/>}>` or `render={<a/>}` needs `nativeButton={false}`.
- **Controlled vs uncontrolled inputs**: don't flip an `<Input>` between `value=` and
  `defaultValue=` across renders (Base UI warns). Keep one field and toggle
  `disabled`/`required` instead (see the debts "revolving" term field).
- **`react-hooks/immutability` lint**: no `let acc; arr.map(() => acc += …)` inside
  `useMemo`. Use `reduce` or index-based prefix sums.
- **Always** finish with `npx tsc --noEmit` **and** `npm run lint` clean, plus a
  headless screenshot (see `WORKFLOW.md`). Clean up any test rows you inserted.
