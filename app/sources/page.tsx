import { connection } from "next/server";
import * as db from "@/lib/db";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { PriceSourceManager } from "@/components/price-source-manager";

export default async function SourcesPage() {
  await connection();
  const sources = db.listPriceSources();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Price sources</CardTitle>
          <CardDescription>
            The feeds your holdings are priced against. Each is a self-contained config —
            a request URL and how to read the price out — so you can add a new one without
            touching code. The four built-ins are ready to use; edit or extend as needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PriceSourceManager sources={sources} />
        </CardContent>
      </Card>
    </div>
  );
}
