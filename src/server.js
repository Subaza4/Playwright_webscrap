import http from "http";
import { chromium } from "playwright";
import pLimit from "p-limit";

const PORT = 3000;
const limit = pLimit(2); // máximo 2 requests simultáneos

let browser;

// ------------------------------------------------
// Browser singleton
// ------------------------------------------------
async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }

  console.log("Launching Chromium...");

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-zygote",
    ],
  });

  browser.on("disconnected", () => {
    console.log("Chromium disconnected");
    browser = null;
  });

  return browser;
}

// ------------------------------------------------
// Helpers
// ------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
  });

  res.end(JSON.stringify(data));
}

function html(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8",
  });

  res.end(data);
}

// ------------------------------------------------
// Core scraper
// ------------------------------------------------
async function loadAndGetHtml(url) {
  const browser = await getBrowser();

  const context = await browser.newContext({
    viewport: {
      width: 1366,
      height: 768,
    },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    locale: "es-PE",
  });

  const page = await context.newPage();

  try {
    console.log(`Opening: ${url}`);

    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // pequeña espera para lazy render
    await sleep(1200);

    // Intentar abrir galería
    const galleryTriggers = [
      '[data-testid*="gallery"]',
      '[class*="photo-gallery"]',
      '[class*="gallery"]',
      '[role="button"]:has(img)',
      "button:has(img)",
      "a:has(img)",
    ];

    let clicked = false;

    for (const selector of galleryTriggers) {
      try {
        const locator = page.locator(selector).first();

        if ((await locator.count()) > 0) {
          await locator.click({
            timeout: 3000,
          });

          console.log(`Clicked gallery trigger: ${selector}`);
          clicked = true;

          await sleep(1500);
          break;
        }
      } catch {
        // seguir probando
      }
    }

    if (!clicked) {
      console.log("No gallery trigger found");
    }

    // esperar imágenes
    try {
      await page.waitForSelector("img", {
        timeout: 5000,
      });
    } catch {
      console.log("No img selector detected");
    }

    const galleryImages = await page.evaluate(() => {
      const selectors = [
        ".e0db172886 img",
        ".f6c12c77eb img",
        ".gallery img",
        "img",
      ];

      const excludePatterns = [
        "images-flags",
        "review/avatars",
        "ava-",
        "ava-r.png",
        "ava-l.png",
        "design-assets",
        "avatar",
        "flag",
        "icon",
        "logo",
      ];

      const shouldExclude = (src) => {
        if (!src) return true;

        const lower = src.toLowerCase();

        return excludePatterns.some((p) => lower.includes(p));
      };

      const seen = new Set();
      const images = [];

      for (const selector of selectors) {
        const nodes = document.querySelectorAll(selector);

        for (const img of nodes) {
          const src =
            img.currentSrc ||
            img.src ||
            img.getAttribute("src") ||
            img.getAttribute("data-src");

          if (!src) continue;
          if (seen.has(src)) continue;
          if (shouldExclude(src)) continue;

          seen.add(src);

          images.push({
            src,
            alt: img.alt || "",
            outerHTML: img.outerHTML,
          });
        }
      }

      return images;
    });

    console.log(`Images found: ${galleryImages.length}`);

    if (!galleryImages.length) {
      return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Sin resultados</title>
</head>
<body>
<h2>No se encontraron imágenes</h2>
</body>
</html>
`;
    }

    const imagesHtml = galleryImages
      .map((img) => img.outerHTML)
      .join("\n");

    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Galería</title>
<style>
body{
  font-family:Arial;
  padding:20px;
  margin:0;
  background:#f5f5f5;
}
.info{
  background:white;
  padding:20px;
  border-radius:10px;
  margin-bottom:20px;
  box-shadow:0 2px 8px rgba(0,0,0,.08);
}
.gallery{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(240px,1fr));
  gap:16px;
}
.gallery img{
  width:100%;
  border-radius:10px;
  display:block;
  background:white;
  box-shadow:0 2px 8px rgba(0,0,0,.08);
}
</style>
</head>
<body>
<div class="info">
  <h2>Imágenes extraídas</h2>
  <p>Total: ${galleryImages.length}</p>
</div>

<div class="gallery">
  ${imagesHtml}
</div>
</body>
</html>
`;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

// ------------------------------------------------
// HTTP server
// ------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    return json(res, 405, {
      error: "Only POST allowed",
    });
  }

  let body = "";

  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}");
      const url = payload.url;

      if (!url) {
        return json(res, 400, {
          error: "Missing url",
        });
      }

      const result = await limit(() => loadAndGetHtml(url));

      return html(res, 200, result);
    } catch (err) {
      console.error("Server error:", err);

      return json(res, 500, {
        error: "Render error",
        detail: err.message,
      });
    }
  });
});

// ------------------------------------------------
// Graceful shutdown
// ------------------------------------------------
async function shutdown(signal) {
  console.log(`Received ${signal}. Closing server...`);

  server.close(async () => {
    try {
      if (browser) {
        await browser.close();
      }
    } catch {}

    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(PORT, () => {
  console.log(`Playwright renderer running on :${PORT}`);
});
