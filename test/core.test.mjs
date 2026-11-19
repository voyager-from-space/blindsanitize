// Unit tests for the pure modules. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, NAMES, OTHERS } from './helpers.mjs';
import { buildTerms, findTerms, setActiveTerms, hideAll, excerpt } from '../site/identity.js';
import { processBundle } from '../site/bundle.js';
import { classifyUrl, ANON_PLACEHOLDER } from '../site/links.js';
import { fixAuthors, fixAck, fixClassOptions, matchBrace } from '../site/tex.js';
import { reverseBundle } from '../site/reverse.js';
import { writeZip } from '../site/archive.js';
import { VENUES, rulesFor } from '../site/venues.js';
import { summarize, reportText } from '../site/report.js';

const terms = buildTerms(NAMES, OTHERS); setActiveTerms(terms);
const collect = () => { const f = []; return [f, (x) => f.push(x)]; };
const dec = (b) => new TextDecoder().decode(b);

test('names: variants, accent folding, weak surname, no match inside longer words', () => {
  const t = buildTerms('José Ramírez', '');
  const hit = (s) => findTerms(t, s).map((h) => h.text);
  assert.deepEqual(hit('by Jose Ramirez today'), ['Jose Ramirez']);
  assert.deepEqual(hit('Ramírez, J. wrote'), ['Ramírez, J.']);
  assert.equal(findTerms(t, 'Ramirez et al.')[0].weak, true);
  assert.equal(findTerms(t, 'Ramirezes').length, 0);
});
test('others: Acme Lab also matches acme-lab, acme_lab and acmelab', () => {
  for (const s of ['Acme Lab', 'acme-lab.org', 'acme_lab', 'acmelab']) assert.equal(findTerms(terms, s).length, 1, s);
});
test('hideAll and excerpt never show a typed term or an email, even half of one', () => {
  const s = 'mail ada@acme-lab.example now, Ada Example said so';
  assert.ok(!/ada|acme|example/i.test(hideAll(s)));
  assert.ok(!/ada|acme|example/i.test(excerpt(s, 5, 3, 4)));
});
test('links: own repo vs other repo vs cloud vs anonymous', () => {
  assert.equal(classifyUrl('https://github.com/adaexample/widgets', terms).mine, true);
  assert.equal(classifyUrl('https://github.com/pytorch/pytorch', terms).mine, false);
  assert.equal(classifyUrl('https://www.dropbox.com/s/x', terms).kind, 'cloud');
  assert.equal(classifyUrl('https://anonymous.4open.science/r/x', terms).kind, 'anon');
  assert.equal(ANON_PLACEHOLDER, 'https://anonymous.invalid/removed');
});
test('matchBrace skips escaped braces and comments', () => {
  const t = String.raw`\author{A \} % } not the end
B}x`;
  const i = t.indexOf('{'); assert.equal(t[matchBrace(t, i)], '}'); assert.equal(t.slice(matchBrace(t, i) + 1), 'x');
});
test('fixAuthors keeps a commented \\author alone and replaces the live one', () => {
  const [f, add] = collect();
  const out = fixAuthors('% \\author{Old}\n\\author{Ada Example \\and Bo}\n', add);
  assert.ok(out.includes('% \\author{Old}') && out.includes('\\author{Anonymous authors}') && !out.includes('Bo'));
  assert.equal(f.filter((x) => x.rule === 'author-block').length, 1);
});
test('fixAck removes both section and environment forms, not a section named Acknowledgment in a comment', () => {
  const [, add] = collect();
  const a = fixAck('x\n\\section*{Acknowledgments}\nThanks.\n\\bibliography{r}\n', add);
  assert.ok(!/Thanks/.test(a) && a.includes('\\bibliography{r}'));
  const b = fixAck('x\n\\begin{ack}\nThanks.\n\\end{ack}\ny\n', add);
  assert.ok(!/Thanks/.test(b) && b.includes('y'));
  assert.ok(fixAck('% \\section*{Acknowledgments}\n', add).includes('%'));
});
test('fixClassOptions makes acmart anonymous and leaves others alone', () => {
  const [, add] = collect();
  assert.match(fixClassOptions('\\documentclass[sigconf]{acmart}\n', add), /anonymous/);
});
test('source bundle: sample is cleaned, bib untouched, report holds no typed text', async () => {
  const u = await load('sample-source.zip');
  const r = await processBundle(u.files, { terms, venue: 'arr', stripComments: true, scrubPdf: null }, 'source');
  const main = dec(r.files.find((f) => f.path === 'main.tex').bytes);
  assert.match(main, /\\author\{Anonymous authors\}/);
  assert.ok(!/Ada Example|adaexample|dropbox/.test(main));
  const bib = r.files.find((f) => f.path === 'refs.bib').bytes, orig = u.files.find((f) => f.path === 'refs.bib').bytes;
  assert.deepEqual([...bib], [...orig]);
  const rep = reportText({ mode: 'submit', venue: 'arr', findings: r.findings.map((f) => ({ ...f, scope: 'source' })), limits: [], names: null });
  assert.ok(!/ada example|adaexample/i.test(rep));
});
test('clean control: nothing to fix, nothing needs you', async () => {
  const u = await load('clean-source.zip');
  const r = await processBundle(u.files, { terms, venue: 'any', stripComments: true, scrubPdf: null }, 'source');
  const s = summarize(r.findings.map((f) => ({ ...f, scope: 'source' })));
  assert.equal(s.open, 0); assert.equal(s.fixed, 0);
});
test('camera mode restores author block, links and acknowledgments, and flips review to final', async () => {
  const u = await load('anon-source.zip');
  const r = reverseBundle(u.files, { terms }, { authorBlock: 'Ada Example', ack: 'Thanks to Acme Lab.', links: { 'https://anonymous.invalid/removed': 'https://example.org/code' }, venue: 'neurips2026' }, 'source');
  const t = dec(r.files.find((f) => f.path === 'main.tex').bytes);
  assert.match(t, /\[final\]\{neurips_2026\}/); assert.match(t, /\\author\{Ada Example\}/); assert.match(t, /https:\/\/example\.org\/code/); assert.match(t, /\\begin\{ack\}/);
});
test('writeZip is deterministic', async () => {
  const files = [{ path: 'b.txt', bytes: new TextEncoder().encode('b') }, { path: 'a.txt', bytes: new TextEncoder().encode('a') }];
  const x = await writeZip(files), y = await writeZip([...files].reverse());
  assert.deepEqual([...x], [...y]);
});
test('every venue rule has an https url and a quote; rulesFor maps finding ids', () => {
  for (const [id, v] of Object.entries(VENUES)) for (const r of [...v.rules, ...(v.camera || [])]) { assert.ok(r.url.startsWith('https://'), id); assert.ok(r.quote.length > 20, id + r.id); }
  assert.ok(rulesFor('rtas2026', 'ack').length === 1);
});
