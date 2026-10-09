// Мини-шлюз вместо Kong: один URL для supabase-js.
//   /auth/v1/*    → GoTrue
//   /rest/v1/*    → PostgREST
//   /storage/v1/* → локальное хранилище (storage.mjs)
import http from "node:http";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  { prefix: "/auth/v1", port: Number(process.env.AUTH_PORT ?? 9999) },
  { prefix: "/rest/v1", port: Number(process.env.REST_PORT ?? 3001) },
  { prefix: "/storage/v1", port: Number(process.env.STORAGE_PORT ?? 5001) },
];

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-upsert, cache-control",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range, content-location",
};

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") {
      // Локально разрешаем любые заголовки, которые запросил браузер.
      res.writeHead(204, { ...cors, "access-control-allow-headers": req.headers["access-control-request-headers"] ?? cors["access-control-allow-headers"] });
      return res.end();
    }
    const route = routes.find((r) => req.url?.startsWith(r.prefix));
    if (!route) {
      res.writeHead(404, cors);
      return res.end("not found");
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: route.port,
        method: req.method,
        path: req.url.slice(route.prefix.length) || "/",
        headers: { ...req.headers, host: `127.0.0.1:${route.port}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors });
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502, cors);
      res.end(String(e));
    });
    req.pipe(upstream);
  })
  .listen(PORT, () => console.log(`gateway on :${PORT}`));
