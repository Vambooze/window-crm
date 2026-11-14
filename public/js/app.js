import { html, render, useState, useEffect, api, get, usePath, navigate, Link, Toasts, Loading, attempt, toast } from './lib.js';
import { Dashboard } from './pages/dashboard.js';
import { Jobs } from './pages/jobs.js';
import { JobPage } from './pages/job.js';
import { Customers, CustomerPage } from './pages/customers.js';
import { Schedule } from './pages/schedule.js';
import { QuotesList, QuoteEditor } from './pages/quote.js';
import { InvoicesList, InvoiceEditor } from './pages/invoice.js';
import { PriceList } from './pages/prices.js';
import { Settings } from './pages/settings.js';
import { Account } from './pages/account.js';
import { MySchedule, InstallerJob } from './pages/installer.js';

function Login({ onDone }) {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('POST', '/api/login', f, { quiet401: true }); onDone(); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return html`<div class="login-wrap"><form class="login card" onSubmit=${submit}>
    <div class="brand big"><span class="logo">▦</span> Window CRM</div>
    <label class="field"><span class="lbl">Email</span><input type="email" autocomplete="username" required value=${f.email} onInput=${(e) => setF({ ...f, email: e.target.value })} autofocus /></label>
    <label class="field"><span class="lbl">Password</span><input type="password" autocomplete="current-password" required value=${f.password} onInput=${(e) => setF({ ...f, password: e.target.value })} /></label>
    ${err && html`<div class="err">${err}</div>`}
    <button class="btn primary block" disabled=${busy}>${busy ? 'Signing in…' : 'Sign in'}</button>
  </form></div>`;
}

function ForcePassword({ onDone }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.next !== f.confirm) return setErr("New passwords don't match");
    try { await api('POST', '/api/me/password', { current: f.current, next: f.next }); toast('Password updated'); onDone(); } catch (x) { setErr(x.message); }
  };
  return html`<div class="login-wrap"><form class="login card" onSubmit=${submit}>
    <h2>Set your own password</h2><p class="muted">You're using a temporary password. Choose a new one (8+ characters) to continue.</p>
    <label class="field"><span class="lbl">Temporary password</span><input type="password" autocomplete="current-password" required value=${f.current} onInput=${(e) => setF({ ...f, current: e.target.value })} /></label>
    <label class="field"><span class="lbl">New password</span><input type="password" autocomplete="new-password" minlength="8" required value=${f.next} onInput=${(e) => setF({ ...f, next: e.target.value })} /></label>
    <label class="field"><span class="lbl">Confirm new password</span><input type="password" autocomplete="new-password" minlength="8" required value=${f.confirm} onInput=${(e) => setF({ ...f, confirm: e.target.value })} /></label>
    ${err && html`<div class="err">${err}</div>`}
    <button class="btn primary block">Save password</button>
  </form></div>`;
}

const OFFICE_NAV = [
  ['/', 'Dashboard', '◧'], ['/jobs', 'Jobs', '▤'], ['/customers', 'Customers', '☺'], ['/schedule', 'Schedule', '▦'],
  ['/quotes', 'Quotes', '✎'], ['/invoices', 'Invoices', '$'], ['/prices', 'Price list', '≡'], ['/settings', 'Settings', '⚙'],
];
const INSTALLER_NAV = [['/', 'My schedule', '▦'], ['/account', 'Account', '☺']];

function match(path, pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  const m = path.match(re);
  return m ? Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) : null;
}

