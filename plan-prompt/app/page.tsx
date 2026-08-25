"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Source = { title: string; url: string; score?: number };
type Activity = {
  id: string;
  kind: "phase" | "research" | "search" | "thinking" | "warning";
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
type Message = {
  id: string;
  role: "user" | "assistant";
  content?: string;
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

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ThinkingPanel({ activities, pending }: { activities: Activity[]; pending?: boolean }) {
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
        {pending && <div className="activity-tail" />}
      </div>
    </details>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canSubmit = input.trim().length > 0 && !loading;

  function updateAssistant(id: string, updater: (message: Message) => Message) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? updater(message) : message)),
    );
  }

  function handleStreamEvent(id: string, event: string, data: Record<string, unknown>) {
    updateAssistant(id, (message) => {
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
      if (event === "thinking" && !activities.some((activity) => activity.kind === "thinking")) {
        activities.push({
          id: crypto.randomUUID(),
          kind: "thinking",
          message: String(data.message || "正在设计规划…"),
        });
      }
      if (event === "answer_delta") {
        return {
          ...message,
          activities,
          content: `${message.content || ""}${String(data.content || "")}`,
        };
      }
      if (event === "complete") {
        return {
          ...message,
          activities,
          meta: data.meta as ResultMeta,
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

    const task = input.trim();
    const assistantId = crypto.randomUUID();
    setInput("");
    setLoading(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: task },
      { id: assistantId, role: "assistant", activities: [], pending: true },
    ]);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
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
          handleStreamEvent(assistantId, eventName, eventData);
          if (eventName === "complete" || eventName === "error") completed = true;
        }
        if (done) break;
      }

      if (!completed) throw new Error("流式响应提前结束，请重试。");
    } catch (requestError) {
      updateAssistant(assistantId, (message) => ({
        ...message,
        content: requestError instanceof Error ? requestError.message : "请求失败，请稍后再试。",
        pending: false,
        error: true,
      }));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div className="agent-avatar">P</div>
        <div>
          <h1>Plan Agent</h1>
          <p><span />Qwen3.8 Max · Tavily</p>
        </div>
      </header>

      <section className="message-list" aria-live="polite">
        {messages.map((message) => (
          <article className={`message-row ${message.role}`} key={message.id}>
            {message.role === "assistant" && <div className="message-avatar">P</div>}
            <div className={`message-bubble ${message.error ? "error" : ""}`}>
              {!!message.activities?.length && (
                <ThinkingPanel activities={message.activities} pending={message.pending} />
              )}
              {message.pending && message.activities?.length === 0 && (
                <div className="typing" aria-label="Agent 正在输入"><i /><i /><i /></div>
              )}
              {message.content && message.role === "assistant" && (
                <div className={message.activities?.length ? "markdown-body final-answer" : "markdown-body"}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
              )}
              {message.content && message.role === "user" && <p>{message.content}</p>}
              {message.meta && (
                <span className="message-meta">
                  {(message.meta.latency_ms / 1000).toFixed(1)}s
                  {message.meta.researched ? " · 已联网调研" : ""}
                  {message.meta.usage?.total_tokens
                    ? ` · ${message.meta.usage.total_tokens.toLocaleString()} tokens`
                    : ""}
                </span>
              )}
            </div>
          </article>
        ))}
        <div ref={endRef} />
      </section>

      <form className="message-composer" onSubmit={submit}>
        <textarea
          aria-label="任务指令"
          value={input}
          onChange={(event) => setInput(event.target.value.slice(0, 20_000))}
          onKeyDown={handleKeyDown}
          placeholder="输入任务指令…"
          rows={1}
          autoFocus
        />
        <button type="submit" disabled={!canSubmit} aria-label="发送任务"><SendIcon /></button>
      </form>
    </main>
  );
}
