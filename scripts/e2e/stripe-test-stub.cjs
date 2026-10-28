/**
 * LOCAL e2e only: a stand-in for the payment provider's TEST API on 127.0.0.1 (never the network, no account, no
 * money). The app reaches it through CLINIC_PAYMENTS_PROVIDER=stripe_test, a made-up key of the test form
 * (sk_test_…) and CLINIC_STRIPE_TEST_API_BASE=http://127.0.0.1:<port>/v1 – the provider accepts only Stripe's own
 * host or a loopback address there (src/server/pms/billing/payments/stripe-test.ts).
 *
 *   node scripts/e2e/stripe-test-stub.cjs 3199
 *
 * Endpoints the provider uses: prices, payment_links (+ deactivate), checkout/sessions (list by link, get one),
 * customers, payment_methods/pm_card_visa/attach, payment_intents (confirm a saved card), refunds. Control:
 * POST /__pay?link=<payment link id> marks the link paid (the "patient pays"), GET /__state for checks.
 * Every answer has livemode:false. A request without a Bearer sk_test_ key is refused.
 */
const http = require("http");

const PORT = Number(process.argv[2] || process.env.STUB_PORT || 3199);
let n = 0;
const id = (p) => `${p}_test_${(++n).toString().padStart(6, "0")}`;
const state = { prices: new Map(), links: new Map(), sessions: [], customers: new Map(), intents: new Map(), refunds: [] };

function form(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}
function send(res, status, json) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ livemode: false, ...json }));
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const p = url.pathname;
    if (p === "/__state") return send(res, 200, { links: state.links.size, sessions: state.sessions.length, intents: state.intents.size, refunds: state.refunds.length });
    if (p === "/__pay" && req.method === "POST") {
      const link = state.links.get(url.searchParams.get("link") || "");
      if (!link) return send(res, 404, { error: { message: "no such link" } });
      const price = state.prices.get(link.price);
      const s = { id: id("cs"), payment_link: link.id, payment_status: "paid", status: "complete", amount_total: price.unit_amount, created: Math.floor(Date.now() / 1000), payment_intent: id("pi") };
      state.sessions.push(s);
      return send(res, 200, s);
    }
    if (!/^Bearer (sk|rk)_test_/.test(req.headers.authorization || "")) return send(res, 401, { error: { message: "test key required" } });
    const f = form(body);
    if (p === "/v1/prices" && req.method === "POST") {
      const price = { id: id("price"), unit_amount: Number(f.unit_amount), currency: f.currency };
      state.prices.set(price.id, price);
      return send(res, 200, price);
    }
    if (p === "/v1/payment_links" && req.method === "POST") {
      const link = { id: id("plink"), price: f["line_items[0][price]"], active: true };
      link.url = `https://pay.example.com/${link.id}`;
      state.links.set(link.id, link);
      return send(res, 200, link);
    }
    let m = /^\/v1\/payment_links\/([^/]+)$/.exec(p);
    if (m && req.method === "POST") {
      const link = state.links.get(decodeURIComponent(m[1]));
      if (link) link.active = f.active !== "false";
      return send(res, 200, link || {});
    }
    if (p === "/v1/checkout/sessions" && req.method === "GET") {
      const link = url.searchParams.get("payment_link");
      return send(res, 200, { data: state.sessions.filter((s) => s.payment_link === link) });
    }
    m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(p);
    if (m && req.method === "GET") {
      const s = state.sessions.find((x) => x.id === decodeURIComponent(m[1]));
      return s ? send(res, 200, s) : send(res, 404, { error: { message: "no such session" } });
    }
    if (p === "/v1/customers" && req.method === "POST") {
      const c = { id: id("cus") };
      state.customers.set(c.id, c);
      return send(res, 200, c);
    }
    if (p === "/v1/payment_methods/pm_card_visa/attach" && req.method === "POST") {
      return send(res, 200, { id: id("pm"), customer: f.customer, card: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2028 } });
    }
    if (p === "/v1/payment_intents" && req.method === "POST") {
      const pi = { id: id("pi"), amount: Number(f.amount), status: "succeeded", customer: f.customer, payment_method: f.payment_method };
      state.intents.set(pi.id, pi);
      return send(res, 200, pi);
    }
    if (p === "/v1/refunds" && req.method === "POST") {
      const r = { id: id("re"), payment_intent: f.payment_intent, amount: Number(f.amount), status: "succeeded" };
      state.refunds.push(r);
      return send(res, 200, r);
    }
    return send(res, 404, { error: { message: `not in the stub: ${req.method} ${p}` } });
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`payment provider TEST stub on http://127.0.0.1:${PORT}/v1`));
