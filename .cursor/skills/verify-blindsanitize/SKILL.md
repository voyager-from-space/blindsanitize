---
name: verify-blindsanitize
description: Run the full blindsanitize acceptance check (local or on the live URL) and read the result. Use before any push, before calling a change done, and after every deploy.
---

# Verify blindsanitize

`scripts/verify.mjs` drives headless Chrome with real file inputs and real downloads, then checks every output with tools that are not the code under test: `unzip -t`, `tar -xzf`, poppler (`pdfinfo`, `pdfdetach`, `pdfimages`, `pdftotext`) and a zlib inflate of every PDF object.

## Run

```bash
node --test test/core.test.mjs                      # unit tests of the pure modules
node scripts/make-fixtures.mjs                      # only when fixtures change; output is deterministic
node scripts/verify.mjs                             # local (starts its own static server)
BUILD=1 node scripts/verify.mjs                     # adds the in-browser TeX build (local asset copy in ../maketitle-assets)
BASE_URL=https://voyager-from-space.github.io/blindsanitize/ SHOTS=screenshots/live node scripts/verify.mjs   # live
BUILD=1 BASE_URL=... node scripts/verify.mjs        # live, with the real build (downloads about 190 MB)
node scripts/check-venues.mjs                       # every quoted venue rule still on its page
bash scripts/check-identity.sh                      # denylist on the repository
```

## What each numbered group proves

1. Page loads, no console errors, no request outside the site, nothing heavy fetched at load, first view under 1.5 MB.
2. Lazy loading (no PDF library for a PDF-free zip) and the negative control: a clean blind source gives 0 fixed, 0 needing you, byte-identical output.
3. One drop of three files is sorted; metadata is stripped even with no names typed.
4. Source fixes, checked in the unzipped download: author block, `pdfauthor`, acknowledgments, comments, links, bib untouched, junk, JPEG, PNG, PDF figure, determinism.
5. PDF fixes, checked with poppler and a zlib scan of non-page objects (orphan objects count: pdf-lib keeps unreachable objects unless they are pruned).
6. Supplementary zip and tar.gz in and out, notebook, docx, licence, CITATION.cff, code never rewritten.
7. Report holds no typed text; venue rules shown with https links for every venue; strip-comments toggle.
8. Camera-ready round trip and a NeurIPS `[review]` to `[final]` flip.
9. Broken PDF and unsupported file give a plain message.
10. Sample button, no sideways scroll at 390 px.
11. Denylist on the repo and (live) on the served files; venue quotes still on their pages.
12. (BUILD=1) The cleaned source builds in the browser; the built PDF is scanned.

## Rules

- A failing check is a finding. Fix the cause, not the check. If a slice fails verification 3 times, stop and report.
- Never call a change shipped until the live run passes.
- The report written by the tool must never contain a typed name, handle, institution or email, in any form.
