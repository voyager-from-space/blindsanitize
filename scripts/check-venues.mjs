// Re-fetches every venue page cited in site/venues.js and checks each quote is still on it, word for word (after folding case,
// quote marks, dashes and whitespace). Exits 1 if any quote is missing. A page that cannot be fetched is reported, not treated as a pass.
// usage: node scripts/check-venues.mjs [--json]
import { VENUES } from '../site/venues.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const fold = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&rsquo;|&lsquo;|&#8217;|&#8216;|&#39;|&apos;/g, "'")
  .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').replace(/ ([:,.;!?)])/g, '$1').toLowerCase().trim(); // tag stripping leaves a space before punctuation after bold text

const pages = new Map();
async function page(url) {
  if (pages.has(url)) return pages.get(url);
  let text = null, err = null;
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; blindsanitize-verify)' }, redirect: 'follow' });
    if (!r.ok) err = `HTTP ${r.status}`;
    else if (/pdf/.test(r.headers.get('content-type') || '') || url.endsWith('.pdf')) {
      const f = mkdtempSync(tmpdir() + '/bs-') + '/x.pdf'; writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      text = fold(execFileSync('pdftotext', [f, '-'], { maxBuffer: 1e8 }).toString());
    } else text = fold(await r.text());
  } catch (e) { err = String(e.message || e); }
  const v = { text, err }; pages.set(url, v); return v;
}

const rows = [];
for (const [vid, v] of Object.entries(VENUES)) {
  for (const kind of ['rules', 'camera']) for (const r of v[kind] || []) {
    const pg = await page(r.url);
    const pieces = r.quote.split('\u2026').map((s) => fold(s).replace(/^[ ."]+|[ ."]+$/g, '')).filter((s) => s.length > 8);
    const found = pg.text ? pieces.every((p) => pg.text.includes(p)) : null;
    rows.push({ venue: vid, kind, id: r.id, url: r.url, found, err: pg.err });
  }
  for (const [k, l] of Object.entries(v.limits || {})) {
    const pg = await page(l.url);
    const q = fold(l.text);
    rows.push({ venue: vid, kind: 'limit', id: k, url: l.url, found: pg.text ? pg.text.includes(q) : null, err: pg.err });
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else for (const r of rows) console.log(`${r.found === true ? 'PASS' : r.found === false ? 'FAIL' : 'SKIP'}  ${r.venue}/${r.kind}/${r.id}  ${r.url}${r.err ? '  (' + r.err + ')' : ''}`);
const bad = rows.filter((r) => r.found !== true);
console.log(`${rows.length - bad.length}/${rows.length} quotes found on their pages`);
process.exit(bad.length ? 1 : 0);
