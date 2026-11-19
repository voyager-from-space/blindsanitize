// The PDF that reviewers open. One pass with pdf-lib (MIT, vendored, loaded on demand): inspect, fix what is safe, write it back.
// Fixes: Info dictionary and XMP removed, review-comment annotations and their author names removed, file attachments removed,
// links that name you (own pages, file hosts, mailto) removed, EXIF/XMP/IPTC cut out of embedded JPEGs.
// What it cannot change is the page text: those hits are reported with "fix it in the source and rebuild".
import { loadPdfLib, pruneUnreachable } from './pdfscrub.js';
import { scrubJpeg } from './reuse.js';
import { classifyUrl } from './links.js';
import { findTerms } from './identity.js';

const mask3 = () => '\u2588\u2588\u2588'; // identity text is never shown, not even its first letters
const txt = (o) => { try { return o && o.decodeText ? o.decodeText() : o && o.asString ? o.asString() : ''; } catch { return ''; } };
const MARKUP = new Set(['Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'FreeText', 'Stamp', 'Ink', 'Caret', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Popup', 'Redact']);

export async function pdfPass(bytes, ctx) {
  const findings = [];
  const add = (f) => findings.push({ scope: 'pdf', status: 'fixed', ...f });
  const lib = await loadPdfLib();
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, PDFNumber } = lib;
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false }); }
  catch (e) { return { error: /encrypt/i.test(String(e && e.message)) ? 'The PDF is encrypted, so it was not rewritten.' : 'The PDF library could not read it.', findings }; }
  const pages = doc.getPageCount();
  if (!pages) return { error: 'No pages could be read from the PDF.', findings };
  const c = doc.context;
  const N = (s) => PDFName.of(s);
  let changed = false;

  // ---- Info dictionary ----
  const infoRef = c.trailerInfo.Info;
  const info = infoRef ? c.lookupMaybe(infoRef, PDFDict) : null;
  const infoVals = {};
  if (info) for (const [k, v] of info.entries()) { const val = txt(c.lookup(v)); if (val && val.trim()) infoVals[(k.decodeText ? k.decodeText() : String(k)).replace(/^\//, '')] = val; }
  const idHit = (s) => findTerms(ctx.terms, s).length > 0;
  if (infoVals.Author) add({ rule: 'pdf-meta', level: 'block', label: 'PDF author field', detail: `Author is set (${mask3(infoVals.Author)})${idHit(infoVals.Author) ? ' and matches a name you gave' : ''}. Removed.` });
  const others = Object.keys(infoVals).filter((k) => k !== 'Author');
  if (others.length) add({ rule: 'pdf-meta', level: Object.values(infoVals).some(idHit) ? 'block' : 'check', label: 'PDF document properties', detail: `${others.join(', ')} removed (they can name your tools, your machine or your project).` });
  if (info) changed = true;
  c.trailerInfo.Info = undefined;
  if (infoRef instanceof PDFRef) c.delete(infoRef);

  // ---- XMP ----
  const META = N('Metadata'), metaOwners = [];
  for (const [, obj] of c.enumerateIndirectObjects()) { const d = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null; if (d && d.has(META)) metaOwners.push([d, d.get(META)]); }
  let xmpNames = 0;
  for (const [d, m] of metaOwners) {
    try { const s = c.lookup(m); if (s instanceof PDFRawStream) { const raw = lib.decodePDFRawStream(s).decode(); const x = new TextDecoder().decode(raw); for (const mm of x.matchAll(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]+)</g)) if (mm[1].trim()) xmpNames++; if (findTerms(ctx.terms, x).length) xmpNames++; } } catch { /* unreadable packet: it is removed anyway */ }
    d.delete(META); if (m instanceof PDFRef) c.delete(m); changed = true;
  }
  if (metaOwners.length) add({ rule: 'pdf-xmp', level: xmpNames ? 'block' : 'check', label: 'XMP metadata packet', detail: `${xmpNames ? 'It holds a creator name. ' : ''}Removed.` });

  // ---- attachments ----
  const cat = doc.catalog;
  const names = cat.lookupMaybe(N('Names'), PDFDict);
  let attached = !!(names && names.has(N('EmbeddedFiles')));
  if (attached) names.delete(N('EmbeddedFiles'));
  // PDF 2.0 associated files: /AF on the catalog and on pages points at the same file specifications
  if (cat.has(N('AF'))) { cat.delete(N('AF')); attached = true; }
  for (const pg of doc.getPages()) if (pg.node.has(N('AF'))) { pg.node.delete(N('AF')); attached = true; }
  if (attached) { changed = true; add({ rule: 'pdf-attach', level: 'block', label: 'Files attached inside the PDF', detail: 'The attachments were removed. Attached source or data can carry names.' }); }

  // ---- annotations ----
  let linksKept = 0, linksRemoved = 0, markup = 0, popups = 0;
  const authors = new Set();
  doc.getPages().forEach((page, pi) => {
    const arr = page.node.lookupMaybe(N('Annots'), PDFArray);
    if (!arr) return;
    const keep = [];
    for (let i = 0; i < arr.size(); i++) {
      const ref = arr.get(i), d = c.lookupMaybe(ref, PDFDict);
      if (!d) { keep.push(ref); continue; }
      const st = d.lookupMaybe(N('Subtype'), PDFName), type = st ? st.decodeText() : '';
      if (type === 'Link') {
        const a = d.lookupMaybe(N('A'), PDFDict);
        const uri = a ? txt(a.lookup(N('URI'))) : '';
        if (uri) {
          const k = classifyUrl(uri, ctx.terms);
          if (k.kind === 'cloud' || k.kind === 'mail' || ((k.kind === 'repo' || k.kind === 'personal') && k.mine) || findTerms(ctx.terms, uri).length) { linksRemoved++; add({ rule: 'pdf-link', level: 'block', label: 'A link in the PDF that names you', detail: `Page ${pi + 1}: ${k.host || 'link'}${k.owner ? '/' + mask3(k.owner) : ''} removed. The link text stays visible, so check it too.`, page: pi + 1 }); changed = true; continue; }
          linksKept++;
        }
        keep.push(ref); continue;
      }
      if (type === 'FileAttachment') { markup++; changed = true; add({ rule: 'pdf-attach', level: 'block', label: 'A file attached to a page', detail: `Page ${pi + 1}: removed.`, page: pi + 1 }); continue; }
      if (MARKUP.has(type)) {
        if (type === 'Popup') popups++; else { markup++; const t = txt(d.lookup(N('T'))); if (t) authors.add(t); }
        changed = true; continue;
      }
      keep.push(ref);
    }
    if (keep.length !== arr.size()) page.node.set(N('Annots'), c.obj(keep));
  });
  if (markup) add({ rule: 'pdf-annot', level: 'block', label: 'Comments and markup', detail: `${markup} review annotation${markup > 1 ? 's' : ''} removed${authors.size ? `; they were signed ${[...authors].map(mask3).join(', ')}` : ''}.` });
  if (linksKept) add({ rule: 'pdf-link-kept', level: 'note', label: 'Links kept', detail: `${linksKept} link${linksKept > 1 ? 's' : ''} ${linksKept > 1 ? 'do not name you and were' : 'does not name you and was'} left alone.`, status: 'info' });

  // ---- JPEG images: EXIF, XMP, IPTC ----
  let jpegs = 0, gps = 0;
  const replace = [];
  for (const [ref, obj] of c.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    const sub = d.get(N('Subtype')), f = d.get(N('Filter'));
    const isImg = sub && sub.decodeText && sub.decodeText() === 'Image';
    const dct = f && ((f.decodeText && f.decodeText() === 'DCTDecode') || (f instanceof PDFArray && f.asArray().some((x) => x.decodeText && x.decodeText() === 'DCTDecode')));
    if (!isImg || !dct) continue;
    const r = scrubJpeg(obj.contents);
    if (r && r.bytes.length < obj.contents.length) { jpegs++; if (r.found.gps) gps++; replace.push([ref, d, r.bytes]); }
  }
  for (const [ref, d, nb] of replace) { d.set(N('Length'), PDFNumber.of(nb.length)); c.assign(ref, PDFRawStream.of(d, nb)); changed = true; }
  if (jpegs) add({ rule: 'pdf-image-exif', level: gps ? 'block' : 'check', label: gps ? 'Photo with a GPS position inside the PDF' : 'Image metadata inside the PDF', detail: `${jpegs} embedded JPEG${jpegs > 1 ? 's' : ''} had EXIF, XMP or IPTC${gps ? `, ${gps} with a position` : ''}. Removed.` });

  if (!changed) return { bytes: null, findings, pages };
  pruneUnreachable(doc, lib);
  const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  // read back: same page count, no Info, no /Metadata, no attachments tree
  try {
    const back = await PDFDocument.load(out, { updateMetadata: false, throwOnInvalidObject: false });
    let bad = back.getPageCount() !== pages || !!back.context.trailerInfo.Info;
    for (const [, obj] of back.context.enumerateIndirectObjects()) { const d = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null; if (d && d.has(META)) bad = true; }
    if (bad) return { error: 'The check after rewriting the PDF failed, so the original was kept.', findings: findings.map((f) => ({ ...f, status: 'manual' })), pages };
  } catch { return { error: 'The check after rewriting the PDF failed, so the original was kept.', findings: findings.map((f) => ({ ...f, status: 'manual' })), pages }; }
  return { bytes: out, findings, pages };
}
