import { NextResponse } from "next/server";
import {
  appendMessages,
  createSession,
  getSession,
  type StoredMessage,
} from "@/lib/db";

export const runtime = "nodejs";

const SESSION_TITLE_LIMIT = 40;

function sanitizeMessage(value: unknown): StoredMessage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (raw.role !== "user" && raw.role !== "assistant") return null;
  const message: StoredMessage = { id: raw.id, role: raw.role };
  if (typeof raw.content === "string") message.content = raw.content;
  if (typeof raw.query === "string") message.query = raw.query;
  if (typeof raw.thinking === "string") message.thinking = raw.thinking;
  if (raw.error === true) message.error = true;
  const decision = raw.decision;
  if (
    decision &&
    typeof decision === "object" &&
    typeof (decision as Record<string, unknown>).type === "string" &&
    typeof (decision as Record<string, unknown>).message === "string"
  ) {
    const { type, message: decisionMessage } = decision as {
      type: string;
      message: string;
    };
    message.decision = { type, message: decisionMessage };
  }
  if (raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta)) {
    message.meta = raw.meta as Record<string, unknown>;
  }
  if (Array.isArray(raw.activities)) message.activities = raw.activities;
  return message;
}

function buildSessionTitle(messages: StoredMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const title = (firstUser?.content || firstUser?.query || "新会话").trim();
  return title.length > SESSION_TITLE_LIMIT
    ? `${title.slice(0, SESSION_TITLE_LIMIT)}…`
    : title;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容不是有效 JSON。" }, { status: 400 });
  }

  const raw = body as { session_id?: unknown; messages?: unknown };
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    return NextResponse.json({ error: "缺少待保存的消息。" }, { status: 400 });
  }
  const messages = raw.messages
    .map((message) => sanitizeMessage(message))
    .filter((message): message is StoredMessage => message !== null);
  if (messages.length === 0) {
    return NextResponse.json({ error: "消息格式不合法。" }, { status: 400 });
  }

  const sessionId = typeof raw.session_id === "string" && raw.session_id ? raw.session_id : null;
  let session = sessionId ? getSession(sessionId) : undefined;
  if (sessionId && !session) {
    return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  }
  if (!session) {
    session = createSession(buildSessionTitle(messages));
  }

  appendMessages(session.id, messages);
  // appendMessages 更新了 updated_at，返回落库后的最新快照。
  return NextResponse.json({ session: getSession(session.id) ?? session });
}
