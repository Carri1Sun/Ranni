type HtmlSlideTemplate = {
  assets: Record<string, string>;
  css: string;
  html: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function summarizePrompt(value: string | undefined, fallback: string) {
  const normalized = (value?.trim() || fallback).replace(/\s+/g, " ");

  return normalized.length > 88 ? `${normalized.slice(0, 85)}...` : normalized;
}

export function createBlankSlideHtmlTemplate(
  title: string,
  prompt?: string,
): HtmlSlideTemplate {
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(
    summarizePrompt(prompt, "在这里放置受限 slide HTML 内容。"),
  );

  return {
    assets: {},
    css: [
      "html, body { margin: 0; padding: 0; background: #eef2f7; }",
      "body { font-family: Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif; }",
      ".deck { width: 1280px; }",
      ".slide { position: relative; width: 1280px; height: 720px; overflow: hidden; box-sizing: border-box; background: #ffffff; }",
      ".slide * { box-sizing: border-box; }",
      ".slide-title { position: absolute; left: 88px; top: 86px; width: 920px; margin: 0; color: #172033; font-size: 56px; line-height: 1.08; }",
      ".slide-copy { position: absolute; left: 92px; top: 188px; width: 720px; margin: 0; color: #41516a; font-size: 24px; line-height: 1.48; }",
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="zh-CN">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=1280, initial-scale=1" />',
      `  <title>${safeTitle}</title>`,
      '  <link rel="stylesheet" href="./styles.css" />',
      "</head>",
      "<body>",
      '  <main class="deck" data-pptx-deck>',
      '    <section class="slide" data-slide-id="cover">',
      `      <h1 class="slide-title" data-pptx-editable>${safeTitle}</h1>`,
      `      <p class="slide-copy" data-pptx-editable>${safePrompt}</p>`,
      "    </section>",
      "  </main>",
      "</body>",
      "</html>",
    ].join("\n"),
  };
}

export function createSpikeSlideHtmlTemplate(
  title: string,
  prompt?: string,
): HtmlSlideTemplate {
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(
    summarizePrompt(
      prompt,
      "验证受限 slide HTML、dom-to-pptx 和局部截图回退的组合边界。",
    ),
  );

  return {
    assets: {
      "workbench.svg": workbenchSvg(),
      "pattern-grid.svg": patternGridSvg(),
    },
    css: spikeCss(),
    html: [
      "<!doctype html>",
      '<html lang="zh-CN">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=1280, initial-scale=1" />',
      `  <title>${safeTitle}</title>`,
      '  <link rel="stylesheet" href="./styles.css" />',
      "</head>",
      "<body>",
      '  <main class="deck" data-pptx-deck>',
      coverSlide(safeTitle, safePrompt),
      agendaSlide(),
      textSlide(),
      twoColumnSlide(),
      dataSlide(),
      rasterChartSlide(),
      timelineSlide(),
      summarySlide(),
      "  </main>",
      canvasScript(),
      "</body>",
      "</html>",
    ].join("\n"),
  };
}

function coverSlide(title: string, prompt: string) {
  return [
    '    <section class="slide cover-slide" data-slide-id="cover">',
    '      <img class="cover-pattern" src="./assets/pattern-grid.svg" alt="" data-pptx-ignore />',
    '      <div class="cover-band"></div>',
    '      <p class="eyebrow" data-pptx-editable>Ranni slides spike</p>',
    `      <h1 class="cover-title" data-pptx-editable>${title}</h1>`,
    `      <p class="cover-subtitle" data-pptx-editable>${prompt}</p>`,
    '      <div class="cover-meta" data-pptx-editable>HTML source -> prepared DOM -> limited editable PPTX</div>',
    '    </section>',
  ].join("\n");
}

function agendaSlide() {
  return [
    '    <section class="slide agenda-slide" data-slide-id="agenda">',
    '      <h2 class="slide-heading" data-pptx-editable>目录</h2>',
    '      <ol class="agenda-list">',
    '        <li data-pptx-editable><span>01</span><strong>规范</strong><em>固定画布与导出标注</em></li>',
    '        <li data-pptx-editable><span>02</span><strong>预处理</strong><em>Playwright 测量与截图回退</em></li>',
    '        <li data-pptx-editable><span>03</span><strong>转换</strong><em>dom-to-pptx 生成有限可编辑 PPTX</em></li>',
    '        <li data-pptx-editable><span>04</span><strong>验证</strong><em>HTML / PPTX 预览与 QA 报告</em></li>',
    "      </ol>",
    '      <p class="page-note" data-pptx-editable>目标是先收敛可用子集，再决定产品化投入。</p>',
    "    </section>",
  ].join("\n");
}

function textSlide() {
  return [
    '    <section class="slide text-slide" data-slide-id="text">',
    '      <h2 class="slide-heading" data-pptx-editable>受限 HTML 的写作边界</h2>',
    '      <div class="text-panel primary" data-pptx-editable>',
    "        <h3>页面约束</h3>",
    "        <p>每页使用独立 .slide，画布固定为 1280 x 720，页内 overflow hidden，避免转换时出现滚动状态。</p>",
    "      </div>",
    '      <div class="text-panel secondary" data-pptx-editable>',
    "        <h3>元素意图</h3>",
    "        <p>重要标题和正文标记 data-pptx-editable，复杂视觉块标记 data-pptx-raster 并提供 data-pptx-alt。</p>",
    "      </div>",
    '      <blockquote data-pptx-editable>优先保留关键文本可编辑性，复杂视觉使用局部截图稳定输出。</blockquote>',
    "    </section>",
  ].join("\n");
}

function twoColumnSlide() {
  return [
    '    <section class="slide two-col-slide" data-slide-id="two-col">',
    '      <h2 class="slide-heading" data-pptx-editable>双栏图文页</h2>',
    '      <div class="copy-column" data-pptx-editable>',
    "        <h3>面向 agent 的生成方式</h3>",
    "        <ul>",
    "          <li>用 CSS 控制版式和视觉层级。</li>",
    "          <li>所有本地资源放进 assets/。</li>",
    "          <li>导出前将复杂局部替换为图片。</li>",
    "        </ul>",
    "      </div>",
    '      <figure class="visual-column">',
    '        <img src="./assets/workbench.svg" alt="Ranni workbench illustration" data-pptx-alt="Ranni workbench illustration" />',
    '        <figcaption data-pptx-editable>本地 SVG 资产可随 deck 目录迁移。</figcaption>',
    "      </figure>",
    "    </section>",
  ].join("\n");
}

function dataSlide() {
  return [
    '    <section class="slide data-slide" data-slide-id="data-table">',
    '      <h2 class="slide-heading" data-pptx-editable>数据与表格页</h2>',
    '      <div class="metric-row">',
    '        <div class="metric-card" data-pptx-editable><span>Slides</span><strong>8</strong><em>覆盖典型版式</em></div>',
    '        <div class="metric-card green" data-pptx-editable><span>Editable</span><strong>文本</strong><em>保留为对象</em></div>',
    '        <div class="metric-card gold" data-pptx-editable><span>Raster</span><strong>局部</strong><em>按节点回退</em></div>',
    "      </div>",
    '      <table class="qa-table">',
    "        <thead><tr><th data-pptx-editable>检查项</th><th data-pptx-editable>方法</th><th data-pptx-editable>输出</th></tr></thead>",
    "        <tbody>",
    "          <tr><td data-pptx-editable>尺寸</td><td data-pptx-editable>DOM 测量</td><td data-pptx-editable>measurements.json</td></tr>",
    "          <tr><td data-pptx-editable>回退</td><td data-pptx-editable>元素截图</td><td data-pptx-editable>fallback-assets/</td></tr>",
    "          <tr><td data-pptx-editable>预览</td><td data-pptx-editable>HTML / PPTX 渲染</td><td data-pptx-editable>preview-*/</td></tr>",
    "        </tbody>",
    "      </table>",
    "    </section>",
  ].join("\n");
}

function rasterChartSlide() {
  return [
    '    <section class="slide chart-slide" data-slide-id="raster-chart">',
    '      <h2 class="slide-heading" data-pptx-editable>复杂图表截图回退页</h2>',
    '      <p class="chart-copy" data-pptx-editable>图表主体使用 canvas、渐变和叠加标签，导出前按 data-pptx-raster 局部截图。</p>',
    '      <div class="chart-raster" data-pptx-raster data-pptx-alt="复杂增长路径图">',
    '        <canvas id="growth-canvas" width="760" height="350"></canvas>',
    '        <div class="chart-label label-a">Q1 需求爬坡</div>',
    '        <div class="chart-label label-b">Q3 质量门稳定</div>',
    '        <div class="chart-legend"><span></span>HTML 预览与 PPTX 输出差异</div>',
    "      </div>",
    '      <div class="side-callout" data-pptx-editable><strong>保留策略</strong><br />标题、说明和结论仍保持可编辑。</div>',
    "    </section>",
  ].join("\n");
}

function timelineSlide() {
  return [
    '    <section class="slide timeline-slide" data-slide-id="timeline">',
    '      <h2 class="slide-heading" data-pptx-editable>产品化时间线</h2>',
    '      <div class="timeline-line"></div>',
    '      <div class="timeline-item t1" data-pptx-editable><span>P0</span><strong>Spike</strong><em>验证工具链和样例 deck</em></div>',
    '      <div class="timeline-item t2" data-pptx-editable><span>P1</span><strong>Skill route</strong><em>暴露稳定工具与报告字段</em></div>',
    '      <div class="timeline-item t3" data-pptx-editable><span>P2</span><strong>Quality gates</strong><em>增加 diff、字体和编辑性检查</em></div>',
    '      <div class="timeline-item t4" data-pptx-editable><span>P3</span><strong>Mapper</strong><em>为稳定子集自研映射器</em></div>',
    "    </section>",
  ].join("\n");
}

function summarySlide() {
  return [
    '    <section class="slide summary-slide" data-slide-id="summary">',
    '      <div class="summary-mark"></div>',
    '      <h2 class="summary-title" data-pptx-editable>结论</h2>',
    '      <div class="summary-grid">',
    '        <div data-pptx-editable><strong>可编辑优先</strong><span>正文和核心结论保留为 PPTX 文本对象。</span></div>',
    '        <div data-pptx-editable><strong>视觉稳定</strong><span>复杂节点在转换前进入 fallback-assets/。</span></div>',
    '        <div data-pptx-editable><strong>证据留存</strong><span>measurements.json 与 qa-report.json 记录真实表现。</span></div>',
    "      </div>",
    '      <p class="summary-footer" data-pptx-editable>下一步：扩大样例覆盖，并补充图像 diff 与字体检查。</p>',
    "    </section>",
  ].join("\n");
}

function canvasScript() {
  return [
    "  <script>",
    "    const canvas = document.getElementById('growth-canvas');",
    "    if (canvas) {",
    "      const ctx = canvas.getContext('2d');",
    "      const w = canvas.width;",
    "      const h = canvas.height;",
    "      const gradient = ctx.createLinearGradient(0, 0, w, h);",
    "      gradient.addColorStop(0, '#f6f8ff');",
    "      gradient.addColorStop(1, '#fff7ed');",
    "      ctx.fillStyle = gradient;",
    "      ctx.fillRect(0, 0, w, h);",
    "      ctx.strokeStyle = '#d7deea';",
    "      ctx.lineWidth = 1;",
    "      for (let x = 60; x < w; x += 80) { ctx.beginPath(); ctx.moveTo(x, 34); ctx.lineTo(x, h - 46); ctx.stroke(); }",
    "      for (let y = 60; y < h; y += 58) { ctx.beginPath(); ctx.moveTo(42, y); ctx.lineTo(w - 36, y); ctx.stroke(); }",
    "      const points = [[62,260],[150,230],[238,246],[326,184],[414,152],[502,116],[590,136],[678,78]];",
    "      const area = ctx.createLinearGradient(0, 78, 0, 300);",
    "      area.addColorStop(0, 'rgba(20, 184, 166, 0.36)');",
    "      area.addColorStop(1, 'rgba(20, 184, 166, 0.02)');",
    "      ctx.beginPath();",
    "      ctx.moveTo(points[0][0], 300);",
    "      for (const p of points) ctx.lineTo(p[0], p[1]);",
    "      ctx.lineTo(points[points.length - 1][0], 300);",
    "      ctx.closePath();",
    "      ctx.fillStyle = area;",
    "      ctx.fill();",
    "      ctx.beginPath();",
    "      points.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });",
    "      ctx.strokeStyle = '#0f766e';",
    "      ctx.lineWidth = 8;",
    "      ctx.lineJoin = 'round';",
    "      ctx.shadowColor = 'rgba(15, 118, 110, 0.32)';",
    "      ctx.shadowBlur = 18;",
    "      ctx.stroke();",
    "      ctx.shadowBlur = 0;",
    "      points.forEach((p, i) => { ctx.beginPath(); ctx.arc(p[0], p[1], i === 7 ? 13 : 9, 0, Math.PI * 2); ctx.fillStyle = i === 7 ? '#ef4444' : '#14b8a6'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.stroke(); });",
    "    }",
    "  </script>",
  ].join("\n");
}

function spikeCss() {
  return [
    ":root { color-scheme: light; }",
    "html, body { margin: 0; padding: 0; background: #e8edf5; }",
    "body { font-family: Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #172033; }",
    ".deck { width: 1280px; }",
    ".slide { position: relative; width: 1280px; height: 720px; overflow: hidden; box-sizing: border-box; background: #fbfcff; }",
    ".slide * { box-sizing: border-box; }",
    ".slide + .slide { margin-top: 28px; }",
    ".slide-heading { position: absolute; left: 78px; top: 58px; width: 820px; margin: 0; color: #172033; font-size: 44px; line-height: 1.1; letter-spacing: 0; }",
    ".page-note { position: absolute; left: 92px; bottom: 58px; width: 720px; margin: 0; color: #607086; font-size: 22px; line-height: 1.35; }",
    ".cover-slide { background: linear-gradient(135deg, #f8fbff 0%, #eef6f1 54%, #fff7ed 100%); }",
    ".cover-pattern { position: absolute; right: 0; top: 0; width: 520px; opacity: .36; }",
    ".cover-band { position: absolute; left: 0; bottom: 0; width: 1280px; height: 148px; background: linear-gradient(90deg, #172033 0%, #26536a 52%, #b45309 100%); }",
    ".eyebrow { position: absolute; left: 92px; top: 92px; margin: 0; color: #0f766e; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }",
    ".cover-title { position: absolute; left: 88px; top: 150px; width: 790px; margin: 0; color: #142033; font-size: 62px; line-height: 1.06; letter-spacing: 0; }",
    ".cover-subtitle { position: absolute; left: 94px; top: 330px; width: 690px; margin: 0; color: #41516a; font-size: 27px; line-height: 1.42; }",
    ".cover-meta { position: absolute; left: 96px; bottom: 54px; color: #ffffff; font-size: 24px; font-weight: 700; }",
    ".agenda-list { position: absolute; left: 88px; top: 150px; width: 960px; margin: 0; padding: 0; list-style: none; display: grid; gap: 22px; }",
    ".agenda-list li { display: grid; grid-template-columns: 86px 190px 1fr; align-items: center; min-height: 72px; padding: 0 24px; border-left: 7px solid #0f766e; background: #ffffff; box-shadow: 0 18px 40px rgba(38, 61, 82, .09); }",
    ".agenda-list span { color: #b45309; font-size: 24px; font-weight: 800; }",
    ".agenda-list strong { color: #172033; font-size: 28px; }",
    ".agenda-list em { color: #607086; font-size: 22px; font-style: normal; }",
    ".text-panel { position: absolute; top: 152px; width: 470px; height: 210px; padding: 30px 34px; background: #ffffff; border-top: 8px solid #2f6f8f; box-shadow: 0 18px 42px rgba(38, 61, 82, .1); }",
    ".text-panel.primary { left: 88px; }",
    ".text-panel.secondary { left: 596px; border-top-color: #c97920; }",
    ".text-panel h3 { margin: 0 0 18px; font-size: 28px; color: #172033; }",
    ".text-panel p { margin: 0; font-size: 22px; line-height: 1.42; color: #41516a; }",
    "blockquote { position: absolute; left: 108px; top: 442px; width: 940px; margin: 0; padding: 28px 36px; color: #102a43; font-size: 28px; line-height: 1.36; background: #eef6f1; border-left: 10px solid #0f766e; }",
    ".copy-column { position: absolute; left: 88px; top: 148px; width: 470px; color: #25354d; }",
    ".copy-column h3 { margin: 0 0 24px; font-size: 32px; color: #172033; }",
    ".copy-column ul { margin: 0; padding-left: 28px; font-size: 24px; line-height: 1.55; }",
    ".visual-column { position: absolute; right: 86px; top: 136px; width: 520px; height: 420px; margin: 0; }",
    ".visual-column img { width: 520px; height: 350px; object-fit: contain; display: block; background: #ffffff; box-shadow: 0 20px 48px rgba(38, 61, 82, .12); }",
    ".visual-column figcaption { margin-top: 18px; color: #607086; font-size: 20px; text-align: center; }",
    ".metric-row { position: absolute; left: 78px; top: 136px; width: 1040px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }",
    ".metric-card { height: 134px; padding: 22px 26px; background: #ffffff; border-bottom: 8px solid #2f6f8f; box-shadow: 0 18px 42px rgba(38, 61, 82, .1); }",
    ".metric-card.green { border-bottom-color: #0f766e; }",
    ".metric-card.gold { border-bottom-color: #b45309; }",
    ".metric-card span { display: block; color: #607086; font-size: 18px; font-weight: 700; text-transform: uppercase; }",
    ".metric-card strong { display: block; margin-top: 8px; color: #172033; font-size: 36px; line-height: 1; }",
    ".metric-card em { display: block; margin-top: 10px; color: #41516a; font-size: 18px; font-style: normal; }",
    ".qa-table { position: absolute; left: 78px; top: 320px; width: 1040px; border-collapse: collapse; background: #ffffff; box-shadow: 0 18px 42px rgba(38, 61, 82, .1); }",
    ".qa-table th, .qa-table td { height: 62px; padding: 0 24px; border-bottom: 1px solid #e2e8f0; color: #25354d; font-size: 22px; text-align: left; }",
    ".qa-table th { color: #ffffff; background: #172033; font-size: 21px; }",
    ".chart-copy { position: absolute; left: 80px; top: 122px; width: 570px; margin: 0; color: #607086; font-size: 22px; line-height: 1.42; }",
    ".chart-raster { position: absolute; left: 72px; top: 210px; width: 800px; height: 392px; padding: 20px; background: #ffffff; box-shadow: 0 22px 54px rgba(38, 61, 82, .14); border-radius: 6px; }",
    ".chart-raster canvas { width: 760px; height: 350px; display: block; border-radius: 4px; }",
    ".chart-label { position: absolute; padding: 8px 12px; color: #ffffff; font-size: 17px; font-weight: 700; border-radius: 4px; background: #172033; box-shadow: 0 8px 22px rgba(23, 32, 51, .22); }",
    ".label-a { left: 126px; top: 112px; }",
    ".label-b { right: 58px; top: 58px; background: #b45309; }",
    ".chart-legend { position: absolute; left: 42px; bottom: 18px; color: #41516a; font-size: 18px; font-weight: 700; }",
    ".chart-legend span { display: inline-block; width: 16px; height: 16px; margin-right: 9px; vertical-align: -2px; background: #14b8a6; border-radius: 50%; }",
    ".side-callout { position: absolute; right: 80px; top: 238px; width: 250px; padding: 28px 30px; color: #25354d; font-size: 24px; line-height: 1.44; background: #fff7ed; border-left: 8px solid #b45309; }",
    ".side-callout strong { font-size: 30px; color: #172033; }",
    ".timeline-line { position: absolute; left: 152px; top: 374px; width: 934px; height: 8px; background: linear-gradient(90deg, #2f6f8f, #0f766e, #b45309, #ef4444); }",
    ".timeline-item { position: absolute; top: 252px; width: 230px; min-height: 210px; padding: 24px; background: #ffffff; box-shadow: 0 18px 42px rgba(38, 61, 82, .1); }",
    ".timeline-item::after { content: ''; position: absolute; left: 28px; top: 116px; width: 26px; height: 26px; background: #ffffff; border: 8px solid #2f6f8f; border-radius: 50%; }",
    ".timeline-item.t1 { left: 104px; }",
    ".timeline-item.t2 { left: 374px; }",
    ".timeline-item.t3 { left: 644px; }",
    ".timeline-item.t4 { left: 914px; }",
    ".timeline-item.t2::after { border-color: #0f766e; }",
    ".timeline-item.t3::after { border-color: #b45309; }",
    ".timeline-item.t4::after { border-color: #ef4444; }",
    ".timeline-item span { display: block; color: #607086; font-size: 18px; font-weight: 800; }",
    ".timeline-item strong { display: block; margin-top: 8px; color: #172033; font-size: 30px; }",
    ".timeline-item em { display: block; margin-top: 56px; color: #41516a; font-size: 18px; line-height: 1.35; font-style: normal; }",
    ".summary-slide { background: linear-gradient(135deg, #172033 0%, #244458 48%, #0f766e 100%); color: #ffffff; }",
    ".summary-mark { position: absolute; right: 0; top: 0; width: 320px; height: 320px; border-radius: 50%; border: 72px solid rgba(255, 255, 255, .08); }",
    ".summary-title { position: absolute; left: 86px; top: 74px; margin: 0; color: #ffffff; font-size: 64px; line-height: 1; }",
    ".summary-grid { position: absolute; left: 86px; top: 190px; width: 1000px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }",
    ".summary-grid div { min-height: 210px; padding: 30px 28px; background: rgba(255, 255, 255, .12); border-top: 8px solid #f59e0b; }",
    ".summary-grid strong { display: block; color: #ffffff; font-size: 30px; }",
    ".summary-grid span { display: block; margin-top: 22px; color: #dbeafe; font-size: 22px; line-height: 1.42; }",
    ".summary-footer { position: absolute; left: 88px; bottom: 64px; width: 900px; margin: 0; color: #fff7ed; font-size: 25px; line-height: 1.36; }",
  ].join("\n");
}

function workbenchSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="620" viewBox="0 0 920 620">',
    '  <rect width="920" height="620" fill="#f8fbff"/>',
    '  <rect x="58" y="64" width="804" height="492" rx="18" fill="#172033"/>',
    '  <rect x="90" y="106" width="270" height="408" rx="12" fill="#244458"/>',
    '  <rect x="392" y="106" width="438" height="168" rx="12" fill="#ffffff"/>',
    '  <rect x="392" y="306" width="202" height="208" rx="12" fill="#ffffff"/>',
    '  <rect x="628" y="306" width="202" height="208" rx="12" fill="#ffffff"/>',
    '  <rect x="122" y="142" width="192" height="20" rx="10" fill="#dbeafe"/>',
    '  <rect x="122" y="192" width="156" height="16" rx="8" fill="#93c5fd"/>',
    '  <rect x="122" y="232" width="198" height="16" rx="8" fill="#93c5fd"/>',
    '  <rect x="122" y="272" width="172" height="16" rx="8" fill="#93c5fd"/>',
    '  <path d="M430 224 C492 142 548 238 610 178 S730 146 792 224" fill="none" stroke="#0f766e" stroke-width="18" stroke-linecap="round"/>',
    '  <circle cx="430" cy="224" r="14" fill="#0f766e"/>',
    '  <circle cx="610" cy="178" r="14" fill="#f59e0b"/>',
    '  <circle cx="792" cy="224" r="14" fill="#ef4444"/>',
    '  <rect x="430" y="348" width="124" height="126" rx="10" fill="#e0f2fe"/>',
    '  <rect x="468" y="388" width="48" height="86" rx="8" fill="#2f6f8f"/>',
    '  <rect x="666" y="348" width="124" height="126" rx="10" fill="#fff7ed"/>',
    '  <rect x="704" y="376" width="48" height="98" rx="8" fill="#b45309"/>',
    '</svg>',
  ].join("\n");
}

function patternGridSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">',
    '  <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#94a3b8" stroke-width="1"/></pattern></defs>',
    '  <rect width="640" height="640" fill="url(#grid)"/>',
    '  <circle cx="420" cy="180" r="120" fill="#0f766e" opacity=".18"/>',
    '  <circle cx="220" cy="420" r="150" fill="#b45309" opacity=".14"/>',
    '</svg>',
  ].join("\n");
}
