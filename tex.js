// LaTeX-aware helpers and the submit-mode fixes for .tex files. Our own tokenising; no code from other anonymizers.
import { ANON_PLACEHOLDER, URL_RE, trimUrl, classifyUrl } from './links.js';
import { findTerms, lineOf, lineText, excerpt } from './identity.js';

export function isCommented(text, idx) {
  const ls = text.lastIndexOf('\n', idx - 1) + 1;
  for (let i = ls; i < idx; i++) { if (text[i] === '\\') { i++; continue; } if (text[i] === '%') return true; }
  return false;
}
export function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === '%') { const nl = text.indexOf('\n', i); if (nl < 0) return -1; i = nl; continue; } // an unescaped % starts a comment
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}
const mask3 = () => '\u2588\u2588\u2588'; // identity text is never shown, not even its first letters

// every use of \name[opt]{arg}{arg}... outside comments: [{ start, end, args: [[a,b]] }]; end is just after the last argument
export function commands(text, name, nargs = 1) {
  const re = new RegExp(String.raw`\\${name}(?![a-zA-Z@])\*?`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    if (isCommented(text, m.index)) continue;
    let i = m.index + m[0].length;
    const args = [];
    for (let k = 0; k < nargs; k++) {
      const ws = /^\s*/.exec(text.slice(i))[0].length;
      let j = i + ws;
      while (text[j] === '[') { const e = text.indexOf(']', j); if (e < 0) break; j = e + 1 + (/^\s*/.exec(text.slice(e + 1))[0].length); }
      if (text[j] !== '{') break;
      const e = matchBrace(text, j);
      if (e < 0) break;
      args.push([j + 1, e]);
      i = e + 1;
    }
    if (args.length === nargs) out.push({ start: m.index, end: i, args });
  }
  return out;
}
const applyEdits = (text, edits) => { let t = text; for (const e of [...edits].sort((a, b) => b.start - a.start)) t = t.slice(0, e.start) + e.with + t.slice(e.end); return t; };

// ---- document class and style options ----
const STYLE_PKG = /^(neurips|nips|icml|iclr|acl|colm|emnlp|naacl|coling|eacl|tacl|aaai|ijcai|cvpr|iccv|eccv|wacv|rtas|acmart|ieeetran)/i;
const DEANON_OPT = new Set(['final', 'accepted', 'camera', 'camera-ready', 'cameraready', 'preprint', 'published']);
const REVIEW_STYLE = /^(acl|emnlp|naacl|coling|eacl|tacl|cvpr|iccv|eccv|wacv)/i; // these ship a [review] option; [final] swaps for it
export function usesClass(text) {
  const m = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(text);
  return m ? { opts: m[1] || '', name: m[2].trim(), index: m.index, length: m[0].length } : null;
}

export function fixClassOptions(text, emit) {
  let t = text;
  // \usepackage[final]{neurips_2026}, [accepted]{icml2026}, [final]{acl}
  t = t.replace(/\\usepackage\s*\[([^\]]*)\]\s*\{([^}]*)\}/g, (all, opts, pkg, idx) => {
    if (isCommented(text, idx) || !STYLE_PKG.test(pkg.trim())) return all;
    const list = opts.split(',').map((o) => o.trim()).filter(Boolean);
    const bad = list.filter((o) => DEANON_OPT.has(o.toLowerCase()));
    if (!bad.length) return all;
    let keep = list.filter((o) => !DEANON_OPT.has(o.toLowerCase()));
    if (REVIEW_STYLE.test(pkg.trim()) && !keep.includes('review')) keep = ['review', ...keep];
    emit({ rule: 'class-option', level: 'block', label: 'Style option that shows authors', detail: `[${bad.join(', ')}] on ${pkg.trim()} prints the author block. Now ${keep.length ? '[' + keep.join(',') + ']' : 'the default (blind) setting'}.`, line: lineOf(text, idx), status: 'fixed' });
    return `\\usepackage${keep.length ? '[' + keep.join(',') + ']' : ''}{${pkg}}`;
  });
  // acmart: add `anonymous`
  const dc = usesClass(t);
  if (dc && /^acmart$/i.test(dc.name) && !/(^|,)\s*anonymous\s*(,|$)/.test(dc.opts)) {
    const opts = dc.opts ? dc.opts + ',anonymous' : 'anonymous';
    emit({ rule: 'class-option', level: 'block', label: 'acmart without the anonymous option', detail: 'acmart prints authors unless the class option anonymous is set. Added it.', line: lineOf(t, dc.index), status: 'fixed' });
    t = t.slice(0, dc.index) + `\\documentclass[${opts}]{${dc.name}}` + t.slice(dc.index + dc.length);
  }
  // ICLR's \iclrfinalcopy
  t = t.replace(/^([^%\n]*)(\\iclrfinalcopy)(?![a-zA-Z])/gm, (all, pre, cmd, idx) => {
    emit({ rule: 'class-option', level: 'block', label: 'ICLR final-copy switch is on', detail: '\\iclrfinalcopy prints the author block. Commented it out.', line: lineOf(text, idx), status: 'fixed' });
    return pre + '%' + cmd;
  });
  return t;
}

