import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { verifyWebhook } = await import("@/lib/sms");

const raw = Buffer.from("super-secret-key-material-32bytes!").toString("base64");
const secret = `v1,whsec_${raw}`;

function sign(body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", Buffer.from(raw, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return new Headers({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` });
}

describe("подпись SMS-хука (Standard Webhooks)", () => {
  const body = JSON.stringify({ user: { phone: "77001234567" }, sms: { otp: "123456" } });

  it("принимает корректную подпись", () => {
    expect(verifyWebhook(secret, sign(body), body)).toBe(true);
  });
  it("отклоняет подмену тела", () => {
    expect(verifyWebhook(secret, sign(body), body.replace("123456", "000000"))).toBe(false);
  });
  it("отклоняет старый запрос (replay)", () => {
    expect(verifyWebhook(secret, sign(body, "msg_1", Math.floor(Date.now() / 1000) - 3600), body)).toBe(false);
  });
  it("отклоняет запрос без подписи", () => {
    expect(verifyWebhook(secret, new Headers(), body)).toBe(false);
  });
});
