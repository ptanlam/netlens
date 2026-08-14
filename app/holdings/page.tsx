import { redirect } from "next/navigation";

// Holdings are what the Investments page is. Kept because it was a real route for a while
// and is still in old bookmarks.
export default function HoldingsPage() {
  redirect("/investments");
}
