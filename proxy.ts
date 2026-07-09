import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "inv_auth";
let cachedToken: string | null = null;

async function expectedToken(password: string): Promise<string> {
  if (cachedToken) return cachedToken;
  const data = new TextEncoder().encode(`investment-viz::${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  cachedToken = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return cachedToken;
}

export async function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // no password set -> open (dev)

  const { pathname } = req.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie === (await expectedToken(password))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
