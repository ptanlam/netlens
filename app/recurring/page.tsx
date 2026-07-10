import { redirect } from "next/navigation";

// Recurring rules now live inside the unified Investment page (per holding).
export default function RecurringPage() {
  redirect("/investments");
}
