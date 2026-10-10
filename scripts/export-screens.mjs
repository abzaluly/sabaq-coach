// Снимает экраны работающего Orle (после pnpm seed:demo и pnpm start) в один офлайн-HTML:
//   node scripts/export-screens.mjs demo/orle-screens.html
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = process.argv[2];
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
const page = await ctx.newPage();

const cache = new Map();
async function dataUri(url) {
  if (cache.has(url)) return cache.get(url);
  const res = await ctx.request.get(url);
  if (!res.ok()) return url;
  const type = res.headers()["content-type"]?.split(";")[0] ?? "application/octet-stream";
  const uri = `data:${type};base64,${(await res.body()).toString("base64")}`;
  cache.set(url, uri);
  return uri;
}

let css = null;
async function collectCss() {
  const hrefs = await page.$$eval('link[rel="stylesheet"]', (ls) => ls.map((l) => l.href));
  let all = "";
  for (const href of hrefs) {
    let text = await (await ctx.request.get(href)).text();
    for (const m of [...text.matchAll(/url\((\/_next\/static\/media\/[^)]+)\)/g)]) {
      text = text.replaceAll(m[0], `url(${await dataUri(BASE + m[1])})`);
    }
    all += text + "\n";
  }
  return all;
}

const screens = [];
async function snap(key, title, url, prepare) {
  await page.goto(BASE + url);
  await page.waitForLoadState("networkidle");
  if (prepare) await prepare();
  if (!css) css = await collectCss();
  // Картинки → data URI, ссылки → переключение экранов, скрипты убираем.
  const imgs = await page.$$eval("img", (els) => els.map((e) => e.currentSrc || e.src));
  const imgMap = {};
  for (const src of imgs) if (src && !src.startsWith("data:")) imgMap[src] = await dataUri(src);
  const body = await page.evaluate((imgMap) => {
    const doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll("script, link, noscript, next-route-announcer").forEach((n) => n.remove());
    doc.querySelectorAll("img").forEach((img) => {
      const real = imgMap[img.src];
      if (real) img.setAttribute("src", real);
      img.removeAttribute("srcset");
      img.removeAttribute("loading");
    });
    doc.querySelectorAll("a[href]").forEach((a) => {
      a.setAttribute("data-path", new URL(a.href).pathname + new URL(a.href).search);
      a.setAttribute("href", "#");
    });
    doc.querySelectorAll("form").forEach((f) => f.setAttribute("onsubmit", "return false"));
    return doc.querySelector("body").innerHTML;
  }, imgMap);
  screens.push({ key, title, path: new URL(page.url()).pathname, body });
  console.log("✓", key);
}

// Гость: вход.
await snap("login", "Вход", "/login");
await snap("login-code", "Код из письма", "/login", async () => {
  await page.getByLabel("Email").fill("aliya@demo.orle");
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Код из письма").waitFor();
});

// Входим как Алия.
const code = (await (await fetch("http://127.0.0.1:54324/latest?to=aliya@demo.orle")).json()).code;
await page.getByLabel("Код из письма").fill(code);
await page.getByRole("button", { name: "Войти" }).click();
await page.waitForURL((u) => u.pathname === "/");

await snap("home", "Главная", "/");
const groupHref = await page.locator('a[href^="/g/"]').last().getAttribute("href");
const g = groupHref.split("/")[2];
await snap("arena", "Арена", `/g/${g}`);
await snap("feed", "Лента", `/g/${g}/feed`);
await snap("habits", "Мои привычки", `/g/${g}/habits`);
await snap("habit-new", "Новая привычка", `/g/${g}/habits/new`, async () => {
  await page.getByText("Раз в неделю").click();
});
await snap("votes", "Голосования", `/g/${g}/votes`);
await snap("leaderboard", "Лидерборд", `/g/${g}/leaderboard`);
await snap("leaderboard-all", "Лидерборд · всё время", `/g/${g}/leaderboard?scope=all`);
const members = await page.$$eval('a[href*="/u/"]', (as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent })));
const aliya = members.find((m) => m.text.includes("Алия"));
const timur = members.find((m) => m.text.includes("Тимур"));
await snap("profile", "Профиль: Алия", aliya.href);
await snap("profile-timur", "Профиль: Тимур (читер)", timur.href);
await snap("moderation", "Модерация", `/g/${g}/moderation`);
await snap("group-settings", "Настройки группы", `/g/${g}/settings`);
await snap("settings", "Настройки и уведомления", "/settings");

await browser.close();

// Карта путей → экран, чтобы ссылки внутри снимков переключали экраны.
const pathMap = Object.fromEntries(screens.filter((s) => !s.key.startsWith("login")).map((s) => [s.path, s.key]));
pathMap[aliya.href] = "profile";
pathMap[timur.href] = "profile-timur";
pathMap[`/g/${g}/leaderboard?scope=all`] = "leaderboard-all";
pathMap[`/g/${g}/leaderboard?scope=season`] = "leaderboard";

