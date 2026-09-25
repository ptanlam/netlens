import { connection } from "next/server";
import * as db from "@/lib/db";
import { estimate, type EstateRow } from "@/lib/realestate";
import { RealEstateList } from "@/components/real-estate-list";

export default async function RealEstatePage() {
  await connection();
  const [instruments, properties, comps, index, anchors] = await Promise.all([
    db.listInstruments(), db.listProperties(), db.listComps(), db.listPropertyIndex(),
    db.realEstateAnchors(),
  ]);
  const today = db.todayIso();

  // Valued here rather than in the browser: the table needs each plot's figures, not the
  // scored comps behind them, so only the figures are sent.
  const rows: EstateRow[] = instruments
    .filter((i) => i.asset_type === "Real Estate" && !i.archived)
    .map((inst) => {
      const property = properties.find((p) => p.instrument === inst.name) ?? null;
      const full = property
        ? estimate(
            property, comps.filter((c) => c.instrument === inst.name),
            index.filter((p) => p.instrument === inst.name), anchors[inst.name] ?? null, today,
          )
        : null;
      let valuation: EstateRow["valuation"] = null;
      if (full) {
        const { scored, ...rest } = full;
        void scored;
        valuation = rest;
      }
      return { name: inst.name, booked: db.holdingValue(inst), property, valuation };
    });

  return <RealEstateList rows={rows} />;
}
