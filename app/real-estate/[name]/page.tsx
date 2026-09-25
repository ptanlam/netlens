import { connection } from "next/server";
import { notFound } from "next/navigation";
import * as db from "@/lib/db";
import { RealEstateDetail } from "@/components/real-estate-detail";

/** Next's docs don't promise whether a dynamic segment arrives decoded, and holding names
 *  carry spaces — so both spellings are tried against the real names, never trusted alone. */
function candidates(raw: string): string[] {
  try {
    return [raw, decodeURIComponent(raw)];
  } catch {
    return [raw];
  }
}

export default async function RealEstatePlotPage({ params }: { params: Promise<{ name: string }> }) {
  await connection();
  const { name: raw } = await params;
  const [instruments, properties, index, anchors, valuations] = await Promise.all([
    db.listInstruments(), db.listProperties(), db.listPropertyIndex(),
    db.realEstateAnchors(), db.listValuations(),
  ]);
  const names = candidates(raw);
  const inst = instruments.find((i) => i.asset_type === "Real Estate" && names.includes(i.name));
  if (!inst) notFound();
  // After the lookup, not in the fan-out: it needs the real name, and it's one plot's rows.
  const comps = await db.listComps(inst.name);

  return (
    <RealEstateDetail
      holding={{ name: inst.name, value: db.holdingValue(inst) }}
      property={properties.find((p) => p.instrument === inst.name) ?? null}
      comps={comps}
      index={index.filter((p) => p.instrument === inst.name)}
      anchor={anchors[inst.name] ?? null}
      valuations={valuations.filter((v) => v.instrument === inst.name)}
      today={db.todayIso()}
    />
  );
}
