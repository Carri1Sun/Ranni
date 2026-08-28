import { NextResponse } from "next/server";
import { listSessions } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ sessions: listSessions() });
}
