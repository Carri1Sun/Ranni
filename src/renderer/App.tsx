import { useEffect, useState } from "react";

import { AgentConsole } from "../../components/agent-console";
import type { TraceRuntimeInfo } from "../../lib/trace";

type RuntimePayload = {
  hasApiKey: boolean;
  runtimeInfo: TraceRuntimeInfo;
  workspaceRoot: string;
};

type RuntimeState =
  | {
      status: "loading";
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "ready";
      payload: RuntimePayload;
    };

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
}

export function App() {
  const apiBaseUrl = getApiBaseUrl();
  const apiDisplayUrl = apiBaseUrl || window.location.origin;
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const loadRuntime = async () => {
      let lastError = "后端未响应。";

      for (let attempt = 0; attempt < 20 && active; attempt += 1) {
        try {
          const response = await fetch(`${apiBaseUrl}/api/runtime`, {
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`运行时信息请求失败：${response.status}`);
          }

          const payload = (await response.json()) as RuntimePayload;

          if (!active) {
            return;
          }

          setRuntimeState({
            status: "ready",
            payload,
          });
          return;
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : "运行时信息加载失败。";

          if (controller.signal.aborted) {
            return;
          }

          await sleep(Math.min(1000 + attempt * 250, 3000));
        }
      }

      if (active) {
        setRuntimeState({
          status: "error",
          message: lastError,
        });
      }
    };

    void loadRuntime();

    return () => {
      active = false;
      controller.abort();
    };
  }, [apiBaseUrl]);

  if (runtimeState.status === "loading") {
    return (
      <main className="app-shell">
        <section className="splash-card">
          <p className="eyebrow">Ranni Local Workbench</p>
          <h1>正在连接 Ranni 本地运行时</h1>
          <p>目标地址：{apiDisplayUrl}</p>
        </section>
      </main>
    );
  }

  if (runtimeState.status === "error") {
    return (
      <main className="app-shell">
        <section className="splash-card">
          <p className="eyebrow">连接失败</p>
          <h1>Ranni 本地运行时尚未准备好</h1>
          <p>{runtimeState.message}</p>
          <p>请确认 Node 后端已启动，且 `BACKEND_PORT` 与网页代理配置一致。</p>
        </section>
      </main>
    );
  }

  return (
    <AgentConsole
      apiBaseUrl={apiBaseUrl}
      hasApiKey={runtimeState.payload.hasApiKey}
      runtimeInfo={runtimeState.payload.runtimeInfo}
      workspaceRoot={runtimeState.payload.workspaceRoot}
    />
  );
}
