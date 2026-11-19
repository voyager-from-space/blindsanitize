# blindsanitize

Check and fix a double-blind submission before you send it. Drop the LaTeX source zip, the compiled PDF and the supplementary archive in one go. blindsanitize shows what would reveal the authors, puts the venue's own quoted rule beside each item, and gives you cleaned copies. A camera-ready switch reverses it for the final version.

Live: https://voyager-from-space.github.io/blindsanitize/

Everything runs in the browser tab. Nothing is uploaded. There is no server and no account.

## What it checks and fixes

| Where | Fixed in your copy | Reported for you to decide |
|---|---|---|
| LaTeX source | author block (to "Anonymous authors"), `\thanks`, `\affiliation`, `\email`, `\orcid`, `hyperref` `pdfauthor` keys, acknowledgments, comments (names and emails inside kept comments are blanked), links to your own repo or page, links to file hosts that track opens, typed institution or handle terms, class options (`acmart` anonymous), `.git`, `.github`, editor junk, `.log` and `.aux` files, JPEG and PNG metadata including GPS, metadata in PDF figures | first person next to your own citation, "we previously showed", names in running text, grants, links to other repositories, your own bib entries (kept on purpose) |
| PDF | Info fields, XMP, attachments, annotation authors and review comments, link annotations naming you, JPEG EXIF/XMP/IPTC inside the PDF, unreachable objects left behind | names, emails, ORCID iDs, links and an acknowledgments heading in the page text (fix in the source and rebuild) |
| Supplementary zip or tar.gz | `.git`, `__MACOSX`, `__pycache__`, notebook and Office metadata, licence copyright holder, `CITATION.cff` author list, names in docs, JPEG/PNG metadata | author lines, emails and paths in code (never rewritten), strings in binary files, credentials |

Camera-ready mode finds what is still anonymized (`Anonymous authors`, `ANONYMIZED`, anonymous links, `review` style options) and puts back the author block, links and acknowledgments you type. NeurIPS gets an `ack` environment, others a starred section.

"Build and check the PDF" compiles the cleaned source in the tab with TeX Live as WebAssembly (from the maketitle-assets site, about 190 MB the first time) and runs the PDF checks on the PDF it produced.

## Venue rules

Quotes come from the venues' own pages and every quote has a link: RTAS 2026, ACL Rolling Review, NeurIPS 2026, ICLR 2027, ICML 2026. `scripts/check-venues.mjs` re-fetches each page and fails if a quote is no longer on it. Pages change each cycle: open the link before you submit. Not affiliated with any venue. Sources and how each was read: `research/venue-sources.md`.

## Limits

- It is a heuristic scan, not a guarantee. A person should read the final files.
- Names and self-reference phrases are matched by pattern. A name that is also a common word will produce false alarms. A self-reference in unusual wording will be missed.
- It cannot see text inside images, faces, screenshots, writing style, well-known prior systems that point to a group, or anything outside the files you drop.
- PDF text is not rewritten. It is reported, and you fix it in the source.
- A build here is evidence, not proof: the venue's own TeX Live can differ.
- Encrypted PDFs are reported and left as they are.
- `.bib` files are never blinded (RTAS: "Do not blind references").

## Develop

```
node scripts/make-fixtures.mjs     # planted-leak fixtures into test/fixtures and site/sample
node --test test/core.test.mjs     # unit tests
node scripts/verify.mjs            # acceptance checks in headless Chrome (see .cursor/skills/verify-blindsanitize/SKILL.md)
bash scripts/check-identity.sh     # denylist
```

The site is static: `site/` is served as is, with no build step.

## Licences

blindsanitize is MIT. Bundled: JSZip (dual MIT or GPLv3, used under MIT, `site/vendor/jszip-LICENSE.md`), pdf-lib 1.17.1 (MIT, with pako, tslib and others, `site/vendor/pdf-lib-LICENSES.md`), pdf.js 6.5.438 (Apache-2.0, `site/vendor/pdfjs-LICENSE.txt`) and IBM Plex Sans/Mono (SIL Open Font License 1.1, `site/fonts/OFL.txt`). The checker, TeX tokeniser, PDF pass, tar reader and camera-ready logic are original. Some zip, PDF-metadata and image-scrubbing helpers are reused from the author's own papershed (MIT).

Not bundled: the build check loads BusyTeX and TeX Live from maketitle-assets at run time. BusyTeX is AGPL-3.0 and TeX Live packages keep their own licences; none of that code is in this repository.
