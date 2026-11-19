// Static server for local testing: node scripts/serve.mjs <dir> <port>. Sends the content types a browser needs for ES modules and wasm.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
const [dir, port] = [process.argv[2] || 'site', Number(process.argv[3] || 4190)];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.zip': 'application/zip', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain' };
http.createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dir, p);
  try { const st = statSync(f); if (!st.isFile()) throw 0; res.writeHead(200, { 'Content-Length': st.size, 'Content-Type': types[extname(f)] || 'application/octet-stream' }); createReadStream(f).pipe(res); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/ from ${dir}`));
