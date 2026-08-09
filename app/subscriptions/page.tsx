import { connection } from "next/server";
import * as db from "@/lib/db";
import { SubscriptionsManager } from "@/components/subscriptions-manager";

export default async function SubscriptionsPage() {
  await connection();
  // Cancelled plans included — this is the one page with somewhere to put them. Everywhere
  // else takes the default and never sees a plan that stopped billing.
  const subscriptions = await db.listSubscriptions(true);

  // The heading lives in <SubscriptionsManager>: the design seats a page's primary action
  // beside its title, and "New subscription" is a client dialog, so the two share a
  // component. The day is read once here and handed down — `todayIso()` is the app's
  // timezone (Asia/Ho_Chi_Minh), which the browser's clock may not agree with, and every
  // renewal figure on the page is measured from it.
  return <SubscriptionsManager subscriptions={subscriptions} today={db.todayIso()} />;
}
