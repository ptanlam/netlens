import * as db from "@/lib/db";

/**
 * A holding's uploaded logo, as an image. The page links it as `?v=<logo_at>` (see
 * `uploadedLogoUrl`), so a given URL only ever means one image and can be cached for good:
 * a new upload is a new URL. `private` because this app sits behind your login.
 *
 * Stored as a data: URL (`instrument_logos`), decoded here so the browser gets real bytes
 * and caches them like any other image, instead of every page inlining the base64.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  // Decoded again defensively: harmless on an already-decoded name, and a stray `%` in a
  // name that can't be decoded just falls back to the name as given.
  let key = name;
  try {
    key = decodeURIComponent(name);
  } catch {}
  const data = await db.getInstrumentLogo(key);
  const m = data?.match(/^data:(image\/(?:png|webp|jpeg));base64,(.+)$/);
  if (!m) return new Response("Not found", { status: 404 });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
