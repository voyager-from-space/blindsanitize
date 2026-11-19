// Builds the planted-leak fixtures. All names here are invented: Ada Example, Bo Writer, Acme Lab, adaexample.
// Output: test/fixtures/*.zip|pdf|tar.gz and the same files copied to site/sample/ for the in-app sample.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const PDFLib = require('../site/vendor/pdf-lib.min.js');
const JSZip = require('../site/vendor/jszip.min.js');
const { PDFDocument, StandardFonts, PDFName, PDFString, PDFArray, PDFDict, rgb } = PDFLib;
const F = new URL('../test/fixtures/', import.meta.url).pathname;
const S = new URL('../site/sample/', import.meta.url).pathname;
mkdirSync(S, { recursive: true });
execFileSync('python3', [new URL('./make-photo.py', import.meta.url).pathname, F]);
const photo = readFileSync(F + 'photo.jpg'), diagram = readFileSync(F + 'diagram.png');
const FIXED = new Date(Date.UTC(2026, 0, 1));
const zipOf = async (files) => { const z = new JSZip(); for (const [p, c] of Object.entries(files)) z.file(p, c, { date: FIXED }); return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }); };

// ---- a figure PDF with metadata in compressed streams (pdf-lib writes object streams) ----
async function figurePdf() {
  const d = await PDFDocument.create();
  d.setAuthor('Ada Example'); d.setCreator('plotter at Acme Lab'); d.setProducer('plotter 1.0'); d.setTitle('figure');
  const p = d.addPage([200, 120]); p.drawText('plot', { x: 20, y: 60, size: 18 });
  return Buffer.from(await d.save({ useObjectStreams: true }));
}

// ---- the compiled paper, as reviewers would get it ----
async function paperPdf() {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  d.setAuthor('Ada Example'); d.setCreator('LaTeX with hyperref'); d.setProducer('pdfTeX at Acme Lab'); d.setTitle('Fast Widgets for Slow Machines'); d.setSubject('widgets'); d.setKeywords(['widgets', 'ada']);
  const page = d.addPage([612, 792]);
  const lines = ['Fast Widgets for Slow Machines', 'Ada Example, Bo Writer', 'Acme Lab, Springfield', 'ada@acme-lab.example', '',
    'Abstract. We make widgets fast. In our previous work we showed that widgets help.', 'Code: https://github.com/adaexample/widgets', 'Data: https://www.dropbox.com/s/abc123/data.zip', 'Baseline: https://github.com/pytorch/pytorch',
    '', 'Acknowledgments', 'We thank the Acme Lab staff.'];
  lines.forEach((t, i) => page.drawText(t, { x: 50, y: 740 - i * 22, size: i === 0 ? 18 : 11, font }));
  const link = (rect, uri) => { const a = d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) } }); return d.context.register(a); };
  const refs = [link([50, 650, 330, 662], 'https://github.com/adaexample/widgets'), link([50, 628, 330, 640], 'https://www.dropbox.com/s/abc123/data.zip'), link([50, 606, 330, 618], 'https://github.com/pytorch/pytorch'), link([50, 696, 230, 708], 'mailto:ada@acme-lab.example')];
  const note = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 700, 420, 720], Contents: PDFString.of('rewrite this'), T: PDFString.of('Ada Example') }));
  page.node.set(PDFName.of('Annots'), d.context.obj([...refs, note]));
  const img = await d.embedJpg(new Uint8Array(photo)); page.drawImage(img, { x: 50, y: 400, width: 160, height: 120 });
  await d.attach(new Uint8Array(Buffer.from('% notes by Ada Example\n')), 'notes-ada.tex', { mimeType: 'text/plain', description: 'ada notes' });
  // XMP packet with a creator name, as a stream on the catalog
  const xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Ada Example</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  const ms = d.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  d.catalog.set(PDFName.of('Metadata'), d.context.register(ms));
  return Buffer.from(await d.save({ useObjectStreams: true }));
}

const mainTex = String.raw`% Notes to self: Ada Example thinks reviewer 2 is Carl (ada@acme-lab.example)
\documentclass[11pt]{article}
\usepackage{graphicx}
\usepackage{url}
\usepackage[pdfauthor={Ada Example},pdftitle={Fast Widgets for Slow Machines}]{hyperref}
\title{Fast Widgets for Slow Machines}
\author{Ada Example\thanks{Supported by NSF grant CCF-1234567.} \and Bo Writer\\ Acme Lab, Springfield \\ \texttt{ada@acme-lab.example}}
\begin{document}
\maketitle
\begin{abstract}
We make widgets fast on slow machines.
\end{abstract}
\section{Introduction}
In our previous work \cite{example2024} we showed that widgets help. We previously showed that they scale.
Our code is at \url{https://github.com/adaexample/widgets} and the data is at \url{https://www.dropbox.com/s/abc123/data.zip?dl=0}.
The baseline is \url{https://github.com/pytorch/pytorch}. Our group at Acme Lab built the rig.
Example et al.~\cite{example2024} describe the method; Smith~\cite{smith2023} disagrees.
\begin{figure}\centering\includegraphics[width=.4\linewidth]{figures/photo.jpg}\includegraphics[width=.3\linewidth]{figures/plot.pdf}\end{figure}
\section*{Acknowledgments}
We thank the Acme Lab staff and the NSF (grant CCF-1234567).
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;
const refsBib = `@inproceedings{example2024,\n  author = {Example, Ada and Writer, Bo},\n  title = {Widgets in practice},\n  booktitle = {Proc. Widgets},\n  year = {2024}\n}\n@article{smith2023,\n  author = {Smith, Sam},\n  title = {Against widgets},\n  journal = {J. Widgets},\n  year = {2023}\n}\n`;
const gitConfig = '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:adaexample/widgets.git\n[user]\n\tname = Ada Example\n\temail = ada@acme-lab.example\n';
const pdfFig = await figurePdf();

const sourceFiles = {
  'main.tex': mainTex, 'refs.bib': refsBib, 'figures/photo.jpg': photo, 'figures/plot.pdf': pdfFig, 'figures/diagram.png': diagram,
  'notes.txt': 'Todo for Ada Example: rerun at Acme Lab, see /home/ada/runs/widgets.log\n',
  '.git/config': gitConfig, '.DS_Store': Buffer.from('Bud1 adaexample'), '__MACOSX/._main.tex': 'x',
  'main.log': 'This is pdfTeX, Version 3.14\n(/home/ada/papers/widgets/main.tex\n', 'main.aux': '\\relax\n',
};
const srcZip = await zipOf(sourceFiles);

// a blind submission with nothing planted: no finding may need the author
const cleanSource = await zipOf({
  'main.tex': String.raw`\documentclass{article}
