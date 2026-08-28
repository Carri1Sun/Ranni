"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Source = { title: string; url: string; score?: number };
type Activity = {
  id: string;
  kind: "phase" | "research" | "search" | "warning";
  message: string;
  query?: string;
  queries?: string[];
  sources?: Source[];
  status?: "running" | "done" | "error";
};
type ResultMeta = {
  model: string;
  latency_ms: number;
  usage?: { total_tokens?: number };
  researched?: boolean;
};
type DecisionType = "direct" | "plan" | "clarify";
type Decision = { type: DecisionType; message: string };

function isDecisionType(value: unknown): value is DecisionType {
  return value === "direct" || value === "plan" || value === "clarify";
}
type Message = {
  id: string;
  role: "user" | "assistant";
  content?: string;
  query?: string;
  thinking?: string;
  decision?: Decision;
  meta?: ResultMeta;
  activities?: Activity[];
  pending?: boolean;
  error?: boolean;
};

const INITIAL_MESSAGES: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "发一条任务给我。我会按需搜索调研，然后判断应该直接执行、先生成计划，还是询问一个关键问题。",
  },
];

type SessionSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

// 把持久化还原的消息宽松校验为前端 Message；异常字段静默丢弃。
function toMessage(value: unknown): Message | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || (raw.role !== "user" && raw.role !== "assistant")) return null;
  const message: Message = { id: raw.id, role: raw.role };
  if (typeof raw.content === "string") message.content = raw.content;
  if (typeof raw.query === "string") message.query = raw.query;
  if (typeof raw.thinking === "string") message.thinking = raw.thinking;
  const decision = raw.decision as { type?: unknown; message?: unknown } | undefined;
  if (decision && isDecisionType(decision.type) && typeof decision.message === "string") {
    message.decision = { type: decision.type, message: decision.message };
  }
  if (Array.isArray(raw.activities)) message.activities = raw.activities as Activity[];
  if (raw.meta && typeof raw.meta === "object") message.meta = raw.meta as ResultMeta;
  if (raw.error === true) message.error = true;
  return message;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(then).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 14-7-4.5 14-3-5.5L5 12Zm0 0h6.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.7" cy="10.7" r="5.7" /><path d="m15 15 4.3 4.3" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function exportMessageAsJson(message: Message) {
  if (!message.decision) return;
  const payload = {
    query: message.query || "",
    thinking: message.thinking || "",
    type: message.decision.type,
    message: message.decision.message,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  anchor.href = url;
  anchor.download = `plan-${message.decision.type}-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ThinkingPanel({
  activities,
  thinking,
  pending,
}: {
  activities: Activity[];
  thinking?: string;
  pending?: boolean;
}) {
  const streamRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const stream = streamRef.current;
    if (stream && pinnedRef.current) stream.scrollTop = stream.scrollHeight;
  }, [thinking]);

  return (
    <details className="thinking-panel" open={pending || undefined}>
      <summary>
        <span className={pending ? "thinking-spinner" : "thinking-check"}>{pending ? "" : "✓"}</span>
        {pending ? "正在思考" : "思考过程"}
        <span className="chevron">⌄</span>
      </summary>
      <div className="activity-list">
        {activities.map((activity) => (
          <div className={`activity ${activity.kind}`} key={activity.id}>
            <span className="activity-mark">
              {activity.kind === "search" ? <SearchIcon /> : activity.status === "error" ? "!" : "·"}
            </span>
            <div>
              <p>{activity.message}</p>
              {!!activity.queries?.length && (
                <div className="query-list">
                  {activity.queries.map((query) => <span key={query}>{query}</span>)}
                </div>
              )}
              {!!activity.sources?.length && (
                <div className="source-list">
                  {activity.sources.map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                      <span>{source.title}</span>
                      <small>{sourceHost(source.url)}</small>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && !thinking && <div className="activity-tail" />}
      </div>
      {!!thinking && (
        <div
          className="thinking-stream"
          ref={streamRef}
          onScroll={(event) => {
            const stream = event.currentTarget;
            pinnedRef.current =
              stream.scrollHeight - stream.scrollTop - stream.clientHeight < 24;
          }}
        >
          {thinking}
          {pending && <span className="thinking-caret" />}
        </div>
      )}
    </details>
  );
}

const DECISION_LABELS: Record<DecisionType, string> = {
  direct: "直接执行",
  plan: "待确认计划",
  clarify: "需要补充信息",
};

function DecisionCard({ decision }: { decision: Decision }) {
  return (
    <div className="decision-card">
      <span className={`decision-tag ${decision.type}`}>
        {decision.type}
        <em>{DECISION_LABELS[decision.type]}</em>
      </span>
      <div className="decision-message markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{decision.message}</ReactMarkdown>
      </div>
    </div>
  );
}

// 每个会话独立的消息与运行状态：key 为 session id 或草稿会话的 "draft"。
const DRAFT_KEY = "draft";

type SessionState = {
  messages: Message[];
  running: boolean;
};

export default function Home() {
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState<string>(DRAFT_KEY);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // 每个进行中会话的本轮消息引用（流事件同步更新，结束时整体落库）。
  const turnRefs = useRef<Record<string, { user: Message; assistant: Message }>>({});
  // 每个进行中会话的流控制器：删除会话时中断对应请求。
  const abortRefs = useRef<Record<string, AbortController>>({});

  const activeState = states[activeKey];
  const activeInput = inputs[activeKey] ?? "";
  const visibleMessages = activeState?.messages ?? INITIAL_MESSAGES;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  useEffect(() => {
    (async () => {
      const list = await refreshSessions();
      if (list.length > 0) await loadSession(list[0].id);
    })();
    // 仅在挂载时加载一次历史会话。
  }, []);

  const canSubmit = activeInput.trim().length > 0 && !activeState?.running;

  async function refreshSessions(): Promise<SessionSummary[]> {
    try {
      const response = await fetch("/api/sessions");
      if (!response.ok) return [];
      const data = (await response.json()) as { sessions?: unknown };
      const list = Array.isArray(data.sessions)
        ? data.sessions.filter(
            (item): item is SessionSummary =>
              !!item && typeof item === "object" && typeof (item as SessionSummary).id === "string",
          )
        : [];
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }

  async function loadSession(id: string) {
    setSidebarOpen(false);
    // 已在内存中（含正在运行的流）：直接切换，流更新不受视图切换影响。
    if (states[id]) {
      setActiveKey(id);
      return;
    }
    try {
      const response = await fetch(`/api/sessions/${id}`);
      if (!response.ok) return;
      const data = (await response.json()) as { messages?: unknown };
      const restored = Array.isArray(data.messages)
        ? data.messages.map(toMessage).filter((message): message is Message => message !== null)
        : [];
      setStates((current) =>
        current[id] ? current : { ...current, [id]: { messages: restored, running: false } },
      );
      setActiveKey(id);
    } catch {
      // 加载失败保持当前视图。
    }
  }

  function newSession() {
    setActiveKey(DRAFT_KEY);
    setSidebarOpen(false);
  }

  async function removeSession(id: string) {
    const running = states[id]?.running;
    const confirmText = running
      ? "该会话正在运行任务，删除会中断当前任务。确定删除？"
      : "删除该会话及其全部消息？";
    if (!window.confirm(confirmText)) return;
    // 先中断流并清掉本轮引用：后续 catch/finally 会发现会话已不存在而放弃落库。
    abortRefs.current[id]?.abort();
    delete abortRefs.current[id];
    delete turnRefs.current[id];
    setStates((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (activeKey === id) setActiveKey(DRAFT_KEY);
    try {
      const response = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (response.ok) await refreshSessions();
    } catch {
      // 删除失败保持现状。
    }
  }

  // 流结束后保存本轮两条消息；草稿会话由服务端自动创建并返回 session id。
  async function persistTurn(key: string) {
    const turn = turnRefs.current[key];
    delete turnRefs.current[key];
    delete abortRefs.current[key];
    setStates((current) =>
      current[key] ? { ...current, [key]: { ...current[key], running: false } } : current,
    );
    if (!turn) return; // 会话已被删除：放弃落库。
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: key === DRAFT_KEY ? null : key,
          messages: [turn.user, turn.assistant],
        }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as { session?: { id?: unknown } };
      const sessionId = typeof data.session?.id === "string" ? data.session.id : null;
      if (!sessionId) return;
      if (key === DRAFT_KEY) {
        // 草稿落库成为正式会话：迁移状态；若用户仍停留在此视图则跟随切换。
        setStates((current) => {
          const draftState = current[DRAFT_KEY];
          if (!draftState) return current;
          const next = { ...current, [sessionId]: draftState };
          delete next[DRAFT_KEY];
          return next;
        });
        setInputs((current) => {
          const next = { ...current };
          if (next[DRAFT_KEY] !== undefined) {
            next[sessionId] = next[DRAFT_KEY];
            delete next[DRAFT_KEY];
          }
          return next;
        });
        setActiveKey((current) => (current === DRAFT_KEY ? sessionId : current));
      }
      await refreshSessions();
    } catch {
      // 保存失败不影响本轮展示，仅不落库。
    }
  }

  // updater 必须是纯函数：先同步应用到 turnRefs（供流结束后落库读取最新状态），
  // 再交给 setStates（React 的 updater 延迟到渲染时执行，不能作为落库数据源）。
  function updateAssistant(key: string, id: string, updater: (message: Message) => Message) {
    const turn = turnRefs.current[key];
    if (turn?.assistant.id === id) {
      turnRefs.current[key] = { ...turn, assistant: updater(turn.assistant) };
    }
    setStates((current) => {
      const state = current[key];
      if (!state) return current; // 会话已被删除：丢弃流事件。
      return {
        ...current,
        [key]: { ...state, messages: state.messages.map((m) => (m.id === id ? updater(m) : m)) },
      };
    });
  }

  function handleStreamEvent(key: string, id: string, event: string, data: Record<string, unknown>) {
    updateAssistant(key, id, (message) => {
      const activities = [...(message.activities || [])];

      if (event === "phase") {
        activities.push({
          id: crypto.randomUUID(),
          kind: data.tone === "warning" ? "warning" : "phase",
          message: String(data.message || "正在处理…"),
        });
      }
      if (event === "research_plan") {
        const queries = Array.isArray(data.queries)
          ? data.queries.filter((query): query is string => typeof query === "string")
          : [];
        activities.push({
          id: crypto.randomUUID(),
          kind: "research",
          message: String(data.rationale || "已完成调研判断。"),
          queries,
        });
      }
      if (event === "search_start") {
        const query = String(data.query || "");
        activities.push({
          id: `search-${query}`,
          kind: "search",
          message: `搜索：${query}`,
          query,
          status: "running",
        });
      }
      if (event === "search_result" || event === "search_error") {
        const query = String(data.query || "");
        const sources = Array.isArray(data.sources) ? (data.sources as Source[]) : [];
        const index = activities.findIndex((activity) => activity.id === `search-${query}`);
        const next: Activity = {
          id: `search-${query}`,
          kind: "search",
          message:
            event === "search_error"
              ? `搜索失败：${String(data.message || query)}`
              : `已检索 ${sources.length} 个相关来源`,
          query,
          sources,
          status: event === "search_error" ? "error" : "done",
        };
        if (index >= 0) activities[index] = next;
        else activities.push(next);
      }
      if (event === "thinking_delta") {
        return {
          ...message,
          activities,
          thinking: `${message.thinking || ""}${String(data.content || "")}`,
        };
      }
      if (event === "answer_delta") {
        return {
          ...message,
          activities,
          content: `${message.content || ""}${String(data.content || "")}`,
        };
      }
      if (event === "complete") {
        const raw = data.decision as { type?: unknown; message?: unknown } | undefined;
        const decision =
          raw && isDecisionType(raw.type) && typeof raw.message === "string" && raw.message.trim()
            ? { type: raw.type, message: raw.message }
            : undefined;
        return {
          ...message,
          activities,
          meta: data.meta as ResultMeta,
          decision,
          pending: false,
        };
      }
      if (event === "error") {
        return {
          ...message,
          activities,
          content: String(data.message || "请求失败，请稍后再试。"),
          pending: false,
          error: true,
        };
      }
      return { ...message, activities };
    });
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit) return;

    const key = activeKey;
    const task = activeInput.trim();
    const assistantId = crypto.randomUUID();
    const controller = new AbortController();
    setInputs((current) => ({ ...current, [key]: "" }));
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: task };
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      query: task,
      activities: [],
      pending: true,
    };
    turnRefs.current[key] = { user: userMessage, assistant: assistantMessage };
    abortRefs.current[key] = controller;
    setStates((current) => ({
      ...current,
      [key]: {
        messages: [...(current[key]?.messages ?? []), userMessage, assistantMessage],
        running: true,
      },
    }));

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "请求失败，请稍后再试。");
      }
      if (!response.body) throw new Error("服务端未返回流式响应。");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          let eventName = "message";
          const dataLines: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          const eventData = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
          handleStreamEvent(key, assistantId, eventName, eventData);
          if (eventName === "complete" || eventName === "error") completed = true;
        }
        if (done) break;
      }

      if (!completed) throw new Error("流式响应提前结束，请重试。");
    } catch (requestError) {
      const aborted = requestError instanceof DOMException && requestError.name === "AbortError";
      const failure = aborted
        ? "会话已删除，任务中断。"
        : requestError instanceof Error
          ? requestError.message
          : "请求失败，请稍后再试。";
      updateAssistant(key, assistantId, (message) => ({
        ...message,
        content: aborted ? message.content : failure,
        pending: false,
        error: !aborted,
      }));
    } finally {
      await persistTurn(key);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="app-shell">
      <aside className={`session-sidebar ${sidebarOpen ? "open" : ""}`}>
        <button
          type="button"
          className="new-session-button"
          onClick={newSession}
          disabled={!!states[DRAFT_KEY]?.running}
        >
          <PlusIcon />
          新建会话
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              className={`session-item ${session.id === activeKey ? "active" : ""}`}
              onClick={() => loadSession(session.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadSession(session.id);
              }}
            >
              {states[session.id]?.running && (
                <span className="session-running" aria-label="任务运行中" />
              )}
              <span className="session-title">{session.title}</span>
              <span className="session-time">{relativeTime(session.updated_at)}</span>
              <button
                type="button"
                className="session-delete"
                aria-label="删除会话"
                onClick={(event) => {
                  event.stopPropagation();
                  removeSession(session.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
          {sessions.length === 0 && <p className="session-empty">还没有历史会话</p>}
        </div>
      </aside>
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <main className="chat-shell">
        <header className="chat-header">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label="打开会话列表"
            onClick={() => setSidebarOpen(true)}
          >
            <MenuIcon />
          </button>
          <div className="agent-avatar">P</div>
          <div>
            <h1>Plan Agent</h1>
            <p><span />Qwen3.8 Max · Tavily</p>
          </div>
        </header>

      <section className="message-list" aria-live="polite">
        {visibleMessages.map((message) => (
          <article className={`message-row ${message.role}`} key={message.id}>
            {message.role === "assistant" && <div className="message-avatar">P</div>}
            <div className={`message-bubble ${message.error ? "error" : ""}`}>
              {(!!message.activities?.length || !!message.thinking) && (
                <ThinkingPanel
                  activities={message.activities || []}
                  thinking={message.thinking}
                  pending={message.pending}
                />
              )}
              {message.pending && !message.activities?.length && !message.thinking && (
                <div className="typing" aria-label="Agent 正在输入"><i /><i /><i /></div>
              )}
              {message.role === "assistant" && message.decision && <DecisionCard decision={message.decision} />}
              {message.role === "assistant" && !message.decision && message.content && (
                <div className={message.activities?.length ? "markdown-body final-answer" : "markdown-body"}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
              )}
              {message.content && message.role === "user" && <p>{message.content}</p>}
              {(message.meta || message.decision) && (
                <div className="message-footer">
                  {message.meta && (
                    <span className="message-meta">
                      {(message.meta.latency_ms / 1000).toFixed(1)}s
                      {message.meta.researched ? " · 已联网调研" : ""}
                      {message.meta.usage?.total_tokens
                        ? ` · ${message.meta.usage.total_tokens.toLocaleString()} tokens`
                        : ""}
                    </span>
                  )}
                  {message.decision && (
                    <button
                      type="button"
                      className="save-button"
                      onClick={() => exportMessageAsJson(message)}
                    >
                      <SaveIcon />
                      保存 JSON
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
        <div ref={endRef} />
      </section>

      <form className="message-composer" onSubmit={submit}>
        <textarea
          aria-label="任务指令"
          value={activeInput}
          onChange={(event) =>
            setInputs((current) => ({ ...current, [activeKey]: event.target.value.slice(0, 20_000) }))
          }
          onKeyDown={handleKeyDown}
          placeholder={activeState?.running ? "本会话任务运行中…" : "输入任务指令…"}
          rows={1}
          autoFocus
        />
        <button type="submit" disabled={!canSubmit} aria-label="发送任务"><SendIcon /></button>
      </form>
      </main>
    </div>
  );
}
