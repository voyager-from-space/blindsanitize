// Text, outline and annotations of a PDF through pdf.js (Apache-2.0, vendored, loaded on demand). Used to find what the page
// text itself gives away: names, emails, ORCID iDs, links, acknowledgments, "we previously showed".
import { findTerms, excerpt } from './identity.js';
import { classifyUrl, URL_RE, trimUrl } from './links.js';

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import('./vendor/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

export async function extract(bytes) {
  const { getDocument } = await pdfjs();
  const task = getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let s = '';
    for (const it of tc.items) { s += it.str; s += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : ''); }
    pages.push(s);
    page.cleanup();
  }
  let outline = [];
  try { const o = await doc.getOutline(); const walk = (xs) => { for (const x of xs || []) { outline.push(x.title); walk(x.items); } }; walk(o); } catch { /* no outline */ }
  try { await (doc.destroy ? doc.destroy() : task.destroy()); } catch { /* cleanup only */ }
  return { pages, outline };
}

const SELF = [/\bin our (?:previous|prior|earlier|recent|past|preliminary|own)\s+(?:work|paper|papers|study|studies)\b/i, /\bwe (?:have )?(?:previously|recently|earlier|already)\s+(?:shown|showed|proposed|introduced|presented|published|developed|reported|demonstrated)\b/i, /\b(?:our|my) (?:lab|laboratory|group|institute|university|department|company)\b/i];
const ORCID = /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;

// findings for the text layer. None of these can be fixed inside the PDF.
export function scanPdfText({ pages, outline }, ctx) {
  const out = [];
  const add = (f) => out.push({ scope: 'pdf', status: 'manual', ...f });
  const seen = new Set();
  pages.forEach((raw, i) => {
    const p = i + 1, flat = raw.replace(/-\n(?=[a-z])/g, '').replace(/\s+/g, ' ');
    for (const h of findTerms(ctx.terms, flat)) {
      const k = 'id' + p + h.text.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
      add({ rule: 'pdf-names', level: h.weak ? 'check' : 'block', label: h.weak ? 'Your surname in the PDF text' : h.term.isName ? 'Your name in the PDF text' : 'A name you gave, in the PDF text', detail: `Page ${p}. ${h.weak || h.term.isName ? 'Fine only as a third-person citation of your own paper. ' : ''}Fix it in the source and rebuild.`, page: p, excerpt: excerpt(flat, h.index, h.length) });
    }
    for (const m of flat.matchAll(EMAIL)) { const k = 'em' + p + m[0]; if (seen.has(k)) continue; seen.add(k); add({ rule: 'pdf-names', level: 'block', label: 'Email address in the PDF text', detail: `Page ${p}. Fix it in the source and rebuild.`, page: p, excerpt: excerpt(flat, m.index, m[0].length) }); }
    for (const m of flat.matchAll(ORCID)) add({ rule: 'pdf-names', level: 'block', label: 'ORCID iD in the PDF text', detail: `Page ${p}. Fix it in the source and rebuild.`, page: p });
    for (const m of raw.matchAll(URL_RE)) {
      const url = trimUrl(m[0]), c = classifyUrl(url, ctx.terms);
      const k = 'u' + url; if (seen.has(k)) continue; seen.add(k);
      if (c.kind === 'cloud' || ((c.kind === 'repo' || c.kind === 'personal') && c.mine)) add({ rule: c.kind === 'cloud' ? 'cloud-link' : 'own-repo', level: 'block', label: c.kind === 'cloud' ? 'Link to a file host in the PDF text' : 'Link to your own page in the PDF text', detail: `Page ${p}: ${c.host}. Fix it in the source and rebuild.`, page: p });
      else if (c.kind === 'repo' || c.kind === 'personal') add({ rule: 'own-repo', level: 'check', label: 'Link to a public repository or page', detail: `Page ${p}: ${c.host}${c.owner ? '/' + c.owner : ''}. Yours? Cited work by others is fine.`, page: p });
      else if (c.kind === 'short') add({ rule: 'url-any', level: 'check', label: 'Shortened link', detail: `Page ${p}: ${c.host} can log who clicks.`, page: p });
    }
    for (const m of raw.matchAll(/^\s*(?:\d+\.?\s*)?Acknowledg(?:e)?ments?\s*$/gim)) { const k = 'ack' + p; if (!seen.has(k)) { seen.add(k); add({ rule: 'ack', level: 'block', label: 'Acknowledgments in the PDF', detail: `Page ${p}. Remove the section in the source and rebuild.`, page: p }); } }
    for (const re of SELF) { const m = re.exec(flat); if (m) { const k = 'sr' + p + re.source; if (seen.has(k)) continue; seen.add(k); add({ rule: 'selfref', level: 'check', label: 'First person about earlier work', detail: `Page ${p}. Write it in the third person.`, page: p, excerpt: excerpt(flat, m.index, m[0].length, 50) }); } }
  });
  for (const t of outline) for (const h of findTerms(ctx.terms, t)) add({ rule: 'pdf-names', level: 'block', label: 'A name you gave, in a bookmark', detail: 'The PDF outline names you. Fix it in the source and rebuild.', excerpt: excerpt(t, h.index, h.length) });
  return out;
}

export const totalChars = ({ pages }) => pages.reduce((a, p) => a + p.length, 0);
