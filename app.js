import { readUpload, classify } from './archive.js';
import { analyze } from './run.js';
import { summarize, SCOPES, LEVEL_RANK, reportText } from './report.js';
import { VENUES, venueOptions, rulesFor } from './venues.js';
import { fmtBytes } from './reuse.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const say = (t) => { $('status').textContent = t || ''; };

let uploads = [], sorted = null, last = null, seq = 0, timer = null, urls = [];

// ---- venue select ----
for (const v of venueOptions()) { const o = el('option', null, v.label); o.value = v.id; $('venue').append(o); }
const params = new URLSearchParams(location.search);
if (VENUES[params.get('venue')]) $('venue').value = params.get('venue');
if (params.get('mode') === 'camera') $('camera').checked = true;

const settings = () => ({
  mode: $('camera').checked ? 'camera' : 'submit', venue: $('venue').value, names: $('names').value, others: $('others').value,
  stripComments: $('strip').checked, authorBlock: $('author-block').value, ack: $('ack').value,
  links: Object.fromEntries([...document.querySelectorAll('#anon-links input')].map((i) => [i.dataset.url, i.value])),
});

// ---- intake ----
async function intake(fileList) {
  say('Reading your files');
  const fresh = [];
  for (const f of fileList) fresh.push(await readUpload(f.name, new Uint8Array(await f.arrayBuffer())));
  uploads = fresh;
  await rerun(true);
}
$('file').addEventListener('change', (e) => { if (e.target.files.length) intake([...e.target.files]).catch(fail); });
const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) intake([...e.dataTransfer.files]).catch(fail); });
$('sample').addEventListener('click', async () => {
  say('Loading the sample');
  try {
    const names = ['sample-source.zip', 'sample-paper.pdf', 'sample-supplementary.zip'];
    const got = [];
    for (const n of names) got.push(await readUpload(n, new Uint8Array(await (await fetch('sample/' + n)).arrayBuffer())));
    uploads = got;
    $('names').value = 'Ada Example'; $('others').value = 'Acme Lab\nadaexample';
    $('venue').value = 'arr';
    await rerun(true);
  } catch (e) { fail(e); }
});
const fail = (e) => say('Something went wrong: ' + String(e && e.message || e).slice(0, 160));

// ---- run ----
async function rerun(first) {
  if (!uploads.length) return;
  const me = ++seq;
  sorted = classify(uploads);
  const t0 = performance.now();
  say(first ? 'Checking' : 'Checking again');
  let r;
  try { r = await analyze(sorted, settings()); } catch (e) { return fail(e); }
  if (me !== seq) return;
  last = r;
  r.ms = Math.round(performance.now() - t0);
  render(r);
  say('');
  if (first) { $('results').hidden = false; $('results').scrollIntoView({ block: 'start' }); }
}
const later = () => { clearTimeout(timer); timer = setTimeout(() => rerun(false), 450); };
for (const id of ['names', 'others', 'author-block', 'ack']) $(id).addEventListener('input', later);
for (const id of ['venue', 'camera', 'strip']) $(id).addEventListener('change', () => rerun(false));
$('anon-links').addEventListener('input', later);

// ---- render ----
const levelWord = { block: 'Reveals you', check: 'Check', note: 'Note' };
function renderFinding(f, venue, mode) {
  const li = el('li', `f ${f.level}`);
  const head = el('div', 'f-head');
  head.append(el('span', 'f-label', f.label));
  const where = [f.file, f.line ? 'line ' + f.line : '', f.page ? 'page ' + f.page : ''].filter(Boolean).join(', ');
  if (where) head.append(el('span', 'where', where));
  li.append(head);
  li.dataset.rule = f.rule; li.dataset.status = f.status; li.dataset.level = f.level;
  if (f.detail) li.append(el('p', 'f-detail', f.detail));
  if (f.excerpt) li.append(el('p', 'f-ex', f.excerpt));
  li.append(el('p', `st ${f.status}`, f.status === 'fixed' ? 'Fixed in your copy' : f.status === 'manual' ? 'Needs you' : levelWord[f.level] || 'Note'));
  if (mode !== 'camera') for (const r of rulesFor(venue, f.rule).slice(0, 1)) {
    const p = el('p', 'rule'); p.append(document.createTextNode(`${VENUES[venue].label}: `)); const q = el('q', null, r.quote); p.append(q, document.createTextNode(' '));
    const a = el('a', null, 'source'); a.href = r.url; p.append(a); li.append(p);
  }
  return li;
}

