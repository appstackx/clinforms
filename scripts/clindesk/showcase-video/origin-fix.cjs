// LOCAL ONLY workaround: `next start` builds req.url from its own host (localhost:3320), so the clinic system's
// same-origin check refuses POSTs from clinic.localhost. The recorder re-sends those POSTs with the origin the local
// server expects. Nothing in the app is changed. (Flagged for checking on clindesk.co.uk.)
module.exports = async function originFix(page) {
  await page.route(/clinic\.localhost:3320\/app\/clinic\/.*\/api\//, async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.continue();
    const h = await req.allHeaders();
    h.origin = "http://localhost:3320";
    h.host = "clinic.localhost:3320";
    const resp = await route.fetch({ url: req.url().replace("clinic.localhost", "127.0.0.1"), headers: h });
    await route.fulfill({ response: resp });
  });
};