// ---- author block, footnotes, affiliations ----
const REMOVE_ONE = ['thanks', 'affiliation', 'email', 'orcid', 'institute', 'address', 'authornote', 'IEEEauthorblockA', 'IEEEauthorblockN', 'icmlcorrespondingauthor0'];
export function fixAuthors(text, emit) {
  let t = text;
  // 1) the first \author keeps a placeholder; later ones go
  const authors = commands(t, 'author');
  if (authors.length) {
    const edits = [];
    authors.forEach((c, i) => {
      const [a, b] = c.args[0];
      const body = t.slice(a, b);
      if (i === 0) {
        if (/^\s*anonymous/i.test(body) && !/\\(thanks|And|and|texttt)/.test(body) && body.length < 40) return;
        edits.push({ start: a, end: b, with: 'Anonymous authors' });
        emit({ rule: 'author-block', level: 'block', label: 'Author block', detail: `\\author{${mask3(body)}} replaced with \u201cAnonymous authors\u201d.`, line: lineOf(t, c.start), status: 'fixed' });
      } else {
        edits.push({ start: c.start, end: c.end, with: '' });
        emit({ rule: 'author-block', level: 'block', label: 'Extra \\author', detail: `\\author{${mask3(body)}} removed.`, line: lineOf(t, c.start), status: 'fixed' });
      }
    });
    t = applyEdits(t, edits);
  }
  // 2) one-argument commands
  for (const name of ['thanks', 'affiliation', 'email', 'orcid', 'institute', 'address', 'authornote']) {
    const cs = commands(t, name);
    if (!cs.length) continue;
    const label = name === 'thanks' ? 'Footnote with \\thanks' : name === 'affiliation' || name === 'institute' || name === 'address' ? 'Affiliation' : name === 'email' ? 'Email in the author block' : name === 'orcid' ? 'ORCID' : 'Author note';
    for (const c of cs) emit({ rule: name === 'thanks' ? 'thanks' : 'author-block', level: 'block', label, detail: `\\${name}{${mask3(t.slice(...c.args[0]))}} removed.`, line: lineOf(t, c.start), status: 'fixed' });
    t = applyEdits(t, cs.map((c) => ({ start: c.start, end: c.end, with: '' })));
  }
  // 3) ICML-style macros with two arguments
  for (const name of ['icmlauthor', 'icmlaffiliation', 'icmlcorrespondingauthor']) {
    const cs = commands(t, name, 2);
    for (const c of cs) emit({ rule: 'author-block', level: 'block', label: 'ICML author macro', detail: `\\${name}{${mask3(t.slice(...c.args[0]))}}{\u2026} removed.`, line: lineOf(t, c.start), status: 'fixed' });
    t = applyEdits(t, cs.map((c) => ({ start: c.start, end: c.end, with: '' })));
  }
  // 4) hyperref and pdfTeX metadata keys that put an author into the PDF
  t = t.replace(/(pdfauthor|pdfcreator|pdfproducer)\s*=\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[^,\]\}\n]+)\s*,?/g, (all, key, val, idx) => {
    if (isCommented(text, idx)) return all;
    emit({ rule: 'pdf-key', level: 'block', label: 'PDF author set in LaTeX', detail: `${key}=${mask3(val.replace(/^\{|\}$/g, ''))} removed, so the built PDF does not carry it.`, line: lineOf(text, idx), status: 'fixed' });
    return '';
  });
  t = t.replace(/\\pdfinfo\s*\{([^{}]*)\}/g, (all, inner, idx) => {
    if (isCommented(text, idx) || !/\/(Author|Creator)\b/.test(inner)) return all;
    emit({ rule: 'pdf-key', level: 'block', label: 'PDF author set in LaTeX', detail: '\\pdfinfo with /Author or /Creator removed.', line: lineOf(text, idx), status: 'fixed' });
    return inner.replace(/\/(Author|Creator)\s*\((?:[^()\\]|\\.)*\)/g, '').trim() ? `\\pdfinfo{${inner.replace(/\/(Author|Creator)\s*\((?:[^()\\]|\\.)*\)/g, '')}}` : '';
  });
  return t;
}

