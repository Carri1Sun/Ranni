import {
  closeBrowser,
  collectSlideDiagnostics,
  launchHtmlPptxBrowser,
  openSlideHtml,
  readJsonFromStdin,
  SLIDE_HEIGHT_PX,
  SLIDE_WIDTH_PX,
  writeJsonResult,
} from "./lib.mjs";

try {
  const { expectedSlideId, htmlAbsolutePath, screenshotAbsolutePath } =
    await readJsonFromStdin();
  const { browser, browserContext } = await launchHtmlPptxBrowser();

  try {
    const page = await openSlideHtml(browserContext, htmlAbsolutePath);

    try {
      const result = await collectSlideDiagnostics(page, ".slide", {
        expectedHeight: SLIDE_HEIGHT_PX,
        expectedSlideId,
        expectedWidth: SLIDE_WIDTH_PX,
        requireOrigin: true,
      });

      if (screenshotAbsolutePath) {
        await page.locator(".slide").first().screenshot({
          path: screenshotAbsolutePath,
        });
        result.screenshotPath = screenshotAbsolutePath;
      }

      writeJsonResult(result);
    } finally {
      await page.close();
    }
  } finally {
    await closeBrowser(browser, browserContext);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
