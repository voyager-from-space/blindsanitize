# Venue sources (fetched or read in search results on Thu 19 Nov 2026 IST)

Quotes in `site/venues.js` are copied from these pages. Where a page is dated or has a version, the check was made that day; venues change these pages each cycle.

| Venue | Page | How it was read |
|---|---|---|
| RTAS 2026 | https://2026.rtas.org/double-anonymous/ | opened with WebFetch, full text |
| ARR | https://aclrollingreview.org/cfp , https://aclrollingreview.org/authorchecklist | quoted in search results; ARR thread https://www.reddit.com/r/LanguageTechnology/comments/1sd0vs9/arr_march_2026_disk_rejected/ read in search |
| NeurIPS 2026 | https://neurips.cc/Conferences/2026/MainTrackHandbook , https://neurips.cc/public/guides/CodeSubmissionPolicy | quoted in search results |
| ICLR 2027 | https://www.iclr.cc/Conferences/2027/AuthorGuidelines | quoted in search results |
| ICML 2026 | https://icml.cc/Conferences/2026/AuthorInstructions , https://icml.cc/Conferences/2026/PeerReviewFAQ , https://media.icml.cc/Conferences/ICML2026/Styles/example_paper.pdf | quoted in search results |

`scripts/check-venues.mjs` (run by verify group 11) re-fetches each URL and checks every quote is on the page word for word. Result on Thu 19 Nov 2026, about 18:45 IST: 31 of 31 quotes found (RTAS 7, ARR 8, NeurIPS 7, ICLR 2, ICML 7 including limits). The "how it was read" column above is how each quote was first found; the re-fetch is what confirms it. The ARR desk-rejection anecdote on the start page is one author's report on Reddit (https://www.reddit.com/r/LanguageTechnology/comments/1sd0vs9/arr_march_2026_disk_rejected/), opened the same day; it is labelled as a report, not as ARR's statement.