function Routes({ me, path }) {
  const p = path.split('?')[0];
  const office = me.role === 'office';
  const table = office ? [
    ['/', () => html`<${Dashboard} />`],
    ['/jobs', () => html`<${Jobs} />`],
    ['/jobs/:id', (a) => html`<${JobPage} id=${a.id} me=${me} />`],
    ['/customers', () => html`<${Customers} />`],
    ['/customers/:id', (a) => html`<${CustomerPage} id=${a.id} />`],
    ['/schedule', () => html`<${Schedule} me=${me} />`],
    ['/quotes', () => html`<${QuotesList} />`],
    ['/quotes/:id', (a) => html`<${QuoteEditor} id=${a.id} />`],
    ['/invoices', () => html`<${InvoicesList} />`],
    ['/invoices/:id', (a) => html`<${InvoiceEditor} id=${a.id} />`],
    ['/prices', () => html`<${PriceList} />`],
    ['/settings', () => html`<${Settings} me=${me} />`],
    ['/account', () => html`<${Account} me=${me} />`],
  ] : [
    ['/', () => html`<${MySchedule} me=${me} />`],
    ['/jobs/:id', (a) => html`<${InstallerJob} id=${a.id} me=${me} />`],
    ['/account', () => html`<${Account} me=${me} />`],
  ];
  for (const [pat, fn] of table) { const a = match(p, pat); if (a) return fn(a); }
  return html`<div class="empty"><h2>Page not found</h2><${Link} class="btn" href="/">Go home</${Link}></div>`;
}

function Shell({ me, company, onLogout }) {
  const path = usePath();
  const [navOpen, setNavOpen] = useState(false);
  const nav = me.role === 'office' ? OFFICE_NAV : INSTALLER_NAV;
  const cur = path.split('?')[0];
  const active = (href) => (href === '/' ? cur === '/' : cur === href || cur.startsWith(href + '/'));
  useEffect(() => setNavOpen(false), [path]);
  return html`<div class="shell ${me.role}">
    <aside class="side ${navOpen ? 'open' : ''}">
      <div class="brand"><span class="logo">▦</span><span>${company || 'Window CRM'}</span></div>
      <nav>${nav.map(([href, label, icon]) => html`<${Link} href=${href} class=${active(href) ? 'on' : ''}><span class="ni">${icon}</span>${label}</${Link}>`)}</nav>
      <div class="me"><${Link} href="/account">${me.name}<small>${me.role === 'office' ? 'Office' : 'Installer'}</small></${Link}>
        <button class="link" onClick=${onLogout}>Sign out</button></div>
    </aside>
    ${navOpen && html`<div class="scrim" onClick=${() => setNavOpen(false)}></div>`}
    <header class="topbar"><button class="icon-btn" aria-label="Menu" onClick=${() => setNavOpen(true)}>☰</button>
      <span class="brand sm"><span class="logo">▦</span>${company || 'Window CRM'}</span></header>
    <main class="main"><${Routes} me=${me} path=${path} /></main>
    ${me.role !== 'office' && html`<nav class="bottomnav">${nav.map(([href, label, icon]) => html`<${Link} href=${href} class=${active(href) ? 'on' : ''}><span>${icon}</span>${label}</${Link}>`)}</nav>`}
    <${Toasts} />
  </div>`;
}

function App() {
  const [state, setState] = useState({ loading: true, me: null, company: '' });
  const load = async () => {
    try { const r = await api('GET', '/api/me', undefined, { quiet401: true }); setState({ loading: false, me: r.user, company: r.company_name }); }
    catch { setState({ loading: false, me: null }); }
  };
  useEffect(() => {
    load();
    const f = () => setState({ loading: false, me: null });
    window.addEventListener('crm:logout', f);
    return () => window.removeEventListener('crm:logout', f);
  }, []);
  const logout = async () => { await attempt(() => api('POST', '/api/logout')); setState({ loading: false, me: null }); navigate('/login', true); };
  if (state.loading) return html`<${Loading} />`;
  if (!state.me) {
    return html`<${Login} onDone=${async () => {
      const next = new URLSearchParams(location.search).get('next');
      if (next && next.startsWith('/doc/')) { location.href = next; return; }
      if (location.pathname === '/login') navigate('/', true);
      await load();
    }} /><${Toasts} />`;
  }
  if (state.me.must_change_pw) return html`<${ForcePassword} onDone=${load} /><${Toasts} />`;
  if (location.pathname === '/login') history.replaceState(null, '', '/');
  return html`<${Shell} me=${state.me} company=${state.company} onLogout=${logout} />`;
}

render(html`<${App} />`, document.getElementById('app'));
