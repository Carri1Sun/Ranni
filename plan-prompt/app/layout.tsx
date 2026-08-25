import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plan Prompt Lab",
  description: "用 Qwen3.8 Max 调试任务规划策略",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
