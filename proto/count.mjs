import { chromium } from "playwright";
import fs from "node:fs";
fs.writeFileSync("/tmp/s.zip", "x"); fs.writeFileSync("/tmp/p.pdf", "x"); fs.writeFileSync("/tmp/u.zip", "x");
const b = await chromium.launch({ executablePath: "/opt/google/chrome/chrome" });
const res = {};
for (const v of ["a", "b"]) {
  const p = await (await b.newContext({ viewport: { width: 1000, height: 760 } })).newPage();
  await p.goto("file://" + process.cwd() + `/${v}.html`);
  let n = 0; const step = async (f) => { n++; await f(); };
  if (v === "a") {
    await step(() => p.selectOption("#venue", "ARR"));
    await step(() => p.fill("#names", "Ada Example"));
    await step(() => p.setInputFiles("#src", "/tmp/s.zip"));
    await step(() => p.setInputFiles("#pdf", "/tmp/p.pdf"));
    await step(() => p.setInputFiles("#sup", "/tmp/u.zip"));
    await step(() => p.click("#go"));
    res.a = { stepsToFirstVerdict: n + 0, withVenueAndNames: n };
  } else {
    await step(() => p.setInputFiles("#files", ["/tmp/s.zip", "/tmp/p.pdf", "/tmp/u.zip"]));
    const first = n;
    await step(() => p.selectOption("#venue", "ARR"));
    await step(() => p.fill("#names", "Ada Example"));
    res.b = { stepsToFirstVerdict: first, withVenueAndNames: n };
  }
  await p.screenshot({ path: `${v}.png` });
}
await b.close();
console.log(JSON.stringify(res));
