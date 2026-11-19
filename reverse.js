// Camera-ready mode: find what is still anonymized and put the real information back.
// Flips the style options, restores the author block, swaps anonymized links, inserts the acknowledgments you type.
import { findTerms, lineOf, lineText } from './identity.js';
import { commands, matchBrace, isCommented, usesClass } from './tex.js';
import { URL_RE, trimUrl, classifyUrl } from './links.js';
import { roleOf } from './bundle.js';

const dec = new TextDecoder('utf-8', { fatal: true }), enc = new TextEncoder();
const textOf = (b) => { try { return b.length < 12e6 && !b.subarray(0, 8000).includes(0) ? dec.decode(b) : null; } catch { return null; } };
export const isPlaceholderUrl = (u) => /anonymous\.invalid|anonymous\.4open\.science|4open\.science|anonymous\.github\.io/i.test(u);
const PLACEHOLDERS = [
  [/\bAnonymous (?:authors?|submission|institution|affiliation|university)\b/i, 'Placeholder author or affiliation'],
  [/\bANONYMIZED\b/, 'ANONYMIZED marker left by the submit-mode cleanup'],
  [/\bPaper under double-blind review\b/i, 'Double-blind review footer'],
  [/\bUnder review (?:as a|at|for)\b/i, 'Under-review footer'],
  [/\bAnonymous et al\.|\bAnonymous\s*\(\d{4}\)|\\cite[a-z]*\{anonymous/i, 'Anonymized reference'],
  [/\[(?:anonymized|redacted|removed)[^\]]*\]/i, 'Bracketed placeholder'],
];
const BIBLIO = /\\bibliographystyle\b|\\bibliography\s*\{|\\printbibliography|\\begin\s*\{thebibliography\}|\\appendix\b|\\end\s*\{document\}/;

export function reverseBundle(rawFiles, ctx, inputs, kind) {
  const findings = [], out = [], links = new Map();
  const base = { scope: kind === 'source' ? 'source' : 'supp' };
  const addFor = (file) => (f) => findings.push({ ...base, file, ...f });
  const map = inputs.links || {};
  for (const f of rawFiles) {
    const path = f.path, add = addFor(path);
    let t = textOf(f.bytes);
    if (t === null) { out.push(f); continue; }
    const orig = t, role = roleOf(path);
    // links first, in every text file
    t = t.replace(URL_RE, (raw, idx) => {
      const url = trimUrl(raw), tail = raw.slice(url.length);
      if (!isPlaceholderUrl(url)) return raw;
      if (!links.has(url)) links.set(url, []);
      links.get(url).push({ file: path, line: lineOf(orig, idx) });
      const real = (map[url] || '').trim();
      if (real) { add({ rule: 'anon-link', level: 'block', label: 'Anonymized link replaced', detail: 'Replaced with the address you gave.', line: lineOf(orig, idx), status: 'fixed' }); return real + tail; }
      add({ rule: 'anon-link', level: 'block', label: 'Anonymized link still in the file', detail: 'Type the real address in the box under "Anonymized links" to put it back.', line: lineOf(orig, idx), status: 'manual', excerpt: url });
      return raw;
    });
    if (role === 'tex') {
      const dc = usesClass(t);
      // style options
      t = t.replace(/\\usepackage\s*(?:\[([^\]]*)\])?\s*\{((?:neurips|nips|icml|iclr|acl|colm|emnlp|naacl|coling|eacl|tacl|cvpr|iccv|eccv|wacv)[^}]*)\}/gi, (all, opts = '', pkg, idx) => {
        if (isCommented(t, idx)) return all;
        const list = opts.split(',').map((o) => o.trim()).filter(Boolean);
        const p = pkg.trim().toLowerCase();
        let next = list;
        let word = 'final';
        if (/^icml/.test(p)) word = 'accepted';
        if (list.some((o) => ['final', 'accepted', 'camera-ready'].includes(o.toLowerCase()))) return all;
        if (/^(iclr)/.test(p)) return all; // handled below
        next = list.filter((o) => !['review', 'preprint'].includes(o.toLowerCase())).concat(word);
        add({ rule: 'class-option', level: 'block', label: 'Style still set for review', detail: `${pkg.trim()} now has [${next.join(',')}], which prints the authors.`, line: lineOf(t, idx), status: 'fixed' });
        return `\\usepackage[${next.join(',')}]{${pkg}}`;
      });
      if (dc && /^acmart$/i.test(dc.name) && /(^|,)\s*anonymous\s*(,|$)/.test(dc.opts)) {
        const opts = dc.opts.split(',').map((o) => o.trim()).filter((o) => o && o !== 'anonymous' && o !== 'review').join(',');
        add({ rule: 'class-option', level: 'block', label: 'acmart still anonymous', detail: 'Removed the anonymous (and review) class options.', line: lineOf(t, dc.index), status: 'fixed' });
        t = t.slice(0, dc.index) + `\\documentclass${opts ? '[' + opts + ']' : ''}{${dc.name}}` + t.slice(dc.index + dc.length);
      }
      t = t.replace(/^(\s*)%+\s*(\\iclrfinalcopy)\b/gm, (all, sp, cmd, idx) => { add({ rule: 'class-option', level: 'block', label: 'ICLR final copy is off', detail: '\\iclrfinalcopy switched on.', line: lineOf(t, idx), status: 'fixed' }); return sp + cmd; });
      // author block
      const au = commands(t, 'author');
      if (au.length) {
        const [a, b] = au[0].args[0];
        if (/^\s*Anonymous/i.test(t.slice(a, b))) {
          if (inputs.authorBlock && inputs.authorBlock.trim()) { add({ rule: 'author-block', level: 'block', label: 'Author block restored', detail: 'Replaced \u201cAnonymous authors\u201d with the block you gave.', line: lineOf(t, au[0].start), status: 'fixed' }); t = t.slice(0, a) + inputs.authorBlock.trim() + t.slice(b); }
          else add({ rule: 'author-block', level: 'block', label: 'Author block still says Anonymous', detail: 'Type the real author block in the box under "Author block".', line: lineOf(t, au[0].start), status: 'manual' });
        }
      }
      // acknowledgments
      const hasAck = /\\begin\s*\{ack(?:nowledg(?:e)?ments?)?\}|\\(?:sub)*section\*?\s*\{\s*Acknowledg|\\acknowledg/i.test(t);
      if (!hasAck && /\\documentclass/.test(t)) {
        if (inputs.ack && inputs.ack.trim()) {
          const re = new RegExp(BIBLIO.source, 'g'); let m, at = -1;
          while ((m = re.exec(t))) if (!isCommented(t, m.index)) { at = m.index; break; }
          if (at >= 0) {
            const neurips = /neurips|nips/i.test(t.slice(0, 4000));
            const block = neurips ? `\\begin{ack}\n${inputs.ack.trim()}\n\\end{ack}\n\n` : `\\section*{Acknowledgments}\n${inputs.ack.trim()}\n\n`;
            t = t.slice(0, at) + block + t.slice(at);
            add({ rule: 'ack', level: 'block', label: 'Acknowledgments added', detail: 'Inserted before the bibliography.', status: 'fixed' });
          } else add({ rule: 'ack', level: 'check', label: 'Acknowledgments not inserted', detail: 'No bibliography command found in this file. Add them by hand.', status: 'manual' });
        } else add({ rule: 'ack', level: 'note', label: 'No acknowledgments section', detail: 'Venues usually allow them in the camera-ready version. Type the text under "Acknowledgments" to insert it.', status: 'info' });
      }
      if (/\\iclr\w*|\\usepackage(?:\[[^\]]*\])?\{iclr/i.test(t) && !/^[^%\n]*\\iclrfinalcopy/m.test(t) && /\\usepackage(?:\[[^\]]*\])?\{iclr[^}]*\}/i.test(t)) {
        t = t.replace(/(\\usepackage(?:\[[^\]]*\])?\{iclr[^}]*\})/i, '$1\n\\iclrfinalcopy');
        add({ rule: 'class-option', level: 'block', label: 'ICLR final copy was off', detail: 'Added \\iclrfinalcopy after the style package.', status: 'fixed' });
      }
    }
    // placeholders that are left (not fixable without your input)
    for (const [re, label] of PLACEHOLDERS) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of t.matchAll(g)) {
        if (role === 'tex' && isCommented(t, m.index)) continue;
        if (/author-block/.test(label)) continue;
        add({ rule: 'placeholder', level: 'check', label, detail: 'Still in the file. Replace it by hand.', line: lineOf(t, m.index), status: 'manual', excerpt: lineText(t, m.index).trim().slice(0, 120) });
      }
    }
    if (/(^|\/)(LICENSE|LICENCE|COPYING)[^/]*$/i.test(path)) for (const m of t.matchAll(/Copyright[^\n]*\bAnonymous\b[^\n]*/gi)) add({ rule: 'placeholder', level: 'check', label: 'Licence names Anonymous', detail: 'Put the copyright holder back.', line: lineOf(t, m.index), status: 'manual' });
    out.push(t === orig ? f : { path, bytes: enc.encode(t) });
  }
  return { files: out, findings, links };
}

// PDFs in camera-ready mode: only read, never changed
export function reversePdfFindings({ pages }) {
  const out = [];
  pages.forEach((raw, i) => {
    const flat = raw.replace(/\s+/g, ' ');
    for (const [re, label] of [[/\bAnonymous (?:authors?|submission|institution)\b/i, 'Anonymous author block in the PDF'], [/\bPaper under double-blind review\b/i, 'Double-blind review footer in the PDF'], [/\bUnder review (?:as a|at|for)\b/i, 'Under-review footer in the PDF'], [/\bANONYMIZED\b/, 'ANONYMIZED marker in the PDF'], [/anonymous\.4open\.science|anonymous\.invalid/i, 'Anonymized link in the PDF']]) {
      const m = re.exec(flat);
      if (m) out.push({ scope: 'pdf', rule: 'placeholder', level: 'block', label, detail: `Page ${i + 1}. Rebuild the PDF from the camera-ready source.`, page: i + 1, status: 'manual', excerpt: flat.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30) });
    }
  });
  return out;
}
