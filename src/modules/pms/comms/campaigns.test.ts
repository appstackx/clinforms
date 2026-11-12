/** Bulk email's pure rules: the switch, inputs, merge fields, no free HTML, the footer and headers, the age maths. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CampaignInputSchema, audienceBounds, bulkEmailSwitchOn, campaignHtml, campaignTextProblem, normaliseAudience, parseAudienceJson, renderCampaign, renderCampaignText } from "./campaigns";

describe("bulk email – the platform switch", () => {
  it("is on only for CLINFORMS_BULK_EMAIL=on", () => {
    assert.equal(bulkEmailSwitchOn({}), false);
    assert.equal(bulkEmailSwitchOn({ CLINFORMS_BULK_EMAIL: "" }), false);
    assert.equal(bulkEmailSwitchOn({ CLINFORMS_BULK_EMAIL: "1" }), false);
    assert.equal(bulkEmailSwitchOn({ CLINFORMS_BULK_EMAIL: "true" }), false);
    assert.equal(bulkEmailSwitchOn({ CLINFORMS_BULK_EMAIL: "off" }), false);
    assert.equal(bulkEmailSwitchOn({ CLINFORMS_BULK_EMAIL: "on" }), true);
    assert.equal(bulkEmailSwitchOn({ CLINFORMS_BULK_EMAIL: " ON " }), true);
  });
});

describe("bulk email – inputs", () => {
  const base = {
    name: "Spring newsletter",
    subject: "News from {clinic_name}",
    body: "Hello {first_name}",
    purpose: "marketing" as const,
  };
  it("accepts a marketing email without a reason", () => {
    assert.equal(CampaignInputSchema.safeParse(base).success, true);
  });
  it("a service announcement needs its reason", () => {
    const r = CampaignInputSchema.safeParse({ ...base, purpose: "service" });
    assert.equal(r.success, false);
    assert.deepEqual(r.success ? null : r.error.issues[0].path, ["serviceReason"]);
    assert.equal(
      CampaignInputSchema.safeParse({
        ...base,
        purpose: "service",
        serviceReason: "  ",
      }).success,
      false,
    );
    assert.equal(
      CampaignInputSchema.safeParse({
        ...base,
        purpose: "service",
        serviceReason: "Wolverton closes on 24/12",
      }).success,
      true,
    );
  });
  it("refuses free HTML, unknown merge fields and double braces", () => {
    for (const body of ["<b>Hi</b>", "Hi <script>alert(1)</script>", "Hi &amp; bye", "click javascript:alert(1)", "<a href='x'>x</a>"]) {
      assert.match(campaignTextProblem(body) ?? "", /HTML is not allowed/, body);
      assert.equal(CampaignInputSchema.safeParse({ ...base, body }).success, false, body);
    }
    assert.match(campaignTextProblem("Hi {surname}") ?? "", /Unknown merge field \{surname\}/);
    assert.match(campaignTextProblem("Hi {{first_name}}") ?? "", /single braces/);
    assert.equal(campaignTextProblem("Hi {first_name}, call {clinic_phone} – 2 < 3 is fine"), null);
    assert.equal(CampaignInputSchema.safeParse({ ...base, subject: "Hi {nope}" }).success, false);
  });
  it("audience: ages in order, unknown keys refused, stored JSON read back safely", () => {
    assert.equal(
      CampaignInputSchema.safeParse({
        ...base,
        audience: { minAge: 40, maxAge: 30 },
      }).success,
      false,
    );
    assert.equal(CampaignInputSchema.safeParse({ ...base, audience: { sql: "1=1" } }).success, false);
    assert.equal(
      CampaignInputSchema.safeParse({
        ...base,
        audience: { lastSeenMonths: 0 },
      }).success,
      false,
    );
    assert.deepEqual(normaliseAudience({ lastSeenMonths: 6 }), {
      siteId: null,
      lastSeenMonths: 6,
      upcoming: "any",
      minAge: null,
      maxAge: null,
    });
    assert.deepEqual(parseAudienceJson("not json"), normaliseAudience({}));
    assert.deepEqual(parseAudienceJson('{"upcoming":"maybe"}'), normaliseAudience({}));
  });
});

describe("bulk email – merge fields and the finished email", () => {
  it("fills the fields; a missing first name reads 'there'", () => {
    assert.equal(
      renderCampaignText("Hello {first_name} from {clinic_name}", {
        first_name: "Megan",
        clinic_name: "Riverside (fictional)",
      }),
      "Hello Megan from Riverside (fictional)",
    );
    assert.equal(renderCampaignText("Hello {first_name}", {}), "Hello there");
    assert.equal(renderCampaignText("Visit {clinic_address}", {}), "Visit ");
  });
  it("HTML: escaped, paragraphs, lists, https links only", () => {
    const html = campaignHtml("Riverside & Co (fictional)", "Hello <Meg>\n\n- one\n- two\n\nSee https://example.com/a and http://example.com/b", ["Footer"]);
    assert.match(html, /Riverside &amp; Co/);
    assert.match(html, /Hello &lt;Meg&gt;/);
    assert.match(html, /<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(html, /<a href="https:\/\/example.com\/a">/);
    assert.doesNotMatch(html, /<a href="http:\/\/example.com\/b">/);
  });
  it("every email: the clinic's name and postal address, why, the unsubscribe link and the RFC 8058 headers", () => {
    const stop = "https://clinic.example.com/api/clinic-messages/unsubscribe?t=abc";
    const r = renderCampaign({
      subject: "News from {clinic_name}",
      body: "Hello {first_name}",
      values: {
        first_name: "Megan",
        clinic_name: "Riverside Physiotherapy (fictional)",
      },
      clinicName: "Riverside Physiotherapy (fictional)",
      postalAddress: "2 Station Parade (fictional), Bletchley, MK2 9ZZ",
      phone: "01632 960100",
      purpose: "marketing",
      stopUrl: stop,
    });
    assert.equal(r.subject, "News from Riverside Physiotherapy (fictional)");
    assert.match(r.text, /^Hello Megan\n\n--\nRiverside Physiotherapy \(fictional\)\n2 Station Parade \(fictional\), Bletchley, MK2 9ZZ\n01632 960100\n/);
    assert.match(r.text, /agreed to receive news and offers/);
    assert.match(r.text, new RegExp(`Unsubscribe from news and offers: ${stop.replace(/[.?]/g, "\\$&")}`));
    assert.deepEqual(r.headers, {
      "List-Unsubscribe": `<${stop}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    assert.match(r.html, /2 Station Parade \(fictional\)/);
    assert.match(r.html, new RegExp(`<a href="${stop.replace(/[.?]/g, "\\$&")}">`));
    const service = renderCampaign({
      subject: "We are moving",
      body: "x",
      values: {},
      clinicName: "R",
      postalAddress: "A",
      phone: null,
      purpose: "service",
      stopUrl: stop,
    });
    assert.match(service.text, /service announcement/);
    assert.match(service.text, /Stop reminder and announcement emails/);
    const noLink = renderCampaign({
      subject: "s",
      body: "b",
      values: {},
      clinicName: "R",
      postalAddress: "A",
      phone: null,
      purpose: "marketing",
      stopUrl: null,
      subjectPrefix: "[Test] ",
    });
    assert.deepEqual(noLink.headers, {});
    assert.equal(noLink.subject, "[Test] s");
  });
});

describe("bulk email – review: merged values never become links", () => {
  it("a patient name that looks like a link is escaped text; the clinic's own link still works", () => {
    const r = renderCampaign({
      subject: "Hi",
      body: "Hello {first_name}, book at https://clinic.example.com/book",
      values: { first_name: "https://evil.example.com/x <b>" },
      clinicName: "R",
      postalAddress: "A",
      phone: null,
      purpose: "marketing",
      stopUrl: "https://clinic.example.com/api/clinic-messages/unsubscribe?t=abc",
    });
    assert.doesNotMatch(r.html, /href="https:\/\/evil/);
    assert.match(r.html, /Hello https:\/\/evil\.example\.com\/x &lt;b&gt;, book at <a href="https:\/\/clinic\.example\.com\/book">/);
    assert.match(r.html, /<a href="https:\/\/clinic\.example\.com\/api\/clinic-messages\/unsubscribe\?t=abc">/);
    assert.match(r.text, /^Hello https:\/\/evil\.example\.com\/x <b>, book at/, "the text version as merged");
  });
});

describe("bulk email – audience dates", () => {
  it("last seen, age band and adults-only marketing", () => {
    const b = audienceBounds(
      "2026-11-12",
      {
        siteId: null,
        lastSeenMonths: 6,
        upcoming: "any",
        minAge: 30,
        maxAge: 44,
      },
      "marketing",
    );
    assert.equal(b.lastSeenFrom, "2026-05-12");
    assert.equal(b.bornOnOrBefore, "1996-11-12"); // 30 today
    assert.equal(b.bornOnOrAfter, "1981-11-13"); // 44 until tomorrow's 45th birthday
    assert.equal(b.adultBornOnOrBefore, "2008-11-12");
    const s = audienceBounds("2026-11-12", normaliseAudience({}), "service");
    assert.deepEqual(s, {
      lastSeenFrom: null,
      bornOnOrBefore: null,
      bornOnOrAfter: null,
      adultBornOnOrBefore: null,
    });
    // 29 February and month ends clamp.
    assert.equal(audienceBounds("2028-02-29", normaliseAudience({}), "marketing").adultBornOnOrBefore, "2010-02-28");
    assert.equal(audienceBounds("2026-08-31", normaliseAudience({ lastSeenMonths: 6 }), "service").lastSeenFrom, "2026-02-28");
  });
});
