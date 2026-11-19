// Submit mode over one archive (the LaTeX source zip, or the supplementary archive): scan, fix what is safe, report the rest.
import { stripComments, scrubJpeg, scrubPng, isJunk, scanText } from './reuse.js';
import { findTerms, lineOf, lineText, excerpt } from './identity.js';
import { classifyUrl, URL_RE, trimUrl, ANON_PLACEHOLDER } from './links.js';
import { fixClassOptions, fixAuthors, fixAck, fixLinks, scanTexLeft, fixOtherTerms, isCommented, commands } from './tex.js';

const dec = new TextDecoder('utf-8', { fatal: true }), enc = new TextEncoder();
const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
const mask3 = () => '\u2588\u2588\u2588'; // identity text is never shown, not even its first letters

const TEX = /\.(tex|ltx|sty|cls|clo|def)$/i;
const COMMENTED = /\.(tex|ltx|sty|cls|clo)$/i;
const BIB = /\.bib$/i;
const CODE = /\.(py|r|m|jl|sh|bash|zsh|js|ts|tsx|jsx|c|cc|cpp|cu|h|hpp|java|go|rs|rb|php|pl|lua|ipynb|sql|scala|kt|swift|ps1|bat|cmake|mk|makefile)$|(^|\/)(Makefile|Dockerfile)$/i;
const IMG = /\.(jpe?g|png)$/i;
const OFFICE = /\.(docx|xlsx|pptx|docm|xlsm|pptm|odt|ods|odp)$/i;
const NESTED = /\.(zip|tar|tgz|gz|bz2|xz|7z|rar|jar|whl)$/i;
const LICENSE = /(^|\/)(LICENSE|LICENCE|COPYING|NOTICE)[^/]*$/i;
const SCM = /(^|\/)(\.git|\.github|\.gitmodules|\.hg|\.svn)(\/|$)/;
const MORE_JUNK = /(^|\/)(__pycache__|\.ipynb_checkpoints|\.Rproj\.user|\.pytest_cache|\.mypy_cache|\.venv|venv|node_modules|\.tox|\.eggs|[^/]*\.egg-info)\/|\.(pyc|pyo)$|(^|\/)(\.Rhistory|\.RData|\.env|\.python-version)$/i;
const PATHS = /(\/home\/|\/Users\/|C:\\\\?Users\\\\?|C:\/Users\/)([^\/\\\s"'`<>:]+)/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
const CODE_AUTHOR = [/(?:__author__|__maintainer__|__email__)\s*=\s*['"][^'"\n]+['"]/g, /^\s*(?:#|\/\/|\*|--|%)\s*(?:@?author|written by|created by|maintainer|contact)\b.*$/gim, /\bauthors?\s*[:=]\s*[\[{"'][^\n]{3,}/gi, /"(?:author|maintainers?|contributors?)"\s*:\s*[\["{][^\n]*/gi];

export const roleOf = (path) => (TEX.test(path) ? 'tex' : BIB.test(path) ? 'bib' : CODE.test(path) ? 'code' : 'doc');

function sniffText(bytes) {
  if (bytes.length > 12 * 1024 * 1024) return null;
  const head = bytes.subarray(0, 8000);
  for (const b of head) if (b === 0) return null;
  try { return dec.decode(bytes); } catch { return null; }
}

// emails and absolute paths, shared by every text role
function fixEmailsAndPaths(text, role, add, ext) {
  let t = text;
  t = t.replace(PATHS, (all, pre, user, idx) => {
    if (/^(user|username|you|name|me|runner|ubuntu|vsts|root|\$USER|%USERNAME%|<[^>]*>)$/i.test(user)) return all;
    add({ rule: 'path', level: 'check', label: 'Absolute path with a user name', detail: `${pre}${mask3(user)} \u2192 ${pre}user`, line: lineOf(text, idx), status: 'fixed' });
    return pre + 'user';
  });
  if (role === 'code') {
    for (const m of t.matchAll(EMAIL)) add({ rule: 'email', level: 'block', label: 'Email address in code', detail: m[0].replace(/^[^@]*/, '\u2588\u2588\u2588'), line: lineOf(t, m.index), status: 'manual', excerpt: lineText(t, m.index).trim().slice(0, 120) });
    return t;
  }
  t = t.replace(EMAIL, (all, idx) => {
    if (/\.(png|jpe?g|pdf|tex|bib|gif|svg)$/i.test(all) || /@(example\.(com|org|net)|anonymous\.invalid)$/i.test(all) || /^anonymous@/i.test(all)) return all;
    if (role === 'tex' && isCommented(t, idx)) return all;
    add({ rule: 'email', level: 'block', label: 'Email address', detail: 'replaced with anonymous@anonymous.invalid', line: lineOf(text, idx), status: 'fixed' });
    return 'anonymous@anonymous.invalid';
  });
  return t;
}

function scanIdentityManual(path, text, role, ctx, add) {
  for (const h of findTerms(ctx.terms, text)) {
    if (role === 'tex' && isCommented(text, h.index)) continue;
    add({ rule: role === 'code' || ctx.kind === 'supp' ? 'supp-identity' : 'identity', level: 'block', label: h.weak ? 'Your surname' : h.term.isName ? 'Your name' : 'A name you gave', detail: role === 'code' ? 'In code. Replace it by hand: an automatic change could break the program.' : 'Needs you.', line: lineOf(text, h.index), status: 'manual', excerpt: excerpt(text, h.index, h.length) });
  }
}

function fixDocTerms(text, ctx, add, role) {
  const hits = findTerms(ctx.terms, text).filter((h) => !h.weak);
  if (!hits.length) return text;
  let t = text;
  for (const h of [...hits].sort((a, b) => b.index - a.index)) {
    add({ rule: 'supp-identity', level: 'block', label: h.term.isName ? 'Your name' : 'A name you gave', detail: `\u201c${mask3(h.text)}\u201d replaced with ANONYMIZED.`, line: lineOf(text, h.index), status: 'fixed' });
    t = t.slice(0, h.index) + 'ANONYMIZED' + t.slice(h.index + h.length);
  }
  return t;
}

async function scrubOffice(bytes, path, add) {
  let z;
  try { z = await JSZip.loadAsync(bytes); } catch { add({ rule: 'office-meta', level: 'check', label: 'Office file could not be opened', detail: path, status: 'manual' }); return null; }
  let changed = 0;
  const found = [];
  const swap = async (name, edits) => {
    const f = z.file(name); if (!f) return;
    let s = await f.async('string'), o = s;
    for (const [re, to, label] of edits) s = s.replace(re, (all, ...a) => { const val = a[0]; if (val && String(val).trim()) found.push(label); return typeof to === 'function' ? to(all, ...a) : to; });
    if (s !== o) { z.file(name, s); changed++; }
  };
  const names = Object.keys(z.files);
  await swap('docProps/core.xml', [[/(<dc:creator>)([^<]*)(<\/dc:creator>)/g, (a, p, v, q) => p + q, 'creator'], [/(<cp:lastModifiedBy>)([^<]*)(<\/cp:lastModifiedBy>)/g, (a, p, v, q) => p + q, 'last modified by']]);
  await swap('docProps/app.xml', [[/(<Company>)([^<]*)(<\/Company>)/g, (a, p, v, q) => p + q, 'company'], [/(<Manager>)([^<]*)(<\/Manager>)/g, (a, p, v, q) => p + q, 'manager']]);
  await swap('meta.xml', [[/(<meta:initial-creator>)([^<]*)(<\/meta:initial-creator>)/g, (a, p, v, q) => p + q, 'creator'], [/(<dc:creator>)([^<]*)(<\/dc:creator>)/g, (a, p, v, q) => p + q, 'creator']]);
  for (const n of names) if (/^(word\/(document|comments|footnotes|endnotes)\.xml|xl\/(comments\d*|threadedComments\/[^/]+)\.xml|ppt\/comments\/[^/]+\.xml|xl\/persons\/[^/]+\.xml)$/.test(n))
    await swap(n, [[/(\sw:author=")([^"]*)(")/g, (a, p, v, q) => p + 'Author' + q, 'tracked-change or comment author'], [/(\sw:initials=")([^"]*)(")/g, (a, p, v, q) => p + 'A' + q, 'initials'], [/(<author>)([^<]*)(<\/author>)/g, (a, p, v, q) => p + 'Author' + q, 'comment author'], [/(\sdisplayName=")([^"]*)(")/g, (a, p, v, q) => p + 'Author' + q, 'person']]);
  for (const n of names) if (/^docProps\/thumbnail\./.test(n)) { z.remove(n); changed++; found.push('thumbnail'); }
  if (!changed) return null;
  add({ rule: 'office-meta', level: 'block', label: 'Office document properties', detail: `${[...new Set(found)].join(', ') || 'properties'} cleared.`, status: 'fixed' });
  const out = new Uint8Array(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', platform: 'UNIX' }));
  return out;
}

function fixNotebook(text, add) {
  let nb;
  try { nb = JSON.parse(text); } catch { return text; }
  const md = nb.metadata || {};
  const gone = ['authors', 'colab', 'widgets', 'author', 'copyright'].filter((k) => k in md);
  if (!gone.length) return text;
  for (const k of gone) delete md[k];
  add({ rule: 'notebook-meta', level: 'block', label: 'Notebook metadata', detail: `${gone.join(', ')} removed from the notebook header.`, status: 'fixed' });
  return JSON.stringify(nb, null, 1) + '\n';
}

export async function processBundle(rawFiles, ctx, kind) {
  const findings = [], removed = [], out = [];
  const seen = new Set();
  const base = { scope: kind === 'source' ? 'source' : 'supp' };
  const stats = { files: rawFiles.length, texFiles: 0, commentsRemoved: 0 };
  const addFor = (file) => (f) => {
    const k = [f.rule, file, f.line, f.detail, f.label].join('|');
    if (seen.has(k)) return;
    seen.add(k);
    findings.push({ ...base, file, ...f });
  };
  const context = { ...ctx, kind };
  const texts = new Map(), bibs = new Map();
  const scmSeen = { git: false };
  const buildJunk = [];

  for (const f of rawFiles) {
    const path = f.path, add = addFor(path);
    // ---- files that should not be in the archive ----
    if (SCM.test(path)) {
      if (/(^|\/)\.git\/config$/.test(path)) {
        const s = sniffText(f.bytes) || '';
        const urls = [...s.matchAll(/url\s*=\s*(\S+)/g)].map((m) => m[1]), who = [...s.matchAll(/(?:name|email)\s*=\s*(.+)/g)].map((m) => m[1]);
        add({ rule: 'scm', level: 'block', label: '.git folder with your repository address', detail: `${urls.length ? 'Remote: ' + urls.map((u) => { const c = classifyUrl(u.replace(/^git@([^:]+):/, 'https://$1/'), ctx.terms); return c.host + (c.owner ? '/' + mask3(c.owner) : ''); }).join(', ') + '. ' : ''}${who.length ? 'It also holds a user name or email. ' : ''}The folder was removed.`, status: 'fixed' });
        scmSeen.git = true;
      } else if (!scmSeen.git && /(^|\/)\.git\//.test(path)) { add({ rule: 'scm', level: 'block', label: '.git folder', detail: 'It holds the full history, with author names and emails. Removed.', status: 'fixed' }); scmSeen.git = true; }
      else if (/(^|\/)\.(github|gitmodules|hg|svn)/.test(path)) add({ rule: 'scm', level: 'check', label: 'Repository metadata', detail: 'Workflows, owners and submodule addresses name the group. Removed.', status: 'fixed' });
      removed.push({ path, why: 'repository metadata' });
      continue;
    }
    if (MORE_JUNK.test(path) || isJunk(path)) {
      if (/\.(log|aux|out|synctex(\.gz)?|fls|fdb_latexmk|toc|blg|bcf)$/i.test(path)) buildJunk.push(path);
      else add({ rule: 'junk', level: 'note', label: 'Editor or system file', detail: 'Removed: ' + path.split('/').pop(), status: 'fixed' });
      removed.push({ path, why: 'build or system file' });
      continue;
    }
    // ---- file names ----
    if (findTerms(ctx.terms, path).length) add({ rule: 'filename', level: 'check', label: 'A name you gave is in a file name', detail: 'Rename it and fix what refers to it.', status: 'manual', excerpt: path.replace(/[^/]*$/, (n) => mask3(n)) });

    // ---- binary kinds ----
    if (IMG.test(path)) {
      const r = /\.png$/i.test(path) ? scrubPng(f.bytes) : scrubJpeg(f.bytes);
      if (r && r.bytes.length < f.bytes.length) {
        const fd = r.found; const what = [fd.exif && 'EXIF', fd.xmp && 'XMP', fd.iptc && 'IPTC', fd.comment && 'comment', ...new Set(fd.chunks || [])].filter(Boolean);
        add({ rule: 'media-meta', level: fd.gps ? 'block' : 'check', label: fd.gps ? 'Photo with a GPS position' : 'Image metadata', detail: `${what.join(', ')} removed${fd.gps ? ` (position ${fd.gps.lat?.toFixed(3)}, ${fd.gps.lon?.toFixed(3)})` : ''}.`, status: 'fixed' });
        out.push({ path, bytes: r.bytes });
      } else out.push(f);
      continue;
    }
    if (/\.pdf$/i.test(path)) {
      const r = ctx.scrubPdf ? await ctx.scrubPdf(f.bytes, path) : null;
      if (r && r.findings) for (const x of r.findings) add({ ...x, scope: base.scope });
      out.push(r && r.bytes ? { path, bytes: r.bytes } : f);
      continue;
    }
    if (OFFICE.test(path)) { const o = await scrubOffice(f.bytes, path, add); out.push(o ? { path, bytes: o } : f); continue; }
    if (NESTED.test(path)) { add({ rule: 'nested', level: 'note', label: 'Archive inside the archive', detail: 'Not opened. Check it by hand.', status: 'manual' }); out.push(f); continue; }

    let text = sniffText(f.bytes);
    if (text === null) {
      // other binary: look for strings we can recognise, but do not change it
      if (f.bytes.length < 60 * 1024 * 1024) {
        const s = latin1(f.bytes);
        const pathHit = [...s.matchAll(PATHS)].find((m) => !/^(user|username|root|runner)$/i.test(m[2]));
        const idHits = findTerms(ctx.terms, s);
        const mails = [...s.matchAll(EMAIL)].filter((m) => !/\.(png|jpe?g|pdf)$/i.test(m[0]));
        if (pathHit || idHits.length || mails.length) add({ rule: 'binary', level: 'check', label: 'Text that identifies you inside a binary file', detail: [pathHit && `a path with a user name (${pathHit[1]}${mask3(pathHit[2])})`, idHits.length && `${idHits.length} of your names or terms`, mails.length && `${mails.length} email address${mails.length > 1 ? 'es' : ''}`].filter(Boolean).join(', ') + '. Not changed: rebuild the file without them.', status: 'manual' });
      }
      out.push(f); continue;
    }

    // ---- text ----
    const role = roleOf(path);
    let t = text;
    if (role === 'tex') {
      stats.texFiles++;
      if (ctx.stripComments && COMMENTED.test(path)) {
        const r = stripComments(t);
        const n = r.stats.comments + r.stats.commentEnvs + r.stats.iffalse;
        if (n) {
          stats.commentsRemoved += n;
          const gone = r.removed.join('\n');
          for (const h of findTerms(ctx.terms, gone)) add({ rule: 'identity', level: 'block', label: 'Your name in a comment', detail: 'Removed with the comments. Reviewers can read comments in source.', status: 'fixed', excerpt: excerpt(gone, h.index, h.length) });
          for (const m of gone.matchAll(EMAIL)) add({ rule: 'email', level: 'block', label: 'Email in a comment', detail: 'Removed with the comments.', status: 'fixed' });
          t = r.text;
        }
      } else if (!ctx.stripComments) {
        // comments stay, but a name or an email inside one is still readable by reviewers: blank those words only
        t = t.split('\n').map((line, ln) => {
          const m = /(^|[^\\])%/.exec(line); if (!m) return line;
          const at = m.index + m[1].length, head = line.slice(0, at), com = line.slice(at);
          let out = com, n = 0;
          for (const h of findTerms(ctx.terms, com).filter((x) => !x.weak).sort((a, b) => b.index - a.index)) { out = out.slice(0, h.index) + 'ANONYMIZED' + out.slice(h.index + h.length); n++; }
          out = out.replace(EMAIL, () => { n++; return 'ANONYMIZED'; });
          if (n) add({ rule: 'identity', level: 'block', label: 'Name or email in a comment', detail: `${n} replaced with ANONYMIZED. The comment stays.`, line: ln + 1, status: 'fixed' });
          return head + out;
        }).join('\n');
      }
      t = fixClassOptions(t, add);
      t = fixAuthors(t, add);
      t = fixAck(t, add, ctx.venue);
      t = fixLinks(t, ctx, add, role);
      t = fixOtherTerms(t, ctx.terms, add);
      t = fixEmailsAndPaths(t, role, add);
      scanTexLeft(path, t, ctx, add, role);
      for (const m of scanText(path, t)) if (m.kind === 'credential') add({ rule: 'secret', level: 'block', label: m.label, detail: 'Looks like a credential.', line: m.line, status: 'manual' });
      texts.set(path, t);
    } else if (role === 'bib') {
      t = fixLinks(t, ctx, add, role);
      t = fixEmailsAndPaths(t, role, add);
      bibs.set(path, text);
    } else if (role === 'doc') {
      t = fixLinks(t, ctx, add, role);
      if (LICENSE.test(path)) t = t.replace(/(Copyright\s*(?:\(c\)|\u00a9)?\s*(?:\d{4}(?:\s*[-,]\s*\d{4})*)\s+)([^\n]+)/gi, (all, pre, who, idx) => { if (/^anonymous/i.test(who)) return all; add({ rule: 'license', level: 'block', label: 'Copyright holder in the licence', detail: `\u201c${mask3(who)}\u201d \u2192 Anonymous. Put the name back for the camera-ready version.`, line: lineOf(text, idx), status: 'fixed' }); return pre + 'Anonymous'; });
      if (/(^|\/)CITATION\.cff$/i.test(path)) t = t.replace(/^authors:[ \t]*\n(?:[ \t]+[^\n]*\n|[ \t]*\n)*/m, () => { add({ rule: 'author-file', level: 'block', label: 'Author list in CITATION.cff', detail: 'The authors: block was replaced with one entry, \u201cAnonymous\u201d. Put the real list back for the camera-ready version.', status: 'fixed' }); return 'authors:\n  - name: "Anonymous"\n'; });
      else if (/(^|\/)(AUTHORS|CONTRIBUTORS|MAINTAINERS|CODEOWNERS)(\.[a-z]+)?$/i.test(path) || /(^|\/)\.zenodo\.json$/i.test(path)) add({ rule: 'author-file', level: 'block', label: 'A file that lists people', detail: 'It exists to name authors or owners. Remove it or empty it by hand.', status: 'manual' });
      t = fixDocTerms(t, ctx, add, role);
      t = fixEmailsAndPaths(t, role, add);
      for (const re of CODE_AUTHOR) for (const m of t.matchAll(re)) add({ rule: 'code-author', level: 'check', label: 'Author line', detail: 'Names the author or maintainer.', line: lineOf(t, m.index), status: 'manual', excerpt: m[0].trim().slice(0, 120) });
      for (const m of scanText(path, t)) if (m.kind === 'credential') add({ rule: 'secret', level: 'block', label: m.label, detail: 'Looks like a credential.', line: m.line, status: 'manual' });
    } else {
      // code
      if (/\.ipynb$/i.test(path)) t = fixNotebook(t, add);
      t = fixLinks(t, ctx, add, 'code');
      t = fixEmailsAndPaths(t, 'code', add);
      scanIdentityManual(path, t, 'code', context, add);
      for (const re of CODE_AUTHOR) for (const m of t.matchAll(re)) add({ rule: 'code-author', level: 'check', label: 'Author line', detail: 'Names the author or maintainer.', line: lineOf(t, m.index), status: 'manual', excerpt: m[0].trim().slice(0, 120) });
      for (const m of scanText(path, t)) if (m.kind === 'credential') add({ rule: 'secret', level: 'block', label: m.label, detail: 'Looks like a credential.', line: m.line, status: 'manual' });
      for (const m of t.matchAll(URL_RE)) { const c = classifyUrl(trimUrl(m[0]), ctx.terms); if ((c.kind === 'repo' || c.kind === 'personal') && !c.mine) add({ rule: 'own-repo', level: 'check', label: 'Link to a public repository or page', detail: `${c.host}${c.owner ? '/' + c.owner : ''}: yours?`, line: lineOf(t, m.index), status: 'manual', excerpt: trimUrl(m[0]) }); }
    }
    out.push(t === text ? f : { path, bytes: enc.encode(t) });
  }
  if (buildJunk.length) addFor(buildJunk[0])({ rule: 'junk', level: 'check', label: 'Build files', detail: `${buildJunk.length} file${buildJunk.length > 1 ? 's' : ''} (${[...new Set(buildJunk.map((p) => p.split('.').pop()))].join(', ')}). Logs and synctex files hold absolute paths with your user name. Removed.`, status: 'fixed' });

  // ---- self-citations (need the .bib and the final .tex) ----
  if (kind === 'source') {
    const selfKeys = new Map();
    for (const [bp, bt] of bibs) {
      for (const m of bt.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)) {
        const start = m.index + m[0].length;
        const next = bt.indexOf('\n@', start);
        const body = bt.slice(start, next < 0 ? bt.length : next);
        const au = /\bauthor\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/i.exec(body);
        if (au && findTerms(ctx.terms.filter((x) => x.isName), au[1]).length) { selfKeys.set(m[1], { file: bp, line: lineOf(bt, m.index) }); addFor(bp)({ rule: 'bib-self', level: 'note', label: 'Your own paper in the bibliography', detail: `Entry ${m[1]}. Fine if cited in the third person. ${ctx.venue === 'rtas2026' ? 'RTAS: keep author names visible in references.' : 'Do not blind the entry unless the venue says so.'}`, line: lineOf(bt, m.index), status: 'info' }); }
      }
    }
    if (selfKeys.size) for (const [tp, tt] of texts) {
      for (const m of tt.matchAll(/\\(?:cite[a-z]*|parencite|textcite|autocite|citep|citet)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g)) {
        if (isCommented(tt, m.index)) continue;
        const keys = m[1].split(',').map((k) => k.trim());
        const hit = keys.find((k) => selfKeys.has(k));
        if (!hit) continue;
        const before = tt.slice(Math.max(0, m.index - 120), m.index).split(/[.!?]\s/).pop();
        if (/\b(we|our|ours|us|my|I)\b/.test(before)) addFor(tp)({ rule: 'selfcite', level: 'block', label: 'First person next to a citation of your own paper', detail: `Cites ${hit}. Write "Smith et al. [n] showed" instead of "we showed [n]".`, line: lineOf(tt, m.index), status: 'manual', excerpt: lineText(tt, m.index).trim().slice(0, 140) });
      }
    }
  }
  return { files: out, findings, removed, stats };
}
