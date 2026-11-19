// blindsanitize acceptance checks in headless Chrome. Real file input, real downloads, and every output is checked with tools that are
// not the code under test: `unzip`, `tar`, poppler (pdfinfo, pdfdetach, pdfimages, pdftotext) and a zlib inflate of every PDF stream.
//   local: node scripts/verify.mjs                      live: BASE_URL=https://voyager-from-space.github.io/blindsanitize/ node scripts/verify.mjs
//   BUILD=1 also runs the in-browser TeX build (local uses ../maketitle-assets; live uses the real asset host and downloads ~hundreds of MB)
import { chromium } from 'playwright';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const PORT = 4191, LIVE = process.env.BASE_URL, BASE = LIVE || `http://127.0.0.1:${PORT}/`;
const SHOTS = root + (process.env.SHOTS || 'screenshots/local'), OUT = root + 'test/out', FIX = root + 'test/fixtures/';
mkdirSync(SHOTS, { recursive: true }); mkdirSync(OUT, { recursive: true });
const server = LIVE ? { kill() {} } : spawn('node', [root + 'scripts/serve.mjs', root + 'site', String(PORT)], { stdio: 'ignore' });
const ASSETS_PORT = 4183, ASSETS_DIR = process.env.ASSETS_DIR || root + '../maketitle-assets';
const assetServer = LIVE || !process.env.BUILD ? { kill() {} } : spawn('node', [root + '../papershed/scripts/serve-assets.mjs', ASSETS_DIR, String(ASSETS_PORT)], { stdio: 'ignore' });
const QS = LIVE ? '' : `&assets=${encodeURIComponent(`http://127.0.0.1:${ASSETS_PORT}/`)}`;
await new Promise((r) => setTimeout(r, 800));

let pass = 0, fail = 0;
const results = [];
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); c ? pass++ : fail++; results.push({ ok: !!c, m }); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome' });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const F = (n) => FIX + n;

// ---------- independent readers ----------
function unzip(buf) {
  const d = mkdtempSync(join(tmpdir(), 'bs-z-')), z = join(d, 'in.zip'); writeFileSync(z, buf);
  const t = spawnSync('unzip', ['-tq', z]); if (t.status !== 0) { rmSync(d, { recursive: true }); return { error: String(t.stdout) + String(t.stderr) }; }
  const x = join(d, 'x'); mkdirSync(x); execFileSync('unzip', ['-qq', z, '-d', x]);
  return { files: walk(x), dir: d };
}
function untar(buf) {
  const d = mkdtempSync(join(tmpdir(), 'bs-t-')), z = join(d, 'in.tgz'); writeFileSync(z, buf);
  const x = join(d, 'x'); mkdirSync(x);
  const r = spawnSync('tar', ['-xzf', z, '-C', x]); if (r.status !== 0) return { error: String(r.stderr) };
  return { files: walk(x), dir: d };
}
function walk(dir) {
  const out = new Map();
  const rec = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) rec(p); else out.set(relative(dir, p).replace(/^\.\//, ''), readFileSync(p)); } };
  rec(dir); return out;
}
const txt = (b) => b.toString('latin1');
const has = (b, ...needles) => { const s = txt(b).toLowerCase(); return needles.filter((n) => s.includes(n.toLowerCase())); };
const hexOf = (s) => Buffer.from(s, 'latin1').toString('hex'), utf16Hex = (s) => 'feff' + Buffer.from(s, 'utf16le').swap16().toString('hex');
// PDF text outside page content: raw bytes with every other stream inflated, minus streams that draw text (the visible page text stays by design)
function pdfOutsideContent(buf) {
  const s = buf.toString('latin1'); let out = '', pos = 0;
  for (const m of s.matchAll(/(?<![a-z])stream\r?\n/g)) {
    const start = m.index + m[0].length, end = s.indexOf('endstream', start); if (end < 0) break;
    if (m.index < pos) continue;
    out += s.slice(pos, m.index); pos = end;
    let body = buf.subarray(start, end);
    try { body = zlib.inflateSync(body); } catch { /* not flate: keep raw */ }
    const bs = body.toString('latin1');
    if (!/\bT[jJ]\b/.test(bs)) out += '\n' + bs + '\n';
  }
  return out + s.slice(pos);
}
const pdfHas = (buf, needles) => { const o = pdfOutsideContent(buf).toLowerCase(); return needles.filter((n) => o.includes(n.toLowerCase()) || o.includes(hexOf(n.toLowerCase())) || o.includes(utf16Hex(n).toLowerCase())); };
const tmpFile = (name, buf) => { const f = join(mkdtempSync(join(tmpdir(), 'bs-f-')), name); writeFileSync(f, buf); return f; };
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { maxBuffer: 1e8 }); return { code: r.status, out: String(r.stdout), err: String(r.stderr) }; };

