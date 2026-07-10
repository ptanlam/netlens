import { redirect } from "next/navigation";

// Holdings now live inside the unified Investment page.
export default function HoldingsPage() {
  redirect("/investments");
}
