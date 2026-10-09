// Подписывает HS256 JWT для anon / service_role ключей локального стека.
import { createHmac } from "node:crypto";

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

export function sign(payload, secret) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function keys(secret) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 10 * 365 * 24 * 3600;
  return {
    anon: sign({ iss: "supabase-local", role: "anon", iat, exp }, secret),
    service: sign({ iss: "supabase-local", role: "service_role", iat, exp }, secret),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const k = keys(process.argv[2]);
  console.log(`ANON_KEY=${k.anon}\nSERVICE_KEY=${k.service}`);
}
