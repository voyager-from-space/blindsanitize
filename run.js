// One analysis run over everything that was dropped. Pure orchestration; the UI in app.js only renders the result.
import { buildTerms, findTerms, setActiveTerms, hideAll } from './identity.js';
import { processBundle } from './bundle.js';
import { reverseBundle, reversePdfFindings } from './reverse.js';
import { pdfPass } from './pdfpass.js';
import { extract, scanPdfText, totalChars } from './pdftext.js';
import { writeZip, writeTgz } from './archive.js';
import { normalizePaths } from './reuse.js';
import { VENUES } from './venues.js';

const fmtMB = (n) => (n / 1e6).toFixed(1) + ' MB';
const fmt = (n) => n.toLocaleString('en-US');

export async function analyze(sorted, settings) {
  const { mode, venue } = settings;
  const terms = buildTerms(settings.names, settings.others);
  setActiveTerms(terms);
  const ctx = { terms, venue, stripComments: settings.stripComments !== false };
  ctx.scrubPdf = async (bytes) => {
    const r = await pdfPass(bytes, ctx);
    if (r.error) return { bytes: null, findings: [{ rule: 'pdf-meta', level: 'check', label: 'A PDF inside the archive could not be cleaned', detail: r.error, status: 'manual' }] };
    return { bytes: r.bytes, findings: r.findings.filter((f) => f.status !== 'info').map(({ scope, ...f }) => f) };
  };
  const findings = [], outputs = { source: null, pdf: null, supp: [] }, limits = [];
  const v = VENUES[venue] || VENUES.any;
  let links = new Map(), pdfInfo = null, sourceFiles = null;

  // file names that were dropped
  for (const [scope, u] of [['source', sorted.source], ['pdf', sorted.pdf], ...sorted.supp.map((s) => ['supp', s])]) {
    if (u && findTerms(terms, u.name).length) findings.push({ scope, file: u.name.replace(/[^/]*$/, (n) => n.slice(0, 3) + '\u2588\u2588\u2588'), rule: 'filename', level: 'check', label: 'A name you gave is in the file name', detail: 'Rename it before you upload it. The downloads here use neutral names.', status: 'manual' });
  }

  if (sorted.source) {
    const files = normalizePaths(sorted.source.files);
    if (mode === 'camera') {
      const r = reverseBundle(files, ctx, settings, 'source');
      findings.push(...r.findings); r.links.forEach((v2, k) => links.set(k, [...(links.get(k) || []), ...v2]));
      outputs.source = { name: 'source-camera-ready.zip', bytes: await writeZip(r.files), files: r.files };
    } else {
      const r = await processBundle(files, ctx, 'source');
      findings.push(...r.findings);
      outputs.source = { name: 'source-blind.zip', bytes: await writeZip(r.files), files: r.files, removed: r.removed, stats: r.stats };
    }
    sourceFiles = outputs.source.files;
  }
  for (let i = 0; i < sorted.supp.length; i++) {
    const u = sorted.supp[i];
    const files = normalizePaths(u.files);
    let res, name;
    if (mode === 'camera') { res = reverseBundle(files, ctx, settings, 'supp'); res.links.forEach((v2, k) => links.set(k, [...(links.get(k) || []), ...v2])); name = 'supplementary-camera-ready'; }
    else { res = await processBundle(files, ctx, 'supp'); name = 'supplementary-blind'; }
    findings.push(...res.findings.map((f) => ({ ...f, file: sorted.supp.length > 1 ? `${u.name}: ${f.file}` : f.file })));
    const ext = u.kind === 'zip' ? 'zip' : 'tar.gz';
    const bytes = u.kind === 'zip' ? await writeZip(res.files) : await writeTgz(res.files);
    outputs.supp.push({ name: `${name}${sorted.supp.length > 1 ? '-' + (i + 1) : ''}.${ext}`, bytes, files: res.files, removed: res.removed });
    const lim = v.limits.suppZip;
    if (lim && mode !== 'camera' && bytes.length > lim.bytes) findings.push({ scope: 'supp', rule: 'size', level: 'block', label: 'Supplementary archive is over the venue limit', detail: `${fmt(bytes.length)} bytes after cleaning, limit ${fmt(lim.bytes)}. ${lim.note || ''} The venue says: "${lim.text}".`, status: 'manual', source: lim.url });
    else if (lim && mode !== 'camera') findings.push({ scope: 'supp', rule: 'size', level: 'note', label: 'Supplementary archive size', detail: `${fmt(bytes.length)} bytes after cleaning, under ${fmt(lim.bytes)}. ${lim.note || ''}`, status: 'info' });
  }
  if (sorted.pdf) {
    const u = sorted.pdf;
    try {
      const text = await extract(u.bytes);
      pdfInfo = { pages: text.pages.length, chars: totalChars(text) };
      if (mode === 'camera') {
        findings.push(...reversePdfFindings(text));
        outputs.pdf = { name: 'paper.pdf', bytes: u.bytes, unchanged: true };
      } else {
        const pass = await pdfPass(u.bytes, ctx);
        if (pass.error) findings.push({ scope: 'pdf', rule: 'pdf-meta', level: 'check', label: 'The PDF could not be rewritten', detail: pass.error, status: 'manual' });
        findings.push(...pass.findings);
        findings.push(...scanPdfText(text, ctx));
        outputs.pdf = { name: 'paper-blind.pdf', bytes: pass.bytes || u.bytes, unchanged: !pass.bytes };
        if (!pdfInfo.chars) findings.push({ scope: 'pdf', rule: 'pdf-names', level: 'check', label: 'No text could be read from the PDF', detail: 'It may be scanned pages. The text checks could not run.', status: 'manual' });
        const lim = v.limits.pdf;
        if (lim) findings.push({ scope: 'pdf', rule: 'size', level: u.bytes.length > lim.bytes ? 'block' : 'note', label: u.bytes.length > lim.bytes ? 'PDF is over the venue limit' : 'PDF size', detail: `${fmt((outputs.pdf.bytes || u.bytes).length)} bytes, limit ${fmt(lim.bytes)}. ${lim.note || ''} The venue says: "${lim.text}".`, status: u.bytes.length > lim.bytes ? 'manual' : 'info' });
      }
    } catch (e) {
      findings.push({ scope: 'pdf', rule: 'pdf-meta', level: 'check', label: 'The PDF could not be read', detail: String(e && e.message || e).slice(0, 160), status: 'manual' });
    }
  }
  for (const u of [...sorted.other, ...sorted.extraPdfs]) findings.push({ scope: 'source', rule: 'unsorted', level: 'note', label: 'A file was not used', detail: `${u.name.slice(0, 60)}: ${u.kind === 'pdf' ? 'only the first PDF is checked' : 'not a zip, tar or PDF'}.`, status: 'info' });
  // Last line of defence: whatever a scanner wrote, nothing typed (names, terms, emails) reaches the screen or the report.
  for (const f of findings) for (const k of ['label', 'detail', 'excerpt', 'file']) if (typeof f[k] === 'string') f[k] = hideAll(f[k]);
  return { mode, venue, findings, outputs, limits, links, pdfInfo, terms: terms.length, ctx };
}
