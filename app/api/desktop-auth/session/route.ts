import { NextRequest, NextResponse } from "next/server";
import { exchangeDesktopGrant, getDesktopSession, revokeDesktopSession } from "@/lib/desktop-auth";

export const runtime = "nodejs";

function bearer(request: NextRequest) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { code?: string; state?: string };
    const session = await exchangeDesktopGrant(String(body.code || ""), String(body.state || ""));
    if (!session) return NextResponse.json({ error: "Ссылка входа недействительна или устарела" }, { status: 401 });
    return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Desktop auth exchange failed", error);
    return NextResponse.json({ error: "Не удалось завершить вход" }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getDesktopSession(bearer(request));
    if (!session) return NextResponse.json({ error: "Сессия недействительна" }, { status: 401 });
    return NextResponse.json({ profile: session.profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Desktop auth validation failed", error);
    return NextResponse.json({ error: "Не удалось проверить сессию" }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await revokeDesktopSession(bearer(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Desktop auth revoke failed", error);
    return NextResponse.json({ error: "Не удалось завершить сессию" }, { status: 503 });
  }
}
