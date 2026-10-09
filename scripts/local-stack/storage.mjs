// Минимальная эмуляция Supabase Storage API для локального стека.
// Поддерживает ровно то, что использует Orle (всё — от имени service_role):
//   POST|PUT /object/:bucket/:path         загрузка
//   GET      /object/:bucket/:path         скачивание (service_role)
//   POST     /object/sign/:bucket/:path    подписанная ссылка { expiresIn }
//   POST     /object/sign/:bucket          пакет подписанных ссылок { expiresIn, paths }
//   GET      /object/sign/:bucket/:path?token=…  отдача по подписи
//   DELETE   /object/:bucket               { prefixes: [...] }
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const DIR = path.resolve(process.env.STORAGE_DIR ?? ".local-stack/storage");
const SECRET = process.env.JWT_SECRET ?? "local-dev-jwt-secret-at-least-32-characters";
const PORT = Number(process.env.STORAGE_PORT ?? 5001);

const b64 = (s) => Buffer.from(s).toString("base64url");
const hmac = (s) => createHmac("sha256", SECRET).update(s).digest("base64url");

function verifyJwt(token) {
  const [h, p, sig] = (token ?? "").split(".");
  if (!h || !p || !sig) return null;
  const expected = Buffer.from(hmac(`${h}.${p}`));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

function signUrl(bucket, key, expiresIn) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ url: `${bucket}/${key}`, exp: Math.floor(Date.now() / 1000) + Number(expiresIn ?? 60) }));
  return `/object/sign/${bucket}/${key}?token=${head}.${body}.${hmac(`${head}.${body}`)}`;
}

function safePath(bucket, key) {
  const full = path.resolve(DIR, bucket, key);
  if (!full.startsWith(path.resolve(DIR, bucket) + path.sep)) throw new Error("bad path");
  return full;
}

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== "object") return json(res, 404, { error: "not found" });

      // Публичная отдача по подписи — без service_role.
      if (parts[1] === "sign" && req.method === "GET") {
        const [, , bucket, ...rest] = parts;
        const key = rest.join("/");
        const payload = verifyJwt(url.searchParams.get("token"));
        if (!payload || payload.url !== `${bucket}/${key}`) return json(res, 400, { error: "invalid signature" });
        const file = safePath(bucket, key);
        if (!fs.existsSync(file)) return json(res, 404, { error: "not found" });
        const meta = fs.existsSync(`${file}.meta`) ? JSON.parse(fs.readFileSync(`${file}.meta`, "utf8")) : {};
        res.writeHead(200, { "content-type": meta.contentType ?? "application/octet-stream", "cache-control": "private, max-age=300" });
        return fs.createReadStream(file).pipe(res);
      }

      const role = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /, ""))?.role;
      if (role !== "service_role") return json(res, 403, { error: "only service_role in local storage" });

      if (parts[1] === "sign" && req.method === "POST") {
        const [, , bucket, ...rest] = parts;
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        if (rest.length === 0) {
          return json(
            res,
            200,
            (body.paths ?? []).map((p) => ({ path: p, signedURL: signUrl(bucket, p, body.expiresIn), error: null })),
          );
        }
        return json(res, 200, { signedURL: signUrl(bucket, rest.join("/"), body.expiresIn) });
      }

      const [, bucket, ...rest] = parts;
      const key = rest.join("/");
      if (req.method === "POST" || req.method === "PUT") {
        const file = safePath(bucket, key);
        if (fs.existsSync(file) && req.headers["x-upsert"] !== "true") return json(res, 409, { error: "Duplicate", statusCode: "409" });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, await readBody(req));
        fs.writeFileSync(`${file}.meta`, JSON.stringify({ contentType: req.headers["content-type"] }));
        return json(res, 200, { Key: `${bucket}/${key}`, Id: key });
      }
      if (req.method === "GET") {
        const file = safePath(bucket, key);
        if (!fs.existsSync(file)) return json(res, 404, { error: "not found" });
        return fs.createReadStream(file).pipe(res);
      }
      if (req.method === "DELETE") {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        for (const p of body.prefixes ?? []) fs.rmSync(safePath(bucket, p), { force: true });
        return json(res, 200, (body.prefixes ?? []).map((name) => ({ name })));
      }
      json(res, 405, { error: "method not allowed" });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
  })
  .listen(PORT, () => console.log(`storage on :${PORT}`));
