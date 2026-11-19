# blindsanitize spec (Thu 19 Nov 2026)

## Sharpened (what a professional would do, rawest material, methods, outside check)

- **What a pro does that the brief doesn't ask:** read the venue's own words first and tie every finding to a quoted rule with a link; test against the actual failure (an author reported a desk rejection in ARR March 2026 over a footnote link: https://www.reddit.com/r/LanguageTechnology/comments/1sd0vs9/arr_march_2026_disk_rejected/); check the *PDF reviewers will open*, not just the source, because link annotations, attachments, comment authors and JPEG EXIF survive in a PDF whose text looks clean.
- **Rawest material:** the venues' CFP and author-guideline pages (RTAS 2026, ARR, NeurIPS 2026 handbook, ICLR 2027, ICML 2026), the PDF file format itself (Info dict, XMP, annotations, EmbeddedFiles, DCT streams), the OOXML parts inside docx/xlsx/pptx, `.git/config`, notebook JSON; not blog summaries.
- **Methods and tools:** deterministic scanners over bytes; pdf.js (Apache-2.0) for text, links and outline; pdf-lib (MIT) to rewrite; our own TeX tokenising for author blocks, `\thanks`, ack sections and class options; BusyTeX to rebuild the PDF from the cleaned source and scan *that*.
- **What shows it is right, other than us:** poppler (`pdftotext`, `pdfinfo`, `pdfdetach`, `pdfimages`), an independent zlib-inflate string scan of every output, `unzip`/`tar` on the downloaded files, and a round-trip (cleaned zip fed back through camera-ready mode).

## Five-line spec and done-when checks

1. **Job:** drop the source zip, the PDF and the supplementary archive (any mix, one drop) and see what would reveal the authors, with the venue's quoted rule next to each finding; get cleaned copies back. Done when: 3 files in 1 action produce a verdict with per-file counts and a cleaned download for each.
2. **Source and supplement:** author blocks, `\thanks`, acknowledgments, grants, own-repo and tracking links, first-person self-references, self-citations, identity terms you type, paths, `.git`, notebooks, Office metadata, EXIF. Done when: every planted leak in the fixtures is reported, every safe fix leaves 0 hits in an independent scan of the output, and unfixable ones say "needs you".
3. **PDF:** metadata (Info, XMP), text and link annotations, attachments, comment authors, image EXIF, outline. Done when: planted strings are 0 in raw and inflated bytes after the fix, poppler opens and renders it, and text hits say "fix in the source".
4. **Camera-ready mode:** find and flip the leftovers (anonymous option, "Anonymous" author block, anonymized links), insert the real author block, links and acknowledgments you type. Done when: cleaned zip → camera-ready returns the original author block and links and no placeholder remains.
5. **Honest and fast:** all in the tab, no upload; heavy parts (pdf.js, TeX Live) load only when needed; each rule cites a real page; a "what this can't see" box. Done when: no request leaves the page except the lazy assets, the verify script passes on the live URL, the denylist is clean, and the demo is 20 to 40 s.

## Main screen: two variants prototyped (proto/a.html, proto/b.html)

- A: choose mode, choose venue, type names, three separate drop slots, press Check.
- B: one drop zone that sorts the files, a verdict at once, then optional venue, names and camera-ready switches that re-check live.
- Measured with Playwright (`proto/count.mjs`, one action = one file set, click, fill or select): A needs 6 actions to the first verdict, B needs 1 (3 if you also set venue and names). **Kept: B.**
