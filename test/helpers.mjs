import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
globalThis.JSZip = require('../site/vendor/jszip.min.js');
globalThis.PDFLib = require('../site/vendor/pdf-lib.min.js');
const { readUpload } = await import('../site/archive.js');
export const F = new URL('./fixtures/', import.meta.url).pathname;
export const load = (name) => readUpload(name, new Uint8Array(readFileSync(F + name)));
export const NAMES = 'Ada Example', OTHERS = 'Acme Lab\nadaexample';
