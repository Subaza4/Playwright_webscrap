import { serve } from "bun";
import { chromium, Browser } from "playwright";

const ALLOWED_ORIGINS = new Set([
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://127.0.0.1",
  "http://127.0.0.1:8080"
]);

let browser: Browser;


async function initBrowser() {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });

  console.log("✅ Playwright browser iniciado");
}

await initBrowser();

serve({
  port: 3000,
  hostname: "0.0.0.0",

  async fetch(req) {
    const origin = req.headers.get("origin");

    // ----- CORS PRE-FLIGHT -----
    if (req.method === "OPTIONS") {
      //if (origin && ALLOWED_ORIGINS.has(origin)) {
      if (origin) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Credentials": "true"
          }
        });
      }
      return new Response("CORS blocked", { status: 403 });
    }

    // ----- VALIDACIÓN CORS -----
    //if (origin && !ALLOWED_ORIGINS.has(origin)) {
    if (origin) {
      return new Response("CORS blocked", { status: 403 });
    }

    // ----- ÚNICO ENDPOINT -----
    if (req.method !== "POST" || new URL(req.url).pathname !== "/fetch-html") {
      return new Response("Not Found", { status: 404 });
    }

    let body: { url?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!body.url) {
      return new Response("Missing url", { status: 400 });
    }

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();

    try {
      await page.goto(body.url, { waitUntil: "networkidle", timeout: 60000 });
      const html = await page.content();

      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...(origin ? { "Access-Control-Allow-Origin": origin } : {})
        }
      });

    } catch (err) {
      console.error(err);
      return new Response("Failed to fetch page", { status: 500 });

    } finally {
      await context.close();
    }
  }
});