// ---- acknowledgments ----
const AI_DISCLOSURE = /\b(generative|large language model|LLMs?|ChatGPT|GPT-?\d|Copilot|Claude|Gemini|AI (?:assistant|tool|system|writing)s?)\b/i;
const ACK_ENVS = ['ack', 'acknowledgments', 'acknowledgements', 'acknowledgment', 'acknowledgement', 'Acknowledgments', 'Acknowledgements', 'acks'];
export function fixAck(text, emit, venueId) {
  let t = text;
  const keepIfAI = venueId === 'arr';
  const decide = (body, line, kind) => {
    if (keepIfAI && AI_DISCLOSURE.test(body)) { emit({ rule: 'ack', level: 'note', label: 'Acknowledgments with an AI disclosure', detail: 'Kept: ARR allows an acknowledgments section that only discloses generative AI use. Check it has nothing else.', line, status: 'info' }); return false; }
    emit({ rule: 'ack', level: 'block', label: 'Acknowledgments', detail: `${kind} removed (${body.replace(/\s+/g, ' ').trim().length} characters).`, line, status: 'fixed' });
    return true;
  };
  for (const env of ACK_ENVS) {
    const re = new RegExp(String.raw`\\begin\s*\{${env}\*?\}([\s\S]*?)\\end\s*\{${env}\*?\}`, 'g');
    t = t.replace(re, (all, body, idx) => (isCommented(t, idx) || !decide(body, lineOf(t, idx), `\\begin{${env}} block`) ? all : ''));
  }
  for (const cs of [commands(t, 'acknowledgments'), commands(t, 'acknowledgements'), commands(t, 'acknowledgment')]) {
    const keep = [];
    const edits = [];
    for (const c of cs) { const body = t.slice(...c.args[0]); if (decide(body, lineOf(t, c.start), '\\acknowledgments{}')) edits.push({ start: c.start, end: c.end, with: '' }); else keep.push(c); }
    t = applyEdits(t, edits);
  }
  const head = /\\(?:sub)*section\*?\s*\{\s*Acknowledg(?:e)?ments?\s*\}|\\paragraph\*?\s*\{\s*Acknowledg(?:e)?ments?\.?\s*\}/g;
  let m;
  const edits = [];
  while ((m = head.exec(t))) {
    if (isCommented(t, m.index)) continue;
    const from = m.index + m[0].length;
    const stop = /\\(?:sub)*section\b|\\paragraph\b|\\bibliography(?:style)?\b|\\printbibliography|\\begin\s*\{thebibliography\}|\\appendix\b|\\end\s*\{document\}|\\clearpage|\\newpage|\\input\b|\\include\b/g;
    stop.lastIndex = from;
    const s = stop.exec(t);
    const to = s ? s.index : t.length;
    if (decide(t.slice(from, to), lineOf(t, m.index), 'Acknowledgments section')) edits.push({ start: m.index, end: to, with: '' });
  }
  return applyEdits(t, edits);
}

// ---- links ----
export function fixLinks(text, ctx, emit, role) {
  const { terms, venue } = ctx;
  return text.replace(URL_RE, (raw, idx) => {
    const url = trimUrl(raw), tail = raw.slice(url.length);
    const c = classifyUrl(url, terms);
    const line = lineOf(text, idx);
    if (c.kind === 'cloud') { emit({ rule: 'cloud-link', level: 'block', label: 'Link to a file host', detail: `${c.host} can show who opened the link. Replaced with ${ANON_PLACEHOLDER}. Host an anonymous copy instead.`, line, status: 'fixed' }); return ANON_PLACEHOLDER + tail; }
    if ((c.kind === 'repo' || c.kind === 'personal') && c.mine) { emit({ rule: 'own-repo', level: 'block', label: 'Link to your own page or repository', detail: `${c.host}/${mask3(c.owner)} matches a name you gave. Replaced with ${ANON_PLACEHOLDER}.`, line, status: 'fixed' }); return ANON_PLACEHOLDER + tail; }
    if (c.kind === 'mail') { emit({ rule: 'email', level: 'block', label: 'Email link', detail: 'mailto link replaced.', line, status: 'fixed' }); return 'mailto:anonymous@anonymous.invalid' + tail; }
    return raw;
  });
}

