// Local only: re-skins the clinic-system demo seed as "Pebblegate Physio (fictional)" for the showcase video.
// Applied to a throwaway worktree; undo with `git checkout scripts/pms`.
import fs from "node:fs";
const WT = process.argv[2];
const R = (file, pairs) => {
  const p = `${WT}/scripts/pms/${file}`;
  let s = fs.readFileSync(p, "utf8");
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { console.log(`  (skip ${file}: ${a.slice(0,40)})`); continue; }
    s = s.split(a).join(b);
  }
  fs.writeFileSync(p, s);
};
const common = [
  ["riverside-demo.example.com", "pebblegate-demo.example.com"],
  ["Riverside Physiotherapy (fictional)", "Pebblegate Physio (fictional)"],
];
R("demo-data.ts", [
  ...common,
  ['slug: "riverside-demo"', 'slug: "pebblegate-demo"'],
  ['name: "Bletchley (fictional)", code: "BLE", address: ["2 Station Parade (fictional)", "Bletchley", "Milton Keynes"]', 'name: "Northgate (fictional)", code: "NGT", address: ["2 Station Parade (fictional)", "Northgate", "Pebblegate"]'],
  ['bletchley@', 'northgate@'],
  ['rooms: ["Room 1", "Room 2"] },\n  { key: "WOL"', 'rooms: ["Room 1", "Room 2", "Room 3"] },\n  { key: "WOL"'],
  ['name: "Wolverton (fictional)", code: "WOL", address: ["18 Market Row (fictional)", "Wolverton", "Milton Keynes"]', 'name: "Abbey Road (fictional)", code: "ABR", address: ["18 Market Row (fictional)", "Abbey Road", "Pebblegate"]'],
  ['wolverton@', 'abbeyroad@'],
  ['name: "Central Milton Keynes (fictional)", code: "CMK", address: ["5 Silbury Court (fictional)", "Central Milton Keynes"]', 'name: "Kingsmead (fictional)", code: "KMD", address: ["5 Silbury Court (fictional)", "Kingsmead", "Pebblegate"]'],
  ['cmk@', 'kingsmead@'],
  ['displayName: "Sarah Reid"', 'displayName: "Sophie Marsh"'], ["sarah.reid@", "sophie.marsh@"],
  ['displayName: "Priya Shah"', 'displayName: "Hannah Doyle"'], ["priya.shah@", "hannah.doyle@"],
  ['displayName: "Hannah Moore"', 'displayName: "Ben Carter"'], ["hannah.moore@", "ben.carter@"],
  ['"Bletchley Medical Centre (fictional)"', '"Northgate Medical Centre (fictional)"'],
  ['"Wolverton Health Centre (fictional)"', '"Abbey Road Health Centre (fictional)"'],
  ['["Bletchley", "MK3 9ZZ"]', '["Northgate", "MK3 9ZZ"]'],
  ['["Wolverton", "MK12 9ZZ"]', '["Abbey Road", "MK12 9ZZ"]'],
  ['["Central Milton Keynes", "MK9 9ZZ"]', '["Kingsmead", "MK9 9ZZ"]'],
  ['town === "Wolverton"', 'town === "Abbey Road"'],
  ['"Bletchley", "Milton Keynes"]', '"Northgate", "Pebblegate"]'],
  ['"Wolverton", "Milton Keynes"]', '"Abbey Road", "Pebblegate"]'],
  ['"1 Queensway (fictional)", "Bletchley"]', '"1 Queensway (fictional)", "Northgate"]'],
  ['"40 Church Street (fictional)", "Wolverton"]', '"40 Church Street (fictional)", "Abbey Road"]'],
  ['"Milton Keynes"]', '"Pebblegate"]'],
]);
R("seed-integration.ts", [
  ['"Bletchley Medical Centre (fictional)"', '"Northgate Medical Centre (fictional)"'],
  ['p.displayName === "Priya Shah"', 'p.displayName === "Sophie Marsh"'],
  ['{ title: "Mrs", firstName: "Emily", lastName: "Turner", dateOfBirth: "1982-09-27", sex: "female", email: "emily.turner@example.com"', '{ title: "Mr", firstName: "Robert", lastName: "Hale", dateOfBirth: "1979-04-14", sex: "male", email: "robert.hale@example.com"'],
  ['"12 Example Row (fictional)", "Bletchley"]', '"12 Example Row (fictional)", "Northgate"]'],
  ['author: { name: "Priya Shah", registration: "PH-DEMO-03"', 'author: { name: "Sophie Marsh", registration: "PH-DEMO-01"'],
  ["Office worker. Goal: swim again (fictional).", "Office worker. Goal: swim again (fictional)."],
]);
R("seed-billing.ts", common);
R("seed-comms.ts", [...common, ['smsSender: "Riverside"', 'smsSender: "Pebblegate"']]);
R("seed-records.ts", [['"Sarah Reid"', '"Sophie Marsh"']]);
R("seed-portal.ts", [["  BLE: {", "  NGT: {"], ["  WOL: {", "  ABR: {"], ["  CMK: {", "  KMD: {"]]);
console.log("seed patched");
