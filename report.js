import { VENUES, rulesFor, desk } from './venues.js';

export const SCOPES = [['source', 'LaTeX source'], ['pdf', 'PDF'], ['supp', 'Supplementary archive']];
export const LEVEL_RANK = { block: 0, check: 1, note: 2 };

export function summarize(findings) {
  const s = {};
  for (const [k] of SCOPES) s[k] = { block: 0, check: 0, note: 0, fixed: 0, manual: 0, total: 0 };
  for (const f of findings) {
    const c = s[f.scope]; if (!c) continue;
    c.total++; c[f.level]++;
    if (f.status === 'fixed') c.fixed++; else if (f.status === 'manual') c.manual++;
  }
  // "open" = still needs you and is not a plain note
  for (const k of Object.keys(s)) s[k].open = findings.filter((f) => f.scope === k && f.status === 'manual' && f.level !== 'note').length;
  s.open = findings.filter((f) => f.status === 'manual' && f.level !== 'note').length;
  s.fixed = findings.filter((f) => f.status === 'fixed').length;
  return s;
}

export function reportText(run) {
  const { mode, venue, findings, limits, names } = run;
  const v = VENUES[venue] || VENUES.any;
  const sum = summarize(findings);
  const L = [];
  L.push(`blindsanitize report (${mode === 'camera' ? 'camera-ready mode' : 'submit mode'})`);
  L.push(`Venue: ${v.label}${v.page ? ' - ' + v.page : ''}`);
  L.push(`Result: ${sum.fixed} fixed in the copies you downloaded, ${sum.open} still need you.`);
  L.push('This is a heuristic scan, not a guarantee. A person reads the final files before they are sent.');
  L.push('Names and terms you typed are never written here. Excerpts show the surroundings with the match hidden.');
  L.push('');
  for (const [k, label] of SCOPES) {
    const list = findings.filter((f) => f.scope === k).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
    if (!list.length) continue;
    L.push(`== ${label} (${list.length}) ==`);
    for (const f of list) {
      L.push(`[${f.status === 'fixed' ? 'FIXED' : f.status === 'manual' ? 'NEEDS YOU' : 'INFO'}] ${f.label}${f.file ? ' - ' + f.file : ''}${f.line ? ':' + f.line : ''}${f.page ? ' (page ' + f.page + ')' : ''}`);
      if (f.detail) L.push('    ' + f.detail);
      if (f.excerpt) L.push('    ' + f.excerpt);
      if (mode !== 'camera') for (const r of rulesFor(venue, f.rule).slice(0, 1)) L.push(`    ${v.label}: "${r.quote}" ${r.url}`);
    }
    L.push('');
  }
  if (limits && limits.length) { L.push('== Size ==', ...limits.map((l) => '    ' + l), ''); }
  L.push('Not checked: writing style, well-known prior systems or datasets that point to a group, text inside images, faces or screenshots, and anything outside the files you dropped.');
  return L.join('\n');
}
