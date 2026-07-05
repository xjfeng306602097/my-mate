import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const targetUrl =
  "https://www.bilibili.com/video/BV1p67D6fE6n/?spm_id_from=333.1387.homepage.video_card.click&vd_source=f507293fe551d75275e56c7d23c97c3d";

const outputDir = path.resolve("tmp", "bilibili-inspect");

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  locale: "zh-CN",
});

const page = await context.newPage();

try {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(5000);

  const title = await page.title();
  const html = await page.content();
  await fs.writeFile(path.join(outputDir, "page.html"), html, "utf8");
  await page.screenshot({ path: path.join(outputDir, "page.png"), fullPage: true });

  const text = await page.evaluate(() => {
    return {
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 4000) || "",
    };
  });

  console.log(JSON.stringify({ title, ...text, outputDir }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
