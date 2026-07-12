// GET /logout → destroy session then redirect to /login (links can point here safely;
// state change is the session revoke, protected by SameSite=Lax cookie semantics).
import { NextResponse } from "next/server";
import { getSessionUser, destroySession } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { clientIp } from "@/lib/net";

export async function GET(req: Request) {
  const user = await getSessionUser();
  await destroySession();
  if (user)
    await audit({ actorId: user.id, action: "auth.logout", target: user.id, ip: clientIp(req) });
  // Behind a proxy (Railway) the public host arrives via x-forwarded-host; prefer it so the
  // redirect targets the real domain even when APP_URL is misconfigured to localhost. Local dev
  // has no forwarded header, so it falls back to APP_URL (http://localhost:3000) unchanged.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  const base = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.APP_URL ?? req.url);
  return NextResponse.redirect(new URL("/login", base));
}