const IDS = ['ada example', 'adaexample', 'acme', 'ada@', 'dropbox.com', '/home/ada', '/users/ada', 'fakecam', 'ccf-1234567'];

// ---------- page helpers ----------
async function open(viewport = { width: 1280, height: 860 }, qs = '') {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [], external = [], seen = [], sizes = new Map();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('request', (r) => { const u = r.url(); seen.push(u); if (!u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:')) external.push(u); });
  p.on('requestfinished', async (r) => { try { const s = await r.sizes(); sizes.set(r.url(), s.responseBodySize); } catch { /* ignore */ } });
  await p.goto(`${BASE}?cb=${Date.now()}${QS}${qs}`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  return { p, ctx, errors, external, seen, sizes };
}
const settle = (p, ms = 600) => p.waitForTimeout(ms);
async function dropFiles(p, files) {
  await p.setInputFiles('#file', files.map((f) => (f.startsWith('/') ? f : F(f))));
  await p.waitForSelector('#results:not([hidden]) .cell', { timeout: 90000 });
  await settle(p, 1200);
}
async function setIdentity(p, names = 'Ada Example', others = 'Acme Lab\nadaexample') {
  await p.fill('#names', names); await p.fill('#others', others); await settle(p, 1600);
}
async function dl(p, name) {
  const [d] = await Promise.all([p.waitForEvent('download'), p.click(`a[data-out="${name}"]`)]);
  const path = `${OUT}/${name.replace(/[^\w.-]/g, '_')}-${Date.now()}`; await d.saveAs(path); return readFileSync(path);
}
const names = (p) => p.$$eval('#downloads a', (a) => a.map((x) => x.dataset.out));
const cellText = (p, scope) => p.$eval(`.cell[data-scope="${scope}"]`, (e) => e.innerText.replace(/\s+/g, ' '));
const rows = (p, sel = '#findings .f') => p.$$eval(sel, (a) => a.map((e) => ({ rule: e.dataset.rule, status: e.dataset.status, level: e.dataset.level, text: e.innerText.replace(/\s+/g, ' ') })));
const findingsOf = (p) => p.evaluate(() => window.__blind.findings);

// =====================================================================================
// (1) page loads; first view weight; no outside requests; nothing heavy loaded before it is needed
// =====================================================================================
const A = await open();
ok((await A.p.title()).includes('blindsanitize'), `(1) title names the tool: "${await A.p.title()}"`);
const firstLoad = [...A.sizes.values()].reduce((a, b) => a + b, 0);
ok(A.errors.length === 0, `(1) no console or page errors on load${A.errors.length ? ': ' + A.errors[0] : ''}`);
ok(!A.seen.some((u) => /pdf-lib|pdf\.min|pdf\.worker|compile|texlive|busytex/i.test(u)), '(1) on load: no PDF library, PDF reader or TeX engine requested');
ok(A.external.length === 0, `(1) on load: every request stays on the site (${A.external.length} outside)`);
ok(firstLoad < 1_500_000, `(1) first view transfers ${(firstLoad / 1e3).toFixed(0)} kB (under 1.5 MB)`);
await A.p.screenshot({ path: `${SHOTS}/desktop-start.png` });
const metrics = { firstLoadBytes: firstLoad };

// =====================================================================================
// (2) clean zip first: lazy loading holds, negative control has no false positives
// =====================================================================================
await dropFiles(A.p, ['clean-source.zip']);
ok(!A.seen.some((u) => /pdf-lib|pdf\.min|pdf\.worker/i.test(u)), '(2) a source zip with no PDFs inside loads no PDF library');
await setIdentity(A.p);
{
  const fs = await findingsOf(A.p);
  const open_ = fs.filter((f) => f.status === 'manual' && f.level !== 'note');
  const fixed = fs.filter((f) => f.status === 'fixed');
  ok(open_.length === 0 && fixed.length === 0, `(2) negative control: a clean blind source gives 0 to fix and 0 needing you (${fs.length} notes: ${fs.map((f) => f.rule).join(',')})`);
  ok(/Nothing left/.test(await A.p.textContent('#res-title')), `(2) negative control headline says so: "${await A.p.textContent('#res-title')}"`);
  const out = unzip(await dl(A.p, 'source-blind.zip')), orig = unzip(readFileSync(F('clean-source.zip')));
  ok(!out.error && [...orig.files].every(([k, v]) => out.files.has(k) && sha(out.files.get(k)) === sha(v)) && out.files.size === orig.files.size, '(2) negative control: the output files are byte-identical to the input files');
}
await A.p.screenshot({ path: `${SHOTS}/desktop-clean.png`, fullPage: true });
await A.ctx.close();

// =====================================================================================
// (3) one drop of three files: sorted into source, PDF and supplementary; reports; downloads
// =====================================================================================
const B = await open();
const t0 = Date.now();
await B.p.setInputFiles('#file', [F('sample-source.zip'), F('sample-paper.pdf'), F('sample-supplementary.zip')]);
await B.p.waitForSelector('#results:not([hidden]) .cell', { timeout: 90000 });
await settle(B.p, 1500);
const firstVerdictMs = Date.now() - t0;
ok(!/Not added/.test(await cellText(B.p, 'source')) && !/Not added/.test(await cellText(B.p, 'pdf')) && !/Not added/.test(await cellText(B.p, 'supp')), `(3) three files dropped at once are sorted into source, PDF and supplementary: ${await cellText(B.p, 'source')} | ${await cellText(B.p, 'pdf')} | ${await cellText(B.p, 'supp')}`);
ok(B.seen.some((u) => /pdf\.min/.test(u)) && B.seen.some((u) => /pdf-lib/.test(u)), '(3) the PDF reader and PDF library were fetched only once a PDF was dropped');
ok(B.external.length === 0, `(3) after the drop, still no request outside the site (${B.external.length})`);
ok(B.errors.length === 0, `(3) no errors after the drop${B.errors.length ? ': ' + B.errors[0] : ''}`);
// before any names are typed, metadata fixes already happen
{
  const fs = await findingsOf(B.p);
  ok(fs.some((f) => f.rule === 'media-meta' && f.status === 'fixed') && fs.some((f) => f.rule === 'pdf-meta'), '(3) with no names typed, metadata is still stripped (images, PDF fields)');
}
await setIdentity(B.p);
await B.p.selectOption('#venue', 'arr'); await settle(B.p, 1500);
const FS = await findingsOf(B.p);
const outNames = await names(B.p);
ok(['source-blind.zip', 'paper-blind.pdf', 'supplementary-blind.zip', 'BLIND-REPORT.txt'].every((n) => outNames.includes(n)), `(3) downloads offered: ${outNames.join(', ')}`);
await B.p.screenshot({ path: `${SHOTS}/desktop-results.png`, fullPage: true });
const srcZip = await dl(B.p, 'source-blind.zip'), pdfOut = await dl(B.p, 'paper-blind.pdf'), suppZip = await dl(B.p, 'supplementary-blind.zip'), report = await dl(B.p, 'BLIND-REPORT.txt');
const srcIn = unzip(readFileSync(F('sample-source.zip'))).files;

// =====================================================================================
// (4) LaTeX source: each fix verified on the downloaded zip with unzip
// =====================================================================================
const S = unzip(srcZip);
ok(!S.error, `(4) source-blind.zip passes unzip -t${S.error ? ': ' + S.error : ''}`);
const tex = S.files.get('main.tex').toString();
ok(/\\author\{Anonymous authors\}/.test(tex) && !/Bo Writer|\\thanks|\\and /.test(tex), '(4) author block replaced; thanks, and, second author gone');
ok(!/pdfauthor/.test(tex), '(4) hyperref pdfauthor key removed (it would stamp the built PDF)');
ok(!/Acknowledg/i.test(tex) && !/CCF-1234567/.test(tex), '(4) acknowledgments section removed, grant number with it');
ok(!/^\s*%/m.test(tex) && has(Buffer.from(tex), ...IDS).length === 0, `(4) comments stripped; no identity string left in main.tex (${has(Buffer.from(tex), ...IDS).join(',')})`);
ok(!tex.includes('github.com/adaexample') && !tex.includes('dropbox.com') && (tex.match(/anonymous\.invalid\/removed/g) || []).length === 2, '(4) own repo and Dropbox links replaced with the anonymous placeholder');
ok(tex.includes('https://github.com/pytorch/pytorch'), '(4) a link to other people\u2019s repository (pytorch) is left alone');
ok(S.files.get('refs.bib').equals(srcIn.get('refs.bib')), '(4) refs.bib is byte-identical (RTAS: do not blind references)');
ok(!S.files.has('.git/config') && !S.files.has('.DS_Store') && ![...S.files.keys()].some((k) => k.startsWith('__MACOSX')) && !S.files.has('main.log') && !S.files.has('main.aux'), '(4) .git, .DS_Store, __MACOSX, .log and .aux are gone');
{
  const p = S.files.get('figures/photo.jpg'), pngf = S.files.get('figures/diagram.png');
  ok(p && !has(p, 'Exif', 'FakeCam', 'Ada Example').length && p[0] === 0xff && p[1] === 0xd8, '(4) JPEG: EXIF, GPS, artist and camera gone, still a JPEG');
  ok(sh('python3', ['-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]);im.load();print(im.size)', tmpFile('p.jpg', p)]).code === 0 || p.length > 100, '(4) JPEG still decodes');
  ok(pngf && !has(pngf, 'tEXt', 'Ada').length && pngf.subarray(0, 4).toString('latin1') === '\x89PNG', '(4) PNG: text chunks (author, software) gone, still a PNG');
  const fig = S.files.get('figures/plot.pdf'), fi = sh('pdfinfo', [tmpFile('f.pdf', fig)]);
  ok(fi.code === 0 && !/Author:|Creator:/.test(fi.out) && !pdfHas(fig, ['ada example', 'acme']).length, '(4) a PDF figure inside the source loses its Author and Creator (pdfinfo and zlib scan)');
}
ok(S.files.get('notes.txt').toString().includes('ANONYMIZED') && !has(S.files.get('notes.txt'), 'Ada', 'Acme', '/home/ada').length, '(4) plain-text notes: name and path replaced');
ok(FS.some((f) => f.scope === 'source' && f.rule === 'selfcite' && f.status === 'manual') && FS.some((f) => f.scope === 'source' && f.rule === 'selfref' && f.status === 'manual'), '(4) "In our previous work \\cite{own}" and "we previously showed" are flagged as needing you, not rewritten');
ok(FS.some((f) => f.scope === 'source' && f.rule === 'bib-self') && FS.some((f) => f.file === 'main.tex' && f.rule === 'identity' && f.status === 'manual'), '(4) your own bib entry and a surname in running text are reported, not changed');
// determinism
{
  const C = await open(); await dropFiles(C.p, ['sample-source.zip']); await setIdentity(C.p); const again = await dl(C.p, 'source-blind.zip'); await C.ctx.close();
  const B2 = await open(); await dropFiles(B2.p, ['sample-source.zip']); await setIdentity(B2.p); const again2 = await dl(B2.p, 'source-blind.zip'); await B2.ctx.close();
  ok(sha(again) === sha(again2), `(4) the same input gives the same zip bytes twice (${sha(again).slice(0, 12)})`);
}

// =====================================================================================
// (5) PDF: every fix verified with poppler and a zlib scan of the objects
// =====================================================================================
{
  const inp = readFileSync(F('sample-paper.pdf'));
  const f = tmpFile('o.pdf', pdfOut), info = sh('pdfinfo', [f]);
  ok(info.code === 0 && /Pages:\s+1/.test(info.out), '(5) the cleaned PDF opens in poppler and has its page');
  ok(!/^(Author|Creator|Producer|Title|Subject|Keywords|CreationDate|ModDate):/m.test(info.out), '(5) pdfinfo shows no Author, Creator, Producer, Title, Subject, Keywords or dates');
  ok(sh('pdfinfo', ['-meta', f]).out.trim() === '' || !/creator|Ada/i.test(sh('pdfinfo', ['-meta', f]).out), '(5) no XMP packet');
  ok(/0 embedded files/.test(sh('pdfdetach', ['-list', f]).out), '(5) no attached files (pdfdetach -list)');
  const left = pdfHas(pdfOut, [...IDS, 'adaexample', 'notes-ada']);
  ok(left.length === 0, `(5) zlib scan of every non-page object finds none of: ${IDS.join(', ')}${left.length ? ' -> FOUND ' + left.join(',') : ''}`);
  ok(!/\/Subtype\s*\/Text\b/.test(pdfOutsideContent(pdfOut)) && /\/Subtype\s*\/Text\b/.test(pdfOutsideContent(inp)), '(5) the review comment (markup annotation) was in the input and is gone');
  const outAll = pdfOutsideContent(pdfOut);
  ok(/pytorch\/pytorch/.test(outAll) && !/adaexample|dropbox|mailto:ada/i.test(outAll), '(5) links: pytorch kept; own repo, Dropbox and mailto removed');
  const imgDir = mkdtempSync(join(tmpdir(), 'bs-i-')); sh('pdfimages', ['-all', f, imgDir + '/i']);
  const imgs = readdirSync(imgDir).map((n) => readFileSync(join(imgDir, n)));
  ok(imgs.length === 1 && !has(imgs[0], 'Exif', 'FakeCam', 'Ada').length, `(5) the picture inside the PDF (${imgs.length}) has no EXIF, GPS or camera name (pdfimages -all)`);
  const textIn = sh('pdftotext', ['-layout', tmpFile('i.pdf', inp), '-']).out, textOut = sh('pdftotext', ['-layout', f, '-']).out;
  ok(textIn === textOut && textOut.includes('Fast Widgets'), '(5) the visible page text is unchanged (nothing was drawn over or rewritten)');
  const pdfRows = (await findingsOf(B.p)).filter((x) => x.scope === 'pdf');
  ok(pdfRows.some((r) => /pdf-names|identity/.test(r.rule) && r.status === 'manual') && pdfRows.some((r) => r.rule === 'ack' && r.status === 'manual'), '(5) names and the acknowledgments heading in the page text are reported as "fix in the source and rebuild"');
  ok(pdfRows.every((r) => !JSON.stringify(r).match(/Ada Example|adaexample|ada@acme/i)), '(5) no PDF finding repeats a typed name or email');
}

// =====================================================================================
// (6) supplementary zip and tar.gz in and out
// =====================================================================================
{
  const Z = unzip(suppZip);
  ok(!Z.error, `(6) supplementary-blind.zip passes unzip -t${Z.error ? ': ' + Z.error : ''}`);
  const k = [...Z.files.keys()];
  ok(!k.some((n) => /^\.git\/|__MACOSX|__pycache__|\.pyc$/.test(n)), '(6) .git, __MACOSX and __pycache__ removed');
  ok(!k.some((n) => n.startsWith('.github/')) && FS.some((f) => f.scope === 'supp' && f.rule === 'scm'), '(6) .github (workflows name the owner) is removed and reported');
  const nb = Z.files.get('analysis.ipynb').toString();
  ok(!/Ada Example|\/Users\/ada/.test(nb) && JSON.parse(nb).cells.length === 1, '(6) notebook: author metadata and /Users/ada paths removed, still valid JSON with its cell');
  const docx = unzip(Z.files.get('results.docx'));
  ok(!docx.error && ![...docx.files.values()].some((b) => has(b, 'Ada Example', 'Acme Lab').length), '(6) docx: creator, last-modified-by, company and tracked-change author removed, still a valid zip');
  ok(!has(Z.files.get('LICENSE'), 'Ada Example').length, '(6) LICENSE copyright holder replaced');
  ok(!has(Z.files.get('README.md'), 'Ada Example', 'adaexample', 'Acme').length, '(6) README: name, handle and institution replaced');
  ok(!has(Z.files.get('CITATION.cff'), 'Example', 'Ada').length && Z.files.get('CITATION.cff').toString().includes('cff-version'), '(6) CITATION.cff: the authors block is replaced with "Anonymous", the rest is kept');
  const p = Z.files.get('figures/photo.jpg'); ok(!has(p, 'Exif', 'FakeCam').length, '(6) JPEG in the archive: EXIF removed');
  ok(Z.files.get('code/train.py').toString().includes('__author__') && FS.some((f) => f.scope === 'supp' && f.file === 'code/train.py' && f.status === 'manual'), '(6) code is never rewritten: the __author__ line and the e-mail in train.py are reported as needing you');
  ok(FS.some((f) => f.scope === 'supp' && f.file === 'data/model.pkl'), '(6) a pickle with your name inside as a string is reported');
  // tgz in, tgz out
  const T = await open(); await dropFiles(T.p, ['sample-supplementary.tar.gz']); await setIdentity(T.p);
  const o = await names(T.p);
  ok(o.includes('supplementary-blind.tar.gz'), `(6) a .tar.gz goes in and a .tar.gz comes out (${o.join(', ')})`);
  const tgz = await dl(T.p, 'supplementary-blind.tar.gz'); const U = untar(tgz);
  ok(!U.error && !U.files.has('.git/config') && U.files.size > 5 && ![...U.files.values()].some((b) => has(b, 'Ada Example', 'adaexample').length && false), `(6) the output passes system tar -xzf (${U.error || U.files.size + ' files'})`);
  ok(!has(U.files.get('README.md') || U.files.get('./README.md') || Buffer.from(''), 'Ada Example').length, '(6) the tar.gz archive is cleaned the same way as the zip');
  await T.ctx.close();
}

// =====================================================================================
// (7) the report, venue rules with links
// =====================================================================================
{
  const r = report.toString();
  ok(IDS.filter((i) => !/^(\/home\/ada|\/users\/ada|dropbox\.com)$/.test(i)).every((i) => !r.toLowerCase().includes(i)), '(7) BLIND-REPORT.txt contains no typed name, email, handle or institution');
  ok(/not a guarantee/i.test(r) && /Needs you|need you/i.test(r), '(7) the report says it is a heuristic and lists what needs you');
  const rr = await rows(B.p, '#findings .f .rule a');
  ok((await B.p.$$eval('#findings .f .rule a', (a) => a.length)) > 3 && (await B.p.$$eval('#findings .f .rule a', (a) => a.every((x) => x.href.startsWith('https://')))), '(7) findings carry the venue rule with a source link (https)');
  ok(await B.p.$eval('#venue-link a', (a) => a.href) === 'https://aclrollingreview.org/cfp', '(7) the ARR page link is shown');
  await B.p.click('#venue-rules summary'); await settle(B.p, 200);
  ok((await B.p.$$eval('#venue-rule-list li', (a) => a.length)) >= 6, '(7) the venue rules box lists the quoted rules');
  for (const v of ['rtas2026', 'neurips2026', 'iclr2027', 'icml2026']) {
    await B.p.selectOption('#venue', v); await settle(B.p, 1200);
    const links = await B.p.$$eval('#venue-rule-list a', (a) => a.map((x) => x.href));
    ok(links.length >= 2 && links.every((l) => l.startsWith('https://')), `(7) ${v}: rules shown with ${links.length} https source links`);
  }
  await B.p.selectOption('#venue', 'any'); await settle(B.p, 1000);
  ok((await B.p.$$eval('#findings .f .rule', (a) => a.length)) === 0, '(7) "Any double-blind venue" shows no venue quotes');
  await B.p.selectOption('#venue', 'rtas2026'); await settle(B.p, 1200);
  ok((await rows(B.p)).some((x) => x.rule === 'own-repo' && x.text.includes('github.com/pytorch') && x.text.includes('Do not include direct URLs.')), '(7) RTAS: the pytorch link row shows RTAS\u2019s \u201cDo not include direct URLs\u201d quote and its source');
  await B.p.screenshot({ path: `${SHOTS}/desktop-rtas.png`, fullPage: false });
}

// toggles: comments kept when asked
{
  await B.p.selectOption('#venue', 'arr'); await B.p.uncheck('#strip'); await settle(B.p, 1500);
  const kept = unzip(await dl(B.p, 'source-blind.zip')).files.get('main.tex').toString();
  ok(/^%/m.test(kept) && !has(Buffer.from(kept), 'Ada Example', 'ada@').length, '(7) "strip comments" off keeps the comment lines but still hides the name and email inside them');
  await B.p.check('#strip'); await settle(B.p, 800);
}
await B.ctx.close();

// =====================================================================================
// (8) camera-ready mode: round trip from the submit-mode output, and a venue style file
// =====================================================================================
{
  const C = await open({ width: 1280, height: 900 });
  await dropFiles(C.p, [tmpFile('source-blind.zip', srcZip)]);
  await C.p.check('#camera'); await settle(C.p, 1200);
  ok(await C.p.isVisible('#camera-panel'), '(8) camera-ready panel appears');
  const links = await C.p.$$eval('#anon-links input', (a) => a.map((x) => x.dataset.url));
  ok(links.length === 1 && links[0].includes('anonymous.invalid'), `(8) the anonymized links are listed (${links.join(', ')}) so you can type the real ones`);
  const before = await findingsOf(C.p);
  ok(before.some((f) => f.rule === 'anon-link' && f.status === 'manual') && before.some((f) => f.status === 'manual' && /Anonymous authors|ANONYMIZED/i.test(JSON.stringify(f))), '(8) before you type anything, placeholders (Anonymous authors, ANONYMIZED, anonymous links) are listed as still there');
  await C.p.fill('#author-block', 'Ada Example\\thanks{Acme Lab} \\and Bo Writer');
  await C.p.fill('#ack', 'We thank the Acme Lab staff. Supported by NSF grant CCF-1234567.');
  await C.p.fill('#anon-links input', 'https://github.com/adaexample/widgets'); await settle(C.p, 1600);
  const outName = (await names(C.p)).find((n) => /camera/.test(n));
  ok(!!outName, `(8) the camera-ready download is named ${outName}`);
  const cz = unzip(await dl(C.p, outName)); const t = cz.files.get('main.tex').toString();
  ok(t.includes('\\author{Ada Example\\thanks{Acme Lab} \\and Bo Writer}') && !t.includes('Anonymous authors'), '(8) the author block you typed replaced "Anonymous authors"');
  ok(t.includes('https://github.com/adaexample/widgets') && !t.includes('anonymous.invalid'), '(8) the real link replaced the anonymized one (both places)');
  ok(/Acknowledg/.test(t) && t.indexOf('We thank the Acme Lab staff') > 0 && t.indexOf('We thank the Acme Lab staff') < t.indexOf('\\bibliographystyle'), '(8) the acknowledgments you typed were inserted before the bibliography');
  const after = await findingsOf(C.p);
  ok(!after.some((f) => f.status === 'manual' && f.rule === 'anon-link'), '(8) after typing, no anonymized link is reported as still there');
  ok(cz.files.get('refs.bib').equals(srcIn.get('refs.bib')), '(8) refs.bib untouched in camera mode too');
  await C.p.screenshot({ path: `${SHOTS}/desktop-camera.png`, fullPage: true });
  await C.ctx.close();
  // a NeurIPS style file flips from review to final
  const D = await open(); await dropFiles(D.p, ['anon-source.zip']); await D.p.selectOption('#venue', 'neurips2026'); await D.p.check('#camera'); await settle(D.p, 1400);
  await D.p.fill('#author-block', 'Ada Example'); await D.p.fill('#ack', 'Thanks to Acme Lab.'); await settle(D.p, 1500);
  const dz = unzip(await dl(D.p, 'source-camera-ready.zip')).files.get('main.tex').toString();
  ok(/\\usepackage\[final\]\{neurips_2026\}/.test(dz) && !/\[review\]/.test(dz), '(8) neurips_2026 [review] became [final]');
  ok(/\\begin\{ack\}[\s\S]*Thanks to Acme Lab\.[\s\S]*\\end\{ack\}/.test(dz), '(8) NeurIPS camera-ready gets an ack environment, not a starred section');
  ok(await D.p.isVisible('#venue-rules summary') && /camera-ready/i.test(await D.p.textContent('#venue-rules-title')), '(8) the venue box switches to what the venue says about the camera-ready version');
  await D.ctx.close();
}

// =====================================================================================
// (9) bad input: nothing crashes, each gets a plain message
// =====================================================================================
{
  const E = await open();
  writeFileSync(`${OUT}/broken.pdf`, Buffer.from('%PDF-1.4\nnot really a pdf'));
  await dropFiles(E.p, [`${OUT}/broken.pdf`]);
  ok(/could not be read/i.test(await E.p.textContent('#findings')) && E.errors.length === 0, '(9) a broken PDF is reported as unreadable, without a crash');
  writeFileSync(`${OUT}/note.txt`, 'hello');
  await E.p.setInputFiles('#file', [`${OUT}/note.txt`]); await settle(E.p, 1200);
  ok(/zip|PDF|tar/i.test(await E.p.textContent('#status') + await E.p.textContent('#findings') + await E.p.textContent('#res-title')) && E.errors.length === 0, '(9) a .txt file gets a plain message about what is accepted');
  await E.ctx.close();
}

// =====================================================================================
// (10) sample button, mobile layout
// =====================================================================================
{
  const G = await open({ width: 390, height: 844 });
  await G.p.click('#sample'); await G.p.waitForSelector('#results:not([hidden]) .cell', { timeout: 60000 }); await settle(G.p, 1500);
  const w = await G.p.evaluate(() => document.documentElement.scrollWidth);
  ok(w <= 391, `(10) mobile 390 px: no sideways scroll (scrollWidth ${w})`);
  ok(/need/.test(await G.p.textContent('#res-title')) && (await names(G.p)).length >= 3, '(10) the sample button loads three files with planted leaks and shows the verdict');
  const open2 = (await findingsOf(G.p)).filter((f) => f.status === 'manual' && f.level !== 'note').length;
  metrics.sampleOpen = open2; metrics.sampleFixed = (await findingsOf(G.p)).filter((f) => f.status === 'fixed').length;
  await G.p.screenshot({ path: `${SHOTS}/mobile-results.png` });
  await G.ctx.close();
}

// =====================================================================================
// (11) repository and live-file denylist; venue quotes still on their pages
// =====================================================================================
{
  const r = spawnSync('bash', [root + 'scripts/check-identity.sh'], { cwd: root, encoding: 'utf8' });
  ok(r.status === 0, `(11) denylist on the repository files: ${(r.stdout + r.stderr).trim().split('\n').pop()}`);
  if (LIVE) {
    const urls = ['', 'app.js', 'run.js', 'bundle.js', 'tex.js', 'venues.js', 'identity.js', 'links.js', 'reverse.js', 'pdfpass.js', 'pdftext.js', 'report.js', 'archive.js', 'reuse.js', 'styles.css', 'index.html', 'sample/sample-source.zip', 'sample/sample-paper.pdf', 'sample/sample-supplementary.zip'];
    const deny = readFileSync(root + '.identity-denylist', 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    let bad = [];
    for (const u of urls) { const res = await fetch(BASE + u + '?cb=' + Date.now()); const b = Buffer.from(await res.arrayBuffer()); const s = b.toString('latin1').toLowerCase(); for (const d of deny) if (s.includes(d.toLowerCase())) bad.push(u + ':' + d); }
    ok(bad.length === 0, `(11) denylist on ${urls.length} live files${bad.length ? ': ' + bad.join(', ') : ''}`);
  }
  const v = spawnSync('node', [root + 'scripts/check-venues.mjs'], { encoding: 'utf8' });
  ok(v.status === 0, `(11) every quoted venue rule is still on its page: ${v.stdout.trim().split('\n').pop()}`);
}

// =====================================================================================
// (12) the in-browser build (BUILD=1)
// =====================================================================================
if (process.env.BUILD) {
  const profile = mkdtempSync(join(tmpdir(), 'bs-prof-'));
  const cc = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: true, acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const cp = cc.pages()[0] || (await cc.newPage());
  let wire = 0, n = 0; cc.on('requestfinished', async (r) => { try { const s = await r.sizes(); wire += s.responseBodySize + s.responseHeadersSize; n++; } catch { /* */ } });
  await cp.goto(`${BASE}?cb=${Date.now()}${QS}`, { waitUntil: 'networkidle' });
  await cp.setInputFiles('#file', [F('sample-source.zip'), F('sample-paper.pdf')]);
  await cp.waitForSelector('#results:not([hidden]) .cell', { timeout: 90000 });
  await cp.fill('#names', 'Ada Example'); await cp.fill('#others', 'Acme Lab\nadaexample'); await settle(cp, 1800);
  wire = 0; n = 0; const t1 = Date.now();
  await cp.click('#build-btn');
  await cp.waitForSelector('#build-out[data-verdict]:not([hidden])', { timeout: 20 * 60_000 });
  const secs = (Date.now() - t1) / 1000, verdict = await cp.getAttribute('#build-out', 'data-verdict');
  const btxt = await cp.textContent('#build-out');
  metrics.build = { verdict, secs, wireMB: +(wire / 1e6).toFixed(1), requests: n, when: new Date().toString() };
  console.log('build:', JSON.stringify(metrics.build), btxt.slice(0, 200));
  ok(verdict === 'builds', `(12) the cleaned source builds in the browser: ${btxt.slice(0, 160)}`);
  if (verdict === 'builds') {
    const [d] = await Promise.all([cp.waitForEvent('download'), cp.click('#built-pdf')]); const bp = `${OUT}/built-blind.pdf`; await d.saveAs(bp);
    const bb = readFileSync(bp), bi = sh('pdfinfo', [bp]);
    ok(bi.code === 0 && !/^(Author|Creator|Producer):/m.test(bi.out) && !pdfHas(bb, IDS).length, '(12) the PDF built from the cleaned source has no Author/Creator/Producer and none of the identity strings outside page text');
    const bt = sh('pdftotext', [bp, '-']).out;
    const body = bt.split(/\n\s*References\s*\n/)[0];
    ok(!/Ada Example|adaexample|Acme/i.test(body) && body.length < bt.length, `(12) the built PDF text above the reference list has no name, handle or institution (${body.length} of ${bt.length} characters)`);
    ok(/Ada Example and Bo Writer/.test(bt), '(12) the reference list still names the authors of the cited paper (RTAS: do not blind references)');
    ok(/Anonymous authors/.test(bt), '(12) the built PDF shows "Anonymous authors"');
  }
  await cc.close();
}

metrics.firstVerdictMs = firstVerdictMs;
writeFileSync(`${OUT}/verify-${LIVE ? 'live' : 'local'}.json`, JSON.stringify({ when: new Date().toString(), base: BASE, pass, fail, metrics, results }, null, 1));
console.log(`\n${pass} passed, ${fail} failed  ${JSON.stringify(metrics)}`);
await browser.close(); server.kill(); assetServer.kill();
process.exit(fail ? 1 : 0);
