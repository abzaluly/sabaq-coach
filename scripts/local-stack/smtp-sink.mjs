// SMTP-ловушка: принимает письма GoTrue и складывает их в JSON-файлы.
// Последнее письмо для адреса: GET http://localhost:54324/latest?to=<email>
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const DIR = process.env.MAIL_DIR ?? ".local-stack/mail";
fs.mkdirSync(DIR, { recursive: true });

net
  .createServer((socket) => {
    let mode = "cmd";
    let data = "";
    let to = [];
    let buf = "";
    const send = (s) => socket.write(`${s}\r\n`);
    send("220 orle-sink ESMTP");
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      while (true) {
        if (mode === "data") {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return;
          data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          for (const rcpt of to) {
            const file = path.join(DIR, `${Date.now()}-${rcpt.replace(/[^a-z0-9@._-]/gi, "_")}.json`);
            fs.writeFileSync(file, JSON.stringify({ to: rcpt, raw: data }));
          }
          mode = "cmd";
          to = [];
          send("250 OK");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") send("250 orle-sink");
        else if (cmd === "MAIL") send("250 OK");
        else if (cmd === "RCPT") {
          to.push(line.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? "unknown");
          send("250 OK");
        } else if (cmd === "DATA") {
          mode = "data";
          send("354 End with <CRLF>.<CRLF>");
        } else if (cmd === "QUIT") {
          send("221 Bye");
          socket.end();
        } else send("250 OK");
      }
    });
  })
  .listen(Number(process.env.SMTP_PORT ?? 2500), () => console.log("smtp sink on :2500"));

/** Достаёт 6-значный код из письма (quoted-printable/HTML не мешают — ищем в тексте). */
function extractCode(raw) {
  const decoded = raw.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return decoded.match(/>\s*(\d{6})\s*</)?.[1] ?? decoded.match(/\b(\d{6})\b/)?.[1] ?? null;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    // GoTrue загружает шаблоны писем по HTTP.
    if (url.pathname.startsWith("/templates/")) {
      const name = path.basename(url.pathname);
      const file = path.resolve(process.env.TEMPLATES_DIR ?? "supabase/templates", name);
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return fs.createReadStream(file).pipe(res);
    }
    const to = url.searchParams.get("to")?.toLowerCase();
    const files = fs
      .readdirSync(DIR)
      .filter((f) => !to || f.includes(to.replace(/[^a-z0-9@._-]/gi, "_")))
      .sort();
    const last = files.at(-1);
    if (!last) {
      res.writeHead(404);
      return res.end("{}");
    }
    const mail = JSON.parse(fs.readFileSync(path.join(DIR, last), "utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...mail, code: extractCode(mail.raw) }));
  })
  .listen(Number(process.env.MAIL_HTTP_PORT ?? 54324), () => console.log("mail viewer on :54324"));