function render(r) {
  for (const u of urls) URL.revokeObjectURL(u); urls = [];
  const sum = summarize(r.findings), v = VENUES[r.venue];
  $('res-title').textContent = !r.findings.length ? 'Nothing found in what you dropped' : sum.open ? `${sum.open} thing${sum.open > 1 ? 's' : ''} still need${sum.open > 1 ? '' : 's'} you` : 'Nothing left that blindsanitize can see';
  $('res-sub').textContent = `${sum.fixed} fixed in your copies. ${r.mode === 'camera' ? 'Camera-ready mode.' : v.label + '.'} Checked in ${(r.ms / 1000).toFixed(1)} s. This is a heuristic scan, not a guarantee.`;
  // pack
  const pack = $('pack'); pack.textContent = '';
  const cell = (key, label, present, sub) => {
    const s = sum[key], c = el('div', 'cell ' + (!present ? 'off' : s.open ? 'bad' : 'ok'));
    c.dataset.scope = key;
    c.append(el('b', null, label), el('span', 'n', present ? String(s.open) : '\u2013'), el('span', 's', !present ? 'Not added' : `need you, ${s.fixed} fixed${sub ? '. ' + sub : ''}`));
    return c;
  };
  pack.append(cell('source', 'LaTeX source', !!sorted.source, ''), cell('pdf', 'PDF', !!sorted.pdf, r.pdfInfo ? `${r.pdfInfo.pages} page${r.pdfInfo.pages === 1 ? '' : 's'}` : ''), cell('supp', 'Supplementary', sorted.supp.length > 0, ''));
  // downloads
  const dl = $('downloads'); dl.textContent = '';
  const add = (name, bytes, type, cls = 'btn') => { const u = URL.createObjectURL(new Blob([bytes], { type })); urls.push(u); const a = el('a', cls, `${name} (${fmtBytes(bytes.length)})`); a.href = u; a.download = name; a.dataset.out = name; dl.append(a); };
  if (r.outputs.source) add(r.outputs.source.name, r.outputs.source.bytes, 'application/zip');
  if (r.outputs.pdf) add(r.outputs.pdf.name, r.outputs.pdf.bytes, 'application/pdf');
  for (const s of r.outputs.supp) add(s.name, s.bytes, s.name.endsWith('.zip') ? 'application/zip' : 'application/gzip');
  add('BLIND-REPORT.txt', new TextEncoder().encode(reportText({ ...r, names: null })), 'text/plain', 'btn alt2');
  // venue
  $('venue-link').textContent = '';
  if (v.page) { const a = el('a', null, v.label + ' rules page'); a.href = v.page; $('venue-link').append(a); } else $('venue-link').textContent = v.note;
  $('camera-panel').hidden = r.mode !== 'camera';
  const rules = r.mode === 'camera' ? (v.camera || []) : v.rules;
  const vr = $('venue-rules'); vr.hidden = !rules.length;
  $('venue-rules-title').textContent = r.mode === 'camera' ? `What ${v.label} says about the camera-ready version` : `What ${v.label} says (quoted from its page)`;
  const rl = $('venue-rule-list'); rl.textContent = '';
  for (const x of rules) { const li = el('li'); const q = el('q', null, x.quote); li.append(q, document.createTextNode(' ')); const a = el('a', null, x.scope ? `source (${x.scope})` : 'source'); a.href = x.url; li.append(a); rl.append(li); }
  // anonymized links (camera)
  const al = $('anon-links');
  const have = new Map([...al.querySelectorAll('input')].map((i) => [i.dataset.url, i.value]));
  al.textContent = '';
  if (r.mode === 'camera') for (const [url, where] of r.links) {
    const li = el('li', 'row'); li.append(el('span', 'where', `${url} (${where.length} place${where.length > 1 ? 's' : ''})`));
    const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Real address'; inp.dataset.url = url; inp.value = have.get(url) || ''; inp.setAttribute('aria-label', 'Real address for ' + url); li.append(inp); al.append(li);
  }
  if (r.mode === 'camera' && !r.links.size) al.append(el('li', 'row', 'No anonymized links found.'));
  // findings
  const host = $('findings'); host.textContent = '';
  for (const [key, label] of SCOPES) {
    const list = r.findings.filter((f) => f.scope === key);
    if (!list.length) continue;
    const h = el('h3', 'sec', `${label} (${list.length})`); h.dataset.scope = key; host.append(h);
    const ol = el('ol', 'list'); ol.dataset.scope = key;
    list.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || (a.status === 'manual' ? -1 : 1) - (b.status === 'manual' ? -1 : 1));
    for (const f of list.slice(0, 250)) ol.append(renderFinding(f, r.venue, r.mode));
    if (list.length > 250) ol.append(el('li', 'f note', `${list.length - 250} more are in the report.`));
    host.append(ol);
  }
  $('build-btn').disabled = !r.outputs.source; $('build-btn').title = r.outputs.source ? '' : 'Add the LaTeX source zip to build it';
  window.__blind = { findings: r.findings, outputs: { source: r.outputs.source && r.outputs.source.bytes, pdf: r.outputs.pdf && r.outputs.pdf.bytes, supp: r.outputs.supp.map((s) => s.bytes) } };
}