\usepackage{url}
\title{A Note on Widgets}
\author{Anonymous authors}
\begin{document}
\maketitle
Smith et al.~\cite{smith2023} showed that widgets help. Code: \url{https://anonymous.4open.science/r/widgets-1234}.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`, 'refs.bib': `@article{smith2023,\n  author = {Smith, Sam},\n  title = {Widgets},\n  journal = {J. Widgets},\n  year = {2023}\n}\n` });

// an anonymized submission, as the camera-ready mode receives it
const anonSource = await zipOf({
  'main.tex': String.raw`\documentclass{article}
\usepackage[review]{neurips_2026}
\title{Fast Widgets for Slow Machines}
\author{Anonymous authors}
\begin{document}
\maketitle
Smith et al.~\cite{smith2023} showed that widgets help. Code: \url{https://anonymous.invalid/removed}.
\section{Conclusion}
Widgets are fast.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`, 'refs.bib': refsBib });

// supplementary archive
const docx = await zipOf({ '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  'docProps/core.xml': '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Ada Example</dc:creator><cp:lastModifiedBy>Ada Example</cp:lastModifiedBy><dc:title>results</dc:title></cp:coreProperties>',
  'docProps/app.xml': '<?xml version="1.0"?><Properties><Company>Acme Lab</Company></Properties>',
  'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:ins w:author="Ada Example" w:id="1"><w:r><w:t>hello</w:t></w:r></w:ins></w:body></w:document>' });
const notebook = JSON.stringify({ cells: [{ cell_type: 'code', source: ['import os\n', "print(os.listdir('/Users/ada/data'))"], outputs: [{ output_type: 'stream', name: 'stdout', text: ['/Users/ada/data/x.csv\n'] }], metadata: {}, execution_count: 1 }], metadata: { authors: [{ name: 'Ada Example' }], kernelspec: { name: 'python3' } }, nbformat: 4, nbformat_minor: 5 }, null, 1) + '\n';
const pickle = Buffer.concat([Buffer.from([0x80, 0x04, 0x95, 0, 0, 0, 0]), Buffer.from('/home/ada/proj/model.py Ada Example'), Buffer.from([0, 1, 2, 3])]);
const suppFiles = {
  'code/train.py': '__author__ = "Ada Example"\nimport os\nDATA = "/home/ada/data"\n# contact: ada@acme-lab.example\nprint("training")\n',
  'README.md': '# Widgets\nAuthor: Ada Example, Acme Lab. Repo: https://github.com/adaexample/widgets\n',
  'LICENSE': 'MIT License\n\nCopyright (c) 2026 Ada Example\n\nPermission is hereby granted...\n',
  'CITATION.cff': 'cff-version: 1.2.0\nauthors:\n  - family-names: Example\n    given-names: Ada\n',
  'analysis.ipynb': notebook, 'results.docx': docx, 'data/model.pkl': pickle, 'figures/photo.jpg': photo,
  '.git/config': gitConfig, '.github/workflows/ci.yml': 'name: ci\non: push\n# owner adaexample\n', '__MACOSX/._README.md': 'x', 'code/__pycache__/train.cpython-311.pyc': Buffer.from([0, 1, 2]),
};
const suppZip = await zipOf(suppFiles);
// the same archive as .tar.gz, made by the system tar so the reader is tested against a real tool
const tmp = F + '_tar/'; mkdirSync(tmp, { recursive: true });
const { rmSync } = await import('node:fs');
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
for (const [p, c] of Object.entries(suppFiles)) { const full = tmp + p; mkdirSync(full.replace(/\/[^/]*$/, ''), { recursive: true }); writeFileSync(full, c); }
execFileSync('tar', ['-czf', F + 'sample-supplementary.tar.gz', '-C', tmp, '.']);
rmSync(tmp, { recursive: true, force: true });

writeFileSync(F + 'anon-source.zip', anonSource); writeFileSync(F + 'sample-source.zip', srcZip); writeFileSync(F + 'clean-source.zip', cleanSource);
writeFileSync(F + 'sample-paper.pdf', await paperPdf()); writeFileSync(F + 'sample-supplementary.zip', suppZip); writeFileSync(F + 'figure-plot.pdf', pdfFig);
for (const n of ['sample-source.zip', 'sample-paper.pdf', 'sample-supplementary.zip']) copyFileSync(F + n, S + n);
console.log('fixtures written to', F);
