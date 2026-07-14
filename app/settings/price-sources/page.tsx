import { connection } from "next/server";
import * as db from "@/lib/db";
import { PriceSourceManager } from "@/components/price-source-manager";

export default async function PriceSourcesPage() {
  await connection();
  const sources = db.listPriceSources();

  return <PriceSourceManager sources={sources} />;
}
