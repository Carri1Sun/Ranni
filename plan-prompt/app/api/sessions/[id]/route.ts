import { NextResponse } from "next/server";
import { deleteSession, getSession, listMessages } from "@/lib/db";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  return NextResponse.json({ session, messages: listMessages(id) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!deleteSession(id)) {
    return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