// ---- build the cleaned source and check the PDF it makes ----
let check = null;
$('build-btn').addEventListener('click', async () => {
  if (!last || !last.outputs.source) return;
  const btn = $('build-btn'), status = $('build-status'), out = $('build-out');
  btn.disabled = true; $('build-stop').hidden = false; out.hidden = true; out.textContent = '';
  let net = 0;
  const say2 = (t) => { status.textContent = net > 1e6 ? `${t}. Downloaded ${(net / 1e6).toFixed(0)} MB so far.` : t; };
  try {
    const { Check } = await import('./compile.js');
    const { pdfPass } = await import('./pdfpass.js');
    const { extract, scanPdfText } = await import('./pdftext.js');
    check = new Check({ onStatus: say2, onNet: (n) => { net = n; } });
    await check.start();
    const res = await check.build(last.outputs.source.files, 'cleaned source');
    const h = el('div'); out.append(h);
    if (!res.ok) {
      const li = el('li', 'f block'); li.append(el('div', 'f-label', 'The cleaned source did not build'), el('p', 'f-detail', res.noMain ? 'No file with \\documentclass was found.' : (res.errors[0] ? `${res.errors[0].msg}${res.errors[0].line ? ' (line ' + res.errors[0].line + ')' : ''}` : res.error || 'TeX stopped.')));
      const ol = el('ol', 'list'); ol.append(li); h.append(ol); out.dataset.verdict = 'fails';
    } else {
      out.dataset.verdict = 'builds';
      const ctx = last.ctx;
      const pass = await pdfPass(res.pdf, ctx);
      const text = await extract(res.pdf);
      const fs = [...pass.findings.filter((f) => f.status !== 'info'), ...scanPdfText(text, ctx)];
      const fb = el('p', 'f-detail', `${res.main} built with ${res.engine} in ${(res.ms / 1000).toFixed(1)} s: ${text.pages.length} page${text.pages.length > 1 ? 's' : ''}. ${fs.filter((f) => f.status === 'manual' && f.level !== 'note').length} thing${fs.length === 1 ? '' : 's'} left in the built PDF; ${fs.filter((f) => f.status === 'fixed').length} fixed in the download below. Built here, so the venue's own TeX Live can still differ.`);
      h.append(el('h4', 'sec2', 'It builds'), fb);
      const ol = el('ol', 'list'); for (const f of fs) ol.append(renderFinding({ ...f, scope: 'built' }, last.venue, last.mode)); h.append(ol);
      const bytes = pass.bytes || res.pdf;
      const u = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); urls.push(u);
      const a = el('a', 'btn', `built-blind.pdf (${fmtBytes(bytes.length)})`); a.href = u; a.download = 'built-blind.pdf'; a.id = 'built-pdf'; h.append(a);
      window.__blind.built = { findings: fs, pdf: bytes, textPages: text.pages };
    }
    out.hidden = false; status.textContent = 'Done.';
  } catch (e) { status.textContent = 'The build stopped: ' + String(e && e.message || e).slice(0, 160); }
  finally { btn.disabled = false; $('build-stop').hidden = true; if (check) check.stop(); check = null; }
});
$('build-stop').addEventListener('click', () => { if (check) check.stop(); });
