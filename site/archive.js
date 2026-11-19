// Reading and writing archives in the tab: .zip (JSZip), .tar and .tar.gz/.tgz (our own small tar reader and writer,
// gzip through the browser's DecompressionStream / CompressionStream).

const dec = new TextDecoder(), enc = new TextEncoder();
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

export const isPdfBytes = (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const isZip = (b) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
const isTar = (b) => b.length > 262 && dec.decode(b.subarray(257, 262)) === 'ustar';

async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const oct = (b, a, n) => parseInt(dec.decode(b.subarray(a, a + n)).replace(/\0.*$/, '').trim() || '0', 8);
const cstr = (b, a, n) => dec.decode(b.subarray(a, a + n)).replace(/\0.*$/, '');

export function untar(b) {
  const files = [];
  let off = 0, longName = null, pax = null;
  while (off + 512 <= b.length) {
    if (b.subarray(off, off + 512).every((x) => x === 0)) break;
    let name = cstr(b, off, 100);
    const size = oct(b, off + 124, 12), type = String.fromCharCode(b[off + 156] || 48);
    const prefix = cstr(b, off + 345, 155);
    if (prefix && /^ustar/.test(cstr(b, off + 257, 6))) name = prefix + '/' + name;
    const data = b.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = cstr(data, 0, data.length); continue; }
    if (type === 'x' || type === 'g') { const m = /\d+ path=([^\n]+)\n/.exec(dec.decode(data)); if (type === 'x' && m) pax = m[1]; continue; }
    if (longName) { name = longName; longName = null; }
    if (pax) { name = pax; pax = null; }
    if (type === '0' || type === '\0' || type === '7') files.push({ path: name.replace(/^\.\//, ''), bytes: data.slice() });
  }
  return files;
}

export function tar(files) {
  const parts = [];
  const hdr = (name, size) => {
    const h = new Uint8Array(512);
    const put = (s, a, n) => h.set(enc.encode(s).subarray(0, n), a);
    if (enc.encode(name).length > 100) throw new Error('A path in this archive is longer than 100 bytes: ' + name.slice(0, 40) + '\u2026');
    put(name, 0, 100); put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
    put(size.toString(8).padStart(11, '0') + '\0', 124, 12); put('00000000000\0', 136, 12);
    h.fill(0x20, 148, 156); h[156] = 48; put('ustar\0', 257, 6); put('00', 263, 2);
    const sum = h.reduce((a, x) => a + x, 0);
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return h;
  };
  for (const f of files) { parts.push(hdr(f.path, f.bytes.length), f.bytes, new Uint8Array((512 - (f.bytes.length % 512)) % 512)); }
  parts.push(new Uint8Array(1024));
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}

// { kind: 'zip' | 'tgz' | 'tar' | 'pdf' | 'other', files: [{path, bytes}] }
export async function readUpload(name, bytes) {
  if (isPdfBytes(bytes)) return { kind: 'pdf', name, bytes, files: [] };
  if (isGzip(bytes)) {
    const t = await gunzip(bytes);
    if (isTar(t)) return { kind: 'tgz', name, bytes, files: untar(t).filter((f) => f.path && !f.path.endsWith('/')) };
    return { kind: 'other', name, bytes, files: [] };
  }
  if (isZip(bytes)) {
    const z = await JSZip.loadAsync(bytes);
    const files = [];
    for (const e of Object.values(z.files)) if (!e.dir) files.push({ path: e.name, bytes: await e.async('uint8array') });
    return { kind: 'zip', name, bytes, files };
  }
  if (isTar(bytes)) return { kind: 'tar', name, bytes, files: untar(bytes) };
  return { kind: 'other', name, bytes, files: [] };
}

// source = has a \documentclass in a .tex file. supp = any other archive. pdf = a PDF. A second source-like archive is supp.
export function classify(uploads) {
  const out = { source: null, pdf: null, supp: [], other: [], extraPdfs: [] };
  for (const u of uploads) {
    if (u.kind === 'pdf') { if (!out.pdf) out.pdf = u; else out.extraPdfs.push(u); continue; }
    if (u.kind === 'other') { out.other.push(u); continue; }
    const hasRoot = u.files.some((f) => /\.(tex|ltx)$/i.test(f.path) && /^[^%\n]*\\documentclass/m.test(dec.decode(f.bytes.subarray(0, 200000))));
    if (hasRoot && !out.source) out.source = u; else out.supp.push(u);
  }
  return out;
}

// deterministic output: sorted paths, fixed timestamps, no zip comment, no extra attributes
export async function writeZip(files, comment = '') {
  const z = new JSZip();
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) z.file(f.path, f.bytes, { date: FIXED_DATE, createFolders: false, unixPermissions: 0o644 });
  return new Uint8Array(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX', comment }));
}
export async function writeTgz(files) { return gzip(tar([...files].sort((a, b) => (a.path < b.path ? -1 : 1)))); }
