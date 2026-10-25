/** isCrossSiteRequest (25/10/2026): the platform usage CSV answers a cross-site request like an unknown page. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isCrossSiteRequest } from "./fetch-site";

test("only same-origin and typed / bookmarked requests are ours; another site's navigation or fetch is cross-site", () => {
  const h = (site?: string) => new Headers(site === undefined ? {} : { "sec-fetch-site": site });
  assert.equal(isCrossSiteRequest(h("same-origin")), false);
  assert.equal(isCrossSiteRequest(h("none")), false);
  assert.equal(isCrossSiteRequest(h(" Same-Origin ")), false);
  assert.equal(isCrossSiteRequest(h()), false, "no header (older browser, script): still the administrator's own request");
  assert.equal(isCrossSiteRequest(h("cross-site")), true);
  assert.equal(isCrossSiteRequest(h("same-site")), true, "another site under the same domain is not this app");
});
