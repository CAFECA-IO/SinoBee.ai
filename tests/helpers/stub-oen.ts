/**
 * A stand-in for the Oen Payment API (https://developer.oen.tw) for tests: POST /checkout, GET /transactions/:id,
 * GET /order/:orderId/transactions, POST /refunds/:hid with the documented response envelope and checks
 * (Bearer token, merchantId, productDetails sum = amount, one refund per transaction).
 */
import http from "node:http";
import { randomBytes } from "node:crypto";

export type StubTx = {
  id: string; // P…
  transactionId: string; // 27 chars
  amount: number;
  orderId: string;
  status: string;
  createdAt: string;
  paidAt?: string;
  refundAmount: number;
  refundedAt?: string;
  customId?: string;
  body: Record<string, unknown>;
};

export class StubOen {
  token = "test-token";
  merchant = "sinobee";
  txs = new Map<string, StubTx>();
  calls: string[] = [];
  /** card bindings: id → {customId, token?} */
  bindings = new Map<string, { customId?: string; token?: string; body: Record<string, unknown> }>();
  /** saved card tokens → how charges behave ("ok" or an error code such as T0004) */
  tokens = new Map<string, string>();
  /** Idempotency-Key → first response */
  idem = new Map<string, { status: number; j: object }>();
  server?: http.Server;
  url = "";

