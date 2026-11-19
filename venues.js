// Venue rules. Every quote below was copied from the linked page on Thu 19 Nov 2026 (see research/venue-sources.md).
// Nothing here is a paraphrase presented as a quote. Rules we add ourselves are labelled "blindsanitize note" in rules.js, not here.
// `about` lists the finding rule ids a venue rule speaks to.

export const VENUES = {
  any: { label: 'Any double-blind venue', note: 'No venue picked. Findings show our own guidance. Check your venue\u2019s call for papers.', rules: [], limits: {} },
  rtas2026: {
    label: 'RTAS 2026', page: 'https://2026.rtas.org/double-anonymous/',
    rules: [
      { id: 'names', about: ['identity', 'author-block', 'pdf-names'], quote: 'PDFs must not include author names or affiliations.', url: 'https://2026.rtas.org/double-anonymous/' },
      { id: 'meta', about: ['pdf-meta', 'pdf-xmp', 'pdf-annot', 'pdf-attach', 'pdf-image-exif', 'media-meta'], quote: 'Remove metadata from the PDF that could reveal identity.', url: 'https://2026.rtas.org/double-anonymous/' },
      { id: 'ack', about: ['ack'], quote: 'Do not include acknowledgments (even anonymized ones) in submitted papers.', url: 'https://2026.rtas.org/double-anonymous/' },
      { id: 'third', about: ['selfref', 'selfcite'], quote: 'Refer to your own prior work in the third person (e.g., not \u201cwe\u201d or \u201cour\u201d).', url: 'https://2026.rtas.org/double-anonymous/' },
      { id: 'refs', about: ['bib-self'], quote: 'Do not blind references: keep author names and titles visible for all citations.', url: 'https://2026.rtas.org/double-anonymous/' },
      { id: 'urls', about: ['own-repo', 'url-any'], quote: 'Do not include direct URLs.', url: 'https://2026.rtas.org/double-anonymous/', scope: 'Under \u201cOnline Appendices and Supplemental Materials\u201d' },
      { id: 'desk', about: ['*'], quote: 'Violations may result in desk rejection without review.', url: 'https://2026.rtas.org/double-anonymous/' },
    ],
    limits: {},
  },
  arr: {
    label: 'ACL Rolling Review (ARR)', page: 'https://aclrollingreview.org/cfp',
    rules: [
      { id: 'names', about: ['identity', 'author-block', 'pdf-names'], quote: 'Papers must not include authors\u2019 names and affiliations.', url: 'https://aclrollingreview.org/cfp' },
      { id: 'selfref', about: ['selfref', 'selfcite'], quote: 'self-references that reveal the authors\u2019 identities, e.g., \u201cWe previously showed (Smith, 1991)\u2026\u201d must be avoided. Instead, use citations such as \u201cSmith previously showed (Smith, 1991)\u2026\u201d', url: 'https://aclrollingreview.org/cfp' },
      { id: 'supp', about: ['own-repo', 'supp-identity'], quote: 'Supplementary materials, including any links to repositories, should also be anonymized.', url: 'https://aclrollingreview.org/cfp' },
      { id: 'cloud', about: ['cloud-link'], quote: 'Links to file hosting services that can track downloads, such as Dropbox, are not allowed.', url: 'https://aclrollingreview.org/cfp' },
      { id: 'ack', about: ['ack'], quote: 'The acknowledgements section contains only disclosures of generative AI use.', url: 'https://aclrollingreview.org/authorchecklist', scope: 'Author checklist' },
      { id: 'tracking', about: ['cloud-link', 'own-repo'], quote: 'There are no links to non-anonymous repositories or services like Dropbox that may track who opened the link.', url: 'https://aclrollingreview.org/authorchecklist', scope: 'Author checklist' },
      { id: 'desk', about: ['*'], quote: 'Submissions that violate these requirements will be desk rejected.', url: 'https://aclrollingreview.org/cfp' },
    ],
    limits: {},
    camera: [{ id: 'ack-camera', quote: 'Acknowledgements of people, grants etc. are de-anonymizing', url: 'https://aclrollingreview.org/authorchecklist', scope: 'Author checklist: such acknowledgements belong in the camera-ready version' }],
  },
  neurips2026: {
    label: 'NeurIPS 2026 (main track)', page: 'https://neurips.cc/Conferences/2026/MainTrackHandbook',
    rules: [
      { id: 'all', about: ['identity', 'author-block', 'pdf-names', 'supp-identity'], quote: 'All submissions must be anonymized and may not contain any identifying information that may violate the double-blind reviewing policy. This policy applies to any supplementary or linked material as well, including code.', url: 'https://neurips.cc/Conferences/2026/MainTrackHandbook' },
      { id: 'ack', about: ['ack'], quote: 'Please do not include acknowledgments at submission time.', url: 'https://neurips.cc/Conferences/2026/MainTrackHandbook' },
      { id: 'third', about: ['selfref', 'selfcite'], quote: 'write \u201cIn the previous work of Smith et al. [1]\u2026\u201d rather than \u201cIn our previous work [1]...\u201d', url: 'https://neurips.cc/Conferences/2026/MainTrackHandbook' },
      { id: 'links', about: ['own-repo', 'cloud-link'], quote: 'If you are including links to any external material, it is your responsibility to guarantee anonymous browsing.', url: 'https://neurips.cc/Conferences/2026/MainTrackHandbook' },
      { id: 'desk', about: ['*'], quote: 'Papers violating this policy will be desk rejected.', url: 'https://neurips.cc/Conferences/2026/MainTrackHandbook' },
    ],
    limits: { suppZip: { bytes: 100_000_000, text: 'a single ZIP file of up to 100MB', url: 'https://neurips.cc/Conferences/2026/MainTrackHandbook', note: 'The handbook does not say whether MB is 10^6 or 2^20 bytes; 100,000,000 is used.' } },
    camera: [{ id: 'deanon', quote: 'If you are including code or data with the camera-ready version of your accepted paper, you should de-anonymize it (including any URLs).', url: 'https://neurips.cc/public/guides/CodeSubmissionPolicy' }],
  },
  iclr2027: {
    label: 'ICLR 2027', page: 'https://www.iclr.cc/Conferences/2027/AuthorGuidelines',
    rules: [
      { id: 'all', about: ['identity', 'author-block', 'pdf-names', 'supp-identity', 'own-repo'], quote: 'Any paper where author identity is revealed in either the main text or the supplementary material will be desk rejected.', url: 'https://www.iclr.cc/Conferences/2027/AuthorGuidelines' },
      { id: 'third', about: ['selfref', 'selfcite'], quote: 'related arxiv papers by the same authors do not break anonymity; if cited, these should be cited in third person.', url: 'https://www.iclr.cc/Conferences/2027/AuthorGuidelines' },
    ],
    limits: {},
  },
  icml2026: {
    label: 'ICML 2026', page: 'https://icml.cc/Conferences/2026/AuthorInstructions',
    rules: [
      { id: 'brief', about: ['ack', 'grant', 'own-repo'], quote: 'They should refrain from including acknowledgements, grant numbers, or links to public code repositories in their submissions.', url: 'https://icml.cc/Conferences/2026/AuthorInstructions' },
      { id: 'third', about: ['selfref', 'selfcite'], quote: 'authors should refer to their prior work in the third person wherever possible.', url: 'https://icml.cc/Conferences/2026/AuthorInstructions' },
      { id: 'faq', about: ['own-repo', 'identity'], quote: 'If you include a link to a code or data repository that includes any identifying information about you, your submission may be desk-rejected.', url: 'https://icml.cc/Conferences/2026/PeerReviewFAQ' },
      { id: 'mandatory', about: ['*'], quote: 'Note that anonymizing the submissions is mandatory, and papers that explicitly or implicitly reveal the authors\u2019 identities will be rejected.', url: 'https://icml.cc/Conferences/2026/AuthorInstructions' },
    ],
    limits: { pdf: { bytes: 50_000_000, text: 'The submission PDF has a maximum size of 50MB', url: 'https://icml.cc/Conferences/2026/AuthorInstructions', note: 'The page does not say whether MB is 10^6 or 2^20 bytes; 50,000,000 is used.' }, pdfCamera: { bytes: 20_000_000, text: 'the camera ready version will be limited to 20MB', url: 'https://icml.cc/Conferences/2026/AuthorInstructions' } },
    camera: [{ id: 'accepted', quote: 'The author information will not be printed unless accepted is passed as an argument to the style file.', url: 'https://media.icml.cc/Conferences/ICML2026/Styles/example_paper.pdf', scope: 'ICML 2026 example paper' }],
  },
};

export const venueOptions = () => Object.entries(VENUES).map(([id, v]) => ({ id, label: v.label }));

// the venue rules that speak to a finding rule id
export function rulesFor(venueId, ruleId) {
  const v = VENUES[venueId] || VENUES.any;
  return v.rules.filter((r) => r.about.includes(ruleId));
}
export const desk = (venueId) => (VENUES[venueId] || VENUES.any).rules.find((r) => r.about.includes('*')) || null;
