import { redirect } from "next/navigation";

// Transactions now live inside the unified Investment page (per holding).
export default function TransactionsPage() {
  redirect("/investments");
}
