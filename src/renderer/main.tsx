import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./globals.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("未找到渲染根节点 #root。");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
