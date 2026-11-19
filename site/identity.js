// Identity terms: the names, institutions, handles and project names the user types. We search for them (and a few
// spellings of each) in every text file, file name, PDF text and PDF link.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Two lists: author names (also matched as "Last, First", "F. Last" and the surname alone, marked weaker) and everything else
// (institutions, handles, project names, matched exactly). One pattern per spelling. Names with two or more words also match "Last, First", "F. Last" and the surname alone (marked weaker).
export function buildTerms(names, others = '') {
  const out = [];
  const seen = new Set();
  const add = (text, source, weak = false, isName = false) => {
    const t = text.trim();
    if (t.length < 3) return;
    const k = fold(t).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    // letters on both sides break the match, so "Rao" does not match inside "Prao" but does in "Rao's"
    // "Acme Lab" also matches acme-lab, acme_lab, acme.lab and acmelab: host names, handles and file names drop the space
    const body = esc(fold(t)).replace(/\s+/g, '[\\s._-]*');
    out.push({ text: t, source, weak, isName, re: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu') });
  };
  for (const line of String(names || '').split(/[\n;]+/)) {
    const t = line.trim();
    if (!t) continue;
    add(t, t, false, true);
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const last = words[words.length - 1], first = words[0];
      add(`${last}, ${first}`, t, false, true);
      add(`${last}, ${first[0]}.`, t, false, true);
      add(`${first[0]}. ${last}`, t, false, true);
      add(`${first[0]}.${last}`, t, false, true);
      add(last, t, true, true);
    }
  }
  for (const line of String(others || '').split(/[\n;]+/)) add(line, line.trim(), false, false);
  return out;
}

// returns [{ term, index, length, weak, text }] for one string. Matching is done on an accent-folded copy of the same length.
export function findTerms(terms, text) {
  if (!terms.length || !text) return [];
  const f = foldKeepLength(text);
  const hits = [];
  for (const t of terms) {
    t.re.lastIndex = 0;
    for (const m of f.matchAll(t.re)) hits.push({ term: t, index: m.index, length: m[0].length, weak: t.weak, text: text.slice(m.index, m.index + m[0].length) });
  }
  // strong spellings win over weak ones at the same place
  hits.sort((a, b) => a.index - b.index || Number(a.weak) - Number(b.weak) || b.length - a.length);
  const kept = [];
  for (const h of hits) if (!kept.some((k) => h.index < k.index + k.length && h.index + h.length > k.index)) kept.push(h);
  return kept;
}

// remove combining marks one character at a time so offsets stay valid
function foldKeepLength(s) {
  let out = '';
  for (const ch of s) {
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out += base.length === ch.length ? base : base.length ? base[0].padEnd(ch.length, ' ') : ' '.repeat(ch.length);
  }
  return out;
}

export const lineOf = (text, index) => { let n = 1; for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++; return n; };
export const lineText = (text, index) => { const a = text.lastIndexOf('\n', index - 1) + 1; let b = text.indexOf('\n', index); if (b < 0) b = text.length; return hideAll(text.slice(a, b)); };

// Terms to hide in every excerpt, set once per run. An excerpt shows the surroundings of a finding, so any other name,
// email or term inside those surroundings is hidden too.
let ACTIVE = [];
export const setActiveTerms = (terms) => { ACTIVE = terms; };
const BAR = '\u2588\u2588\u2588';
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
// hide = ranges to blank in s: every email, every term, and any extra ranges given; overlapping ranges merge into one bar
function blank(s, extra = []) {
  const r = [...extra];
  for (const m of s.matchAll(EMAIL)) r.push([m.index, m.index + m[0].length]);
  for (const h of findTerms(ACTIVE, s)) r.push([h.index, h.index + h.length]);
  r.sort((x, y) => x[0] - y[0]);
  let out = '', pos = 0, cur = null;
  const flush = () => { if (cur) { out += s.slice(pos, cur[0]) + BAR; pos = cur[1]; cur = null; } };
  for (const x of r) { if (cur && x[0] <= cur[1]) cur[1] = Math.max(cur[1], x[1]); else { flush(); cur = [x[0], x[1]]; } }
  flush();
  return out + s.slice(pos);
}
export const hideAll = (s) => blank(s);
export function excerpt(text, index, length, radius = 36) {
  let a = Math.max(0, index - radius), b = Math.min(text.length, index + length + radius);
  while (a > 0 && !/\s/.test(text[a - 1])) a--; // never cut a word in half: half an email would slip past the hider
  while (b < text.length && !/\s/.test(text[b])) b++;
  const flat = text.slice(a, b).replace(/\s/g, ' '); // same length as the slice, so offsets still line up
  return (a > 0 ? '\u2026' : '') + blank(flat, [[index - a, index - a + length]]) + (b < text.length ? '\u2026' : '');
}
