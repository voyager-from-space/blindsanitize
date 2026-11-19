// URL classification shared by the source, supplement and PDF checks.
import { findTerms } from './identity.js';

export const ANON_PLACEHOLDER = 'https://anonymous.invalid/removed'; // .invalid is reserved (RFC 2606): it can never resolve to a real site

const OWN_HOSTS = /^(?:www\.)?(github\.com|gitlab\.com|bitbucket\.org|huggingface\.co|codeberg\.org|sr\.ht|git\.sr\.ht|gitee\.com|kaggle\.com|replit\.com|sites\.google\.com|notion\.site|wandb\.ai|zenodo\.org|figshare\.com|osf\.io|colab\.research\.google\.com|medium\.com|linkedin\.com|twitter\.com|x\.com|scholar\.google\.com|orcid\.org|researchgate\.net)$/i;
const OWNER_FROM_SUBDOMAIN = /^([a-z0-9-]+)\.(github\.io|gitlab\.io|netlify\.app|vercel\.app|pages\.dev|web\.app|herokuapp\.com|medium\.com|substack\.com)$/i;
const ANON_HOSTS = /(^|\.)(anonymous\.4open\.science|4open\.science|anonymous\.invalid|anonymous\.github\.io)$/i;
const CLOUD = /^(?:(?:drive|docs)\.google\.com|(?:www\.)?dropbox\.com|dl\.dropboxusercontent\.com|onedrive\.live\.com|1drv\.ms|[a-z0-9-]+\.sharepoint\.com|[a-z0-9-]+-my\.sharepoint\.com|(?:www\.)?overleaf\.com|box\.com|[a-z0-9-]+\.box\.com|mega\.nz|wetransfer\.com|we\.tl|icloud\.com|www\.icloud\.com|share\.icloud\.com|mediafire\.com)$/i;
const SHORT = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at)$/i;
const SCHOLARLY = /(^|\.)(doi\.org|arxiv\.org|aclanthology\.org|dl\.acm\.org|ieeexplore\.ieee\.org|openreview\.net|proceedings\.mlr\.press|proceedings\.neurips\.cc|papers\.nips\.cc|neurips\.cc|usenix\.org|link\.springer\.com|sciencedirect\.com|jmlr\.org|cvf\.com|openaccess\.thecvf\.com|aaai\.org|ijcai\.org|wikipedia\.org|semanticscholar\.org|dblp\.org|nature\.com|science\.org|cambridge\.org|tandfonline\.com|wiley\.com|researchgate\.net|ietf\.org|rfc-editor\.org|w3\.org|iso\.org|nist\.gov|python\.org|pytorch\.org|tensorflow\.org|cran\.r-project\.org|pypi\.org)$/i;

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

// returns { kind: 'anon'|'cloud'|'repo'|'personal'|'short'|'mail'|'scholarly'|'other', host, owner, mine }
export function classifyUrl(url, terms = []) {
  let u;
  try { u = new URL(/^mailto:/i.test(url) ? url : url.replace(/^(?!\w+:)/, 'https://')); } catch { return { kind: 'other', host: '', owner: '', mine: false }; }
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'mailto:') {
    const addr = decodeURIComponent(u.pathname);
    return { kind: 'mail', host: addr.split('@')[1] || '', owner: addr.split('@')[0], mine: true };
  }
  if (ANON_HOSTS.test(host)) return { kind: 'anon', host, owner: '', mine: false };
  if (CLOUD.test(host)) return { kind: 'cloud', host, owner: '', mine: false };
  if (SHORT.test(host)) return { kind: 'short', host, owner: '', mine: false };
  let owner = '', kind = null;
  if (OWN_HOSTS.test(host)) { owner = u.pathname.split('/').filter(Boolean)[0] || ''; kind = 'repo'; }
  else { const m = OWNER_FROM_SUBDOMAIN.exec(host); if (m) { owner = m[1]; kind = 'personal'; } }
  if (!kind && /\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/i.test(host)) { owner = (u.pathname.match(/\/~([^/]+)/) || [])[1] || ''; kind = 'personal'; }
  if (!kind && /\/~[^/]+/.test(u.pathname)) { owner = u.pathname.match(/\/~([^/]+)/)[1]; kind = 'personal'; }
  if (!kind) return { kind: SCHOLARLY.test(host) ? 'scholarly' : 'other', host, owner: '', mine: false };
  const on = norm(owner), hn = norm(host);
  const mine = terms.some((t) => { const tn = norm(t.text); return tn.length >= 3 && ((on.length >= 3 && (on.includes(tn) || tn.includes(on))) || (!t.weak && hn.includes(tn))); })
    || findTerms(terms, decodeURIComponent(u.pathname + u.search + host)).length > 0;
  return { kind, host, owner, mine };
}

export const URL_RE = /(?:https?:\/\/|mailto:)[^\s{}<>"'\\^`|]+/gi;
export const trimUrl = (s) => s.replace(/[.,;:!?)\]]+$/, '');