  async start() {
    this.server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const send = (status: number, j: object) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(j));
        };
        const ok = (data: unknown) => send(200, { code: "S0000", data, message: "" });
        const bad = (code: string, message: string, status = 400) => send(status, { code, message });
        this.calls.push(`${req.method} ${req.url}`);
        if (req.headers.authorization !== `Bearer ${this.token}`) return bad("A0001", "unauthorized", 401);
        const body = raw ? JSON.parse(raw) : {};
        if (req.method === "POST" && body.merchantId !== this.merchant) return bad("V0001", "merchantId mismatch");
        const u = new URL(req.url ?? "/", "http://x");
        let m: RegExpMatchArray | null;
        if (req.method === "POST" && u.pathname === "/checkout-token") {
          if (!("successUrl" in body) || !("failureUrl" in body)) return bad("V0001", "successUrl and failureUrl are required");
          const id = randomBytes(30).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 27);
          this.bindings.set(id, { customId: body.customId, body });
          return ok({ id });
        }
        if (req.method === "POST" && u.pathname === "/token/transactions") {
          const key = String(req.headers["idempotency-key"] ?? "");
          if (key && this.idem.has(key)) {
            const first = this.idem.get(key)!;
            return send(first.status, first.j);
          }
          const remember = (status: number, j: object) => {
            if (key) this.idem.set(key, { status, j });
            return send(status, j);
          };
          const sum = (body.productDetails ?? []).reduce((a: number, p: { quantity: number; unitPrice: number }) => a + p.quantity * p.unitPrice, 0);
          if (!Number.isInteger(body.amount) || body.amount < 1 || sum !== body.amount) return remember(400, { code: "V0001", message: "PRODUCT_AMOUNT_NOT_MATCH" });
          const behaviour = this.tokens.get(body.token);
          if (!behaviour) return remember(401, { code: "A0001", message: "token invalid" });
          const tx: StubTx = {
            id: "P" + randomBytes(8).toString("hex").toUpperCase(),
            transactionId: randomBytes(30).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 27),
            amount: body.amount, orderId: body.orderId, status: behaviour === "ok" ? "charged" : "failed", createdAt: new Date().toISOString(), refundAmount: 0, body,
            paidAt: behaviour === "ok" ? new Date().toISOString() : undefined,
          };
          this.txs.set(tx.transactionId, tx);
          if (behaviour !== "ok") return remember(400, { code: behaviour, message: "declined" });
          return remember(200, { code: "S0000", data: { id: tx.id, authCode: "123456" }, message: "" });
        }
        if (req.method === "POST" && u.pathname === "/checkout") {
          const sum = (body.productDetails ?? []).reduce((a: number, p: { quantity: number; unitPrice: number }) => a + p.quantity * p.unitPrice, 0);
          if (!Number.isInteger(body.amount) || body.amount < 1) return bad("V0001", "amount");
          if (sum !== body.amount) return bad("V0001", "PRODUCT_AMOUNT_NOT_MATCH");
          if (!body.userName || !body.userEmail) return bad("V0001", "USER_NAME_AND_EMAIL_REQUIRED");
          const tx: StubTx = {
            id: "P" + randomBytes(8).toString("hex").toUpperCase(),
            transactionId: randomBytes(30).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 27),
            amount: body.amount, orderId: body.orderId, status: "initiated", createdAt: new Date().toISOString(), refundAmount: 0, customId: body.customId, body,
          };
          this.txs.set(tx.transactionId, tx);
          return ok({ id: tx.transactionId, transactionHid: tx.id });
        }
        if (req.method === "GET" && (m = u.pathname.match(/^\/transactions\/([^/]+)$/))) {
          const tx = this.txs.get(m[1]) ?? [...this.txs.values()].find((t) => t.id === m![1]);
          if (!tx) return bad("V0001", "transaction not found");
          return ok(this.view(tx));
        }
        if (req.method === "GET" && (m = u.pathname.match(/^\/order\/([^/]+)\/transactions$/))) {
          return ok([...this.txs.values()].filter((t) => t.orderId === decodeURIComponent(m![1])).map((t) => this.view(t)));
        }
        if (req.method === "POST" && (m = u.pathname.match(/^\/refunds\/([^/]+)$/))) {
          const tx = [...this.txs.values()].find((t) => t.id === m![1]);
          if (!tx) return bad("V0001", "transaction not found");
          if (!["charged", "claimed"].includes(tx.status)) return bad("V0001", "cannot refund in this state");
          if (tx.refundAmount > 0) return bad("V0001", "already refunded");
          const amount = body.amount ?? tx.amount;
          if (amount > tx.amount) return bad("V0001", "amount too large");
          const sum = (body.productDetails ?? []).reduce((a: number, p: { quantity: number; unitPrice: number }) => a + p.quantity * p.unitPrice, 0);
          if (sum !== amount) return bad("V0001", "PRODUCT_AMOUNT_NOT_MATCH");
          tx.refundAmount = amount;
          tx.refundedAt = new Date().toISOString();
          tx.status = "refunded";
          return ok({ success: true, ...this.view(tx) });
        }
        res.statusCode = 404;
        res.end("Not Found");
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this;
  }

  stop() {
    this.server?.close();
  }

  view(t: StubTx) {
    return { id: t.id, transactionId: t.transactionId, action: "onetime", amount: t.amount, status: t.status, orderId: t.orderId, customId: t.customId, createdAt: t.createdAt, paidAt: t.paidAt, refundAmount: t.refundAmount, refundedAt: t.refundedAt };
  }

  /** what the customer does on the checkout page */
  pay(transactionId: string, status: "charged" | "failed" | "charging" = "charged") {
    const tx = this.txs.get(transactionId)!;
    tx.status = status;
    if (status === "charged") tx.paidAt = new Date().toISOString();
    return tx;
  }

  /** the customer completes (or abandons) the card binding page; returns the token notification body */
  bindCard(bindingId: string, ok = true, behaviour = "ok") {
    const b = this.bindings.get(bindingId)!;
    const token = ok ? randomBytes(20).toString("hex") : undefined;
    if (token) {
      b.token = token;
      this.tokens.set(token, behaviour);
    }
    return { purpose: "token", merchantId: this.merchant, id: bindingId, transactionId: bindingId, success: ok, token, paymentInfo: ok ? "4242" : undefined, customId: b.customId, message: ok ? "" : "3DS_ABANDONED" };
  }

  /** the webhook body Oen would POST */
  webhook(tx: StubTx) {
    return { purpose: "charge", action: "onetime", merchantId: this.merchant, orderId: tx.orderId, id: tx.transactionId, transactionId: tx.transactionId, transactionHid: tx.id, status: tx.status, success: tx.status !== "failed", amount: tx.amount, currency: "twd" };
  }
}