// what is left after the fixes: things we cannot or should not change on our own
export function scanTexLeft(path, text, ctx, emit, role) {
  const { terms, venue } = ctx;
  const seen = new Set();
  for (const m of text.matchAll(URL_RE)) {
    if (isCommented(text, m.index)) continue;
    const url = trimUrl(m[0]);
    const c = classifyUrl(url, terms);
    const line = lineOf(text, m.index), key = url;
    if (seen.has(key)) continue;
    if (c.kind === 'anon') { seen.add(key); emit({ rule: 'anon-link', level: 'note', label: 'Anonymized link', detail: `${c.host}: fine. Check that the anonymized copy has no names inside it.`, line, status: 'info' }); }
    else if (c.kind === 'repo' || c.kind === 'personal') { seen.add(key); emit({ rule: 'own-repo', level: 'check', label: 'Link to a public repository or personal page', detail: `${c.host}${c.owner ? '/' + c.owner : ''}. If this is yours, it names you. Cited work by others is fine.`, line, status: 'manual', excerpt: url }); }
    else if (c.kind === 'short') { seen.add(key); emit({ rule: 'url-any', level: 'check', label: 'Shortened link', detail: `${c.host} can log who clicks. Use the full address or an anonymous host.`, line, status: 'manual', excerpt: url }); }
    else if (venue === 'rtas2026' && c.kind === 'other') { seen.add(key); emit({ rule: 'url-any', level: 'check', label: 'Direct URL (RTAS asks for none to supplemental material)', detail: c.host, line, status: 'manual', excerpt: url }); }
  }
  // text that looks like grants and funding
  const GRANT = [/\b(?:grant|award|contract)\s*(?:no\.?|number|#|id)?\s*[:#]?\s*[A-Z]{1,6}[-\s]?\d[\w-]{3,}\b/g, /\b(?:supported|funded|sponsored)\s+(?:in\s+part\s+)?by\b/gi, /\b(?:NSF|NIH|DARPA|ERC|DFG|EPSRC|UKRI|JSPS|NSERC|ONR|AFOSR|ARO|DOE)\b[^.\n]{0,60}\d{4,}/g];
  for (const re of GRANT) for (const m of text.matchAll(re)) if (!isCommented(text, m.index)) emit({ rule: 'grant', level: 'check', label: 'Funding or grant text', detail: 'Grant numbers and funders can identify the group. Move it to the camera-ready version.', line: lineOf(text, m.index), status: 'manual', excerpt: excerpt(text, m.index, m[0].length) });
  // first-person references to earlier work
  const SELF = [/\b(?:in |as )?our (?:previous|prior|earlier|recent|past|preliminary|own)\s+(?:work|paper|papers|study|studies|publication|publications|system|systems|framework|model|models|method|methods|results|experiments)\b/gi,
    /\bwe (?:have )?(?:previously|recently|earlier|already)\s+(?:shown|showed|proposed|introduced|presented|published|developed|reported|demonstrated|released|built)\b/gi,
    /\b(?:our|my) (?:lab|laboratory|group|institute|university|department|company|team|school|center|centre)\b/gi,
    /\bthe authors['\u2019]? (?:own|previous|earlier|prior)\b/gi];
  for (const re of SELF) for (const m of text.matchAll(re)) if (!isCommented(text, m.index)) emit({ rule: 'selfref', level: 'check', label: 'First person about earlier work', detail: 'Write it in the third person ("Smith et al. showed\u2026").', line: lineOf(text, m.index), status: 'manual', excerpt: lineText(text, m.index).trim().slice(0, 140) });
  // your name in the prose
  for (const h of findTerms(terms, text)) {
    if (isCommented(text, h.index)) continue;
    const line = lineOf(text, h.index);
    if (h.term.isName) emit({ rule: 'identity', level: 'check', label: h.weak ? 'Your surname in the text' : 'Your name in the text', detail: 'Fine as a third-person citation of your own paper ("Rao et al. showed\u2026"). A leak anywhere else.', line, status: 'manual', excerpt: excerpt(text, h.index, h.length) });
  }
}

// terms that are not names (institutions, handles, project names) are replaced in .tex prose
export function fixOtherTerms(text, terms, emit) {
  const others = terms.filter((t) => !t.isName);
  if (!others.length) return text;
  let t = text;
  const KEYED = new Set(['cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'parencite', 'textcite', 'autocite', 'nocite', 'ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref', 'label', 'includegraphics', 'input', 'include', 'bibliography', 'usepackage', 'includepdf', 'graphicspath', 'bibliographystyle', 'addbibresource', 'documentclass']);
  const inKey = (idx) => { const ls = t.lastIndexOf('\n', idx - 1) + 1; const seg = t.slice(ls, idx); const o = seg.lastIndexOf('{'); if (o < 0 || seg.indexOf('}', o) >= 0) return false; const m = /\\([a-zA-Z]+)\*?(?:\[[^\]]*\])*$/.exec(seg.slice(0, o)); return !!m && KEYED.has(m[1]); };
  const hits = findTerms(others, t).filter((h) => !isCommented(t, h.index) && !inKey(h.index));
  if (!hits.length) return t;
  const edits = hits.map((h) => ({ start: h.index, end: h.index + h.length, with: 'ANONYMIZED' }));
  for (const h of hits) emit({ rule: 'identity', level: 'block', label: 'Institution, handle or project name', detail: `\u201c${mask3(h.text)}\u201d replaced with ANONYMIZED.`, line: lineOf(t, h.index), status: 'fixed' });
  return applyEdits(t, edits);
}