const frameDoc = (s) =>
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="min-h-dvh font-sans antialiased">${s.body}<script>
document.addEventListener("click",function(e){var a=e.target.closest("a[data-path]");if(a){e.preventDefault();parent.postMessage({orle:a.getAttribute("data-path")},"*");}var b=e.target.closest("button");if(b&&!a){e.preventDefault();}},true);
window.addEventListener("message",function(e){if(e.data&&"dark" in e.data)document.documentElement.classList.toggle("dark",e.data.dark);});
</script></body></html>`;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orle — готовые экраны</title>
<style>
  :root { --bg:#f6efe7; --fg:#2b2118; --muted:#7a6a5b; --card:#fff; --line:#e6dbcf; --accent:#c2410c; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#1d1611; --fg:#f2e9df; --muted:#b3a291; --card:#2a211a; --line:#3d3128; --accent:#fb923c; } }
  :root[data-theme="dark"] { --bg:#1d1611; --fg:#f2e9df; --muted:#b3a291; --card:#2a211a; --line:#3d3128; --accent:#fb923c; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: ui-sans-serif, system-ui, sans-serif; }
  header { padding:16px; max-width:1100px; margin:0 auto; display:flex; flex-wrap:wrap; align-items:center; gap:12px; justify-content:space-between; }
  h1 { margin:0; font-size:22px; }
  header p { margin:2px 0 0; color:var(--muted); font-size:14px; }
  .wrap { max-width:1100px; margin:0 auto; padding:0 16px 32px; display:grid; grid-template-columns: 260px 1fr; gap:24px; align-items:start; }
  nav { display:flex; flex-direction:column; gap:4px; position:sticky; top:12px; }
  nav button { text-align:left; border:1px solid transparent; background:transparent; color:var(--fg); padding:10px 12px; border-radius:12px; font-size:15px; cursor:pointer; min-height:44px; }
  nav button:hover { background:var(--card); }
  nav button[aria-current="true"] { background:var(--card); border-color:var(--line); font-weight:700; }
  .stage { display:flex; justify-content:center; }
  .phone { width:390px; max-width:100%; height:844px; max-height:calc(100dvh - 120px); min-height:560px; border-radius:36px; border:10px solid #1b140f; overflow:hidden; background:#fff; box-shadow:0 20px 60px rgba(0,0,0,.25); }
  iframe { width:100%; height:100%; border:0; display:block; }
  .toggle { border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:999px; padding:10px 16px; font-size:14px; cursor:pointer; min-height:44px; }
  .note { color:var(--muted); font-size:13px; margin-top:12px; line-height:1.4; }
  @media (max-width: 760px) {
    .wrap { grid-template-columns: 1fr; }
    nav { position:static; flex-direction:row; overflow-x:auto; padding-bottom:4px; }
    nav button { white-space:nowrap; }
    .phone { border-width:6px; border-radius:24px; height:calc(100dvh - 190px); }
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>Orle — готовые экраны</h1>
    <p>Снимки работающего приложения на демо-данных (группа из 4 человек, 3 недели истории). Ссылки внутри экранов переключают экраны.</p>
  </div>
  <button class="toggle" id="theme" type="button">Тёмная тема приложения</button>
</header>
<div class="wrap">
  <nav id="nav" aria-label="Экраны"></nav>
  <div>
    <div class="stage"><div class="phone"><iframe id="frame" title="Экран приложения"></iframe></div></div>
    <p class="note">Это статичные снимки: кнопки не отправляют данные, отметки и голоса работают только в запущенном приложении (Next.js + Supabase).</p>
  </div>
</div>
<script>
const SCREENS = ${JSON.stringify(screens.map((s) => ({ key: s.key, title: s.title, doc: frameDoc(s) }))).replaceAll("</", "<\\/")};
const PATHS = ${JSON.stringify(pathMap)};
const nav = document.getElementById("nav");
const frame = document.getElementById("frame");
let dark = false;
function show(key) {
  const s = SCREENS.find((x) => x.key === key) || SCREENS[0];
  frame.srcdoc = s.doc;
  frame.onload = () => frame.contentWindow.postMessage({ dark }, "*");
  nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.key === s.key)));
  try { history.replaceState(null, "", "#" + s.key); } catch (e) {}
}
SCREENS.forEach((s) => {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = s.title; b.dataset.key = s.key;
  b.onclick = () => show(s.key);
  nav.appendChild(b);
});
window.addEventListener("message", (e) => {
  if (e.data && e.data.orle) { const k = PATHS[e.data.orle] || PATHS[e.data.orle.split("?")[0]]; if (k) show(k); }
});
document.getElementById("theme").onclick = (e) => {
  dark = !dark;
  e.target.textContent = dark ? "Светлая тема приложения" : "Тёмная тема приложения";
  frame.contentWindow.postMessage({ dark }, "*");
};
show(location.hash.slice(1) || "home");
</script>
</body>
</html>`;

writeFileSync(OUT, html);
console.log("written", OUT, (html.length / 1024 / 1024).toFixed(2), "MB");
