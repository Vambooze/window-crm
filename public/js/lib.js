import { html, render, useState, useEffect, useRef, useMemo, useCallback } from '../vendor/htm-preact.js';
export { html, render, useState, useEffect, useRef, useMemo, useCallback };

// ---------- API ----------
export async function api(method, url, body, opts = {}) {
  const init = { method, headers: { 'X-Requested-With': 'crm' }, credentials: 'same-origin' };
  if (body instanceof Blob) { init.body = body; init.headers['Content-Type'] = body.type; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !opts.quiet401) { window.dispatchEvent(new Event('crm:logout')); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
export const get = (u) => api('GET', u);

// ---------- routing ----------
export function navigate(to, replace = false) {
  if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  window.dispatchEvent(new Event('crm:navigate'));
  window.scrollTo(0, 0);
}
export function usePath() {
  const [p, setP] = useState(location.pathname + location.search);
  useEffect(() => {
    const f = () => setP(location.pathname + location.search);
    window.addEventListener('popstate', f); window.addEventListener('crm:navigate', f);
    return () => { window.removeEventListener('popstate', f); window.removeEventListener('crm:navigate', f); };
  }, []);
  return p;
}
export function Link({ href, children, class: cls, ...rest }) {
  return html`<a href=${href} class=${cls} ...${rest} onClick=${(e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || rest.target) return;
    e.preventDefault(); navigate(href);
  }}>${children}</a>`;
}

// ---------- data hook ----------
export function useData(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!url) { setState({ data: null, error: null, loading: false }); return; }
    setState((s) => ({ ...s, loading: true }));
    get(url).then((d) => alive && setState({ data: d, error: null, loading: false }))
      .catch((e) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => { alive = false; };
  }, [url, n, ...deps]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

// ---------- toasts ----------
let toastSet = null;
export function toast(msg, kind = 'ok') {
  if (!toastSet) return alert(msg);
  const id = Math.random();
  toastSet((t) => [...t, { id, msg, kind }]);
  setTimeout(() => toastSet((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
}
export function Toasts() {
  const [t, set] = useState([]);
  toastSet = set;
  return html`<div class="toasts">${t.map((x) => html`<div key=${x.id} class="toast ${x.kind}">${x.msg}</div>`)}</div>`;
}
export async function attempt(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r ?? true; } catch (e) { toast(e.message, 'error'); return null; }
}

// ---------- formatting ----------
export const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const money0 = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export function fmtDate(d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!d) return '';
  const s = String(d);
  const dt = s.length <= 10 ? new Date(s + 'T12:00:00') : s.includes('T') && s.length === 16 ? new Date(s) : new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(dt) ? s : dt.toLocaleDateString('en-US', opts);
}
export function fmtDateTime(local) { // "YYYY-MM-DDTHH:MM" local
  if (!local) return '';
  const dt = new Date(local);
  return dt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function fmtTime(local) { return new Date(local).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
export function ago(sqlDate) {
  if (!sqlDate) return '';
  const dt = new Date(String(sqlDate).replace(' ', 'T') + 'Z');
  const s = (Date.now() - dt) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: dt.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return localDate(d); };
export const daysSince = (sqlDate) => Math.floor((Date.now() - new Date(String(sqlDate).replace(' ', 'T') + 'Z')) / 864e5);

export function addressLine(o, prefix = '') {
  const a = o[prefix + 'address'], c = o[prefix + 'city'], s = o[prefix + 'state'], z = o[prefix + 'zip'];
  return [a, [c, s].filter(Boolean).join(', ') + (z ? ' ' + z : '')].filter((x) => x && x.trim()).join(', ');
}
export const mapsUrl = (addr) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;

// ---------- constants ----------
export const STAGES = [
  ['lead', 'New lead'], ['estimate', 'Estimate booked'], ['measured', 'Measured'], ['quoted', 'Quote sent'], ['won', 'Won'],
  ['ordered', 'Ordered'], ['scheduled', 'Install scheduled'], ['installed', 'Installed'], ['invoiced', 'Invoiced'], ['paid', 'Paid'], ['lost', 'Lost'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);
export const JOB_KINDS = [['replacement', 'Replacement'], ['new_construction', 'New construction'], ['repair', 'Repair'], ['service', 'Service / maintenance']];
export const KIND_LABEL = Object.fromEntries(JOB_KINDS);
export const EVENT_KINDS = [['estimate', 'Estimate'], ['measure', 'Measure'], ['install', 'Install'], ['repair', 'Repair'], ['service', 'Service call'], ['followup', 'Follow-up'], ['other', 'Other']];
export const EVENT_LABEL = Object.fromEntries(EVENT_KINDS);
export const UNITS = [['each', 'Each'], ['ui', 'Per united inch (W + H)'], ['sqft', 'Per sq ft (W × H)'], ['lf', 'Per linear ft (perimeter)'], ['hour', 'Per hour'], ['percent', '% of item (options only)']];
export const UNIT_SHORT = { each: 'ea', ui: '/UI', sqft: '/sq ft', lf: '/lin ft', hour: '/hr', percent: '%' };
export const CATEGORIES = [['window', 'Windows'], ['door', 'Doors'], ['option', 'Glass & options'], ['labor', 'Labor & install'], ['repair', 'Repairs & service'], ['other', 'Other / fees']];
export const SOURCES = ['Referral', 'Google', 'Facebook', 'Website', 'Yard sign', 'Door hanger', 'Home show', 'Repeat customer', 'Builder / contractor', 'Other'];

// ---------- components ----------
export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    document.body.classList.add('modal-open');
    return () => { window.removeEventListener('keydown', f); document.body.classList.remove('modal-open'); };
  }, []);
  return html`<div class="modal-bg" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${onClose}>✕</button></div>
      <div class="modal-body">${children}</div>
      ${footer && html`<div class="modal-foot">${footer}</div>`}
    </div></div>`;
}

export function Field({ label, children, hint, class: cls }) {
  return html`<label class="field ${cls || ''}"><span class="lbl">${label}</span>${children}${hint && html`<span class="hint">${hint}</span>`}</label>`;
}
// Bound inputs against a state object
export function Input({ obj, set, k, type = 'text', ...rest }) {
  return html`<input type=${type} value=${obj[k] ?? ''} onInput=${(e) => set({ ...obj, [k]: e.target.value })} ...${rest} />`;
}
export function Text({ obj, set, k, rows = 3, ...rest }) {
  return html`<textarea rows=${rows} value=${obj[k] ?? ''} onInput=${(e) => set({ ...obj, [k]: e.target.value })} ...${rest}></textarea>`;
}
export function Select({ obj, set, k, options, empty, ...rest }) {
  return html`<select value=${obj[k] ?? ''} onChange=${(e) => set({ ...obj, [k]: e.target.value })} ...${rest}>
    ${empty !== undefined && html`<option value="">${empty}</option>`}
    ${options.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>`;
}

export function Badge({ kind, children }) { return html`<span class="badge b-${kind}">${children}</span>`; }
export function StageBadge({ stage }) { return html`<span class="badge st-${stage}">${STAGE_LABEL[stage] || stage}</span>`; }
export function Loading() { return html`<div class="loading"><span class="spinner"></span></div>`; }
export function ErrorBox({ error, onRetry }) {
  return html`<div class="empty"><p>⚠️ ${error}</p>${onRetry && html`<button class="btn" onClick=${onRetry}>Try again</button>`}</div>`;
}
export function Empty({ children }) { return html`<div class="empty">${children}</div>`; }
export function PageHead({ title, sub, children, back }) {
  return html`<div class="page-head">
    <div>${back && html`<${Link} class="back" href=${back[0]}>← ${back[1]}</${Link}>`}<h1>${title}</h1>${sub && html`<div class="sub">${sub}</div>`}</div>
    <div class="actions">${children}</div></div>`;
}
export function Menu({ label = '⋯', items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open]);
  return html`<div class="menu" ref=${ref}><button class="btn" onClick=${() => setOpen(!open)}>${label}</button>
    ${open && html`<div class="menu-pop">${items.filter(Boolean).map((it) => html`<button class=${it.danger ? 'danger' : ''} onClick=${() => { setOpen(false); it.onClick(); }}>${it.label}</button>`)}</div>`}</div>`;
}

export function confirmDo(msg, fn) { if (confirm(msg)) return fn(); return null; }

// Searchable customer/job picker
export function SearchPick({ url, placeholder, onPick, render: renderRow }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => get(url + encodeURIComponent(q)).then((r) => setRows(r.slice(0, 8))).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  return html`<div class="searchpick"><input placeholder=${placeholder} value=${q} onInput=${(e) => setQ(e.target.value)} autofocus />
    <div class="pick-list">${rows.map((r) => html`<button type="button" onClick=${() => onPick(r)}>${renderRow(r)}</button>`)}
    ${!rows.length && html`<div class="muted pad">No matches</div>`}</div></div>`;
}

// Resize an image file in the browser before upload
export async function shrinkImage(file, maxDim = 2000, quality = 0.82) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', quality));
  } catch { return file; }
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Link copied'); } catch { prompt('Copy this link:', t); }
}
