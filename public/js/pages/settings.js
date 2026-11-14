import { html, useState, useEffect, useData, api, Loading, ErrorBox, PageHead, Modal, Field, Input, Text, Select, attempt, Badge } from '../lib.js';

function UserModal({ user, onClose, onSaved }) {
  const [f, setF] = useState({ role: 'installer', name: '', email: '', phone: '', password: '', active: 1, ...user, password: '' });
  const gen = () => setF({ ...f, password: Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY2346789'[b % 51]).join('') });
  const save = async () => {
    const body = { ...f }; if (!body.password) delete body.password;
    const r = await attempt(() => (f.id ? api('PUT', '/api/users/' + f.id, body) : api('POST', '/api/users', body)), 'Saved');
    if (r) { onSaved(); onClose(); }
  };
  return html`<${Modal} title=${f.id ? 'Edit user' : 'Add user'} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button>`}>
    <div class="form-grid">
      <${Field} label="Name"><${Input} obj=${f} set=${setF} k="name" autofocus /></${Field}>
      <${Field} label="Role"><${Select} obj=${f} set=${setF} k="role" options=${[['office', 'Office staff (full access)'], ['installer', 'Installer (own schedule only)']]} /></${Field}>
      <${Field} label="Email (used to sign in)"><${Input} obj=${f} set=${setF} k="email" type="email" /></${Field}>
      <${Field} label="Phone"><${Input} obj=${f} set=${setF} k="phone" type="tel" /></${Field}>
      <${Field} label=${f.id ? 'Reset password (optional)' : 'Temporary password'} hint="They'll be asked to choose their own the first time they sign in." class="span2">
        <div class="inline"><input value=${f.password} onInput=${(e) => setF({ ...f, password: e.target.value })} placeholder=${f.id ? 'Leave blank to keep current' : 'At least 8 characters'} /><button type="button" class="btn" onClick=${gen}>Generate</button></div></${Field}>
      ${f.id && html`<label class="check"><input type="checkbox" checked=${!!f.active} onChange=${(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> Active (can sign in)</label>`}
    </div>
    ${f.password && html`<p class="banner">Give them their sign-in details: <b>${f.email}</b> / <b>${f.password}</b></p>`}
  </${Modal}>`;
}

function Users({ me }) {
  const { data, error, reload } = useData('/api/users');
  const [edit, setEdit] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  return html`<section class="card flush"><div class="card-head pad"><h2>Team & logins</h2><button class="btn primary" onClick=${() => setEdit({})}>+ Add user</button></div>
    <table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
    ${data.map((u) => html`<tr class=${'click ' + (u.active ? '' : 'inactive')} onClick=${() => setEdit(u)}><td><b>${u.name}</b>${u.id === me.id && html` <span class="muted">(you)</span>`}</td><td>${u.email}</td>
      <td><${Badge} kind=${u.role}>${u.role === 'office' ? 'Office' : 'Installer'}</${Badge}></td><td>${!u.active ? html`<span class="badge">disabled</span>` : u.must_change_pw ? html`<span class="muted sm">temp password</span>` : ''}</td></tr>`)}
    </tbody></table>
    <p class="sm muted pad"><b>Office staff</b> see everything: customers, pricing, quotes, invoices and settings. <b>Installers</b> only see appointments assigned to them, with the job address, contact, window list (no prices), notes and photos.</p>
    ${edit && html`<${UserModal} user=${edit} onClose=${() => setEdit(null)} onSaved=${reload} />`}</section>`;
}

export function Settings({ me }) {
  const { data, error, reload } = useData('/api/settings');
  const [s, setS] = useState(null);
  const [tab, setTab] = useState('company');
  const [testTo, setTestTo] = useState(me.email);
  useEffect(() => { if (data) setS(data); }, [data]);
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!s) return html`<${Loading} />`;
  const save = async () => { if (await attempt(() => api('PUT', '/api/settings', s), 'Settings saved')) reload(); };
  const tabs = [['company', 'Company'], ['quotes', 'Quotes & invoices'], ['email', 'Email'], ['users', 'Team & logins']];
  return html`
    <${PageHead} title="Settings">${tab !== 'users' && html`<button class="btn primary" onClick=${save}>Save settings</button>`}</${PageHead}>
    <div class="seg tabs">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab === 'company' && html`<section class="card"><p class="muted">Shown at the top of every quote and invoice.</p><div class="form-grid">
      <${Field} label="Company name"><${Input} obj=${s} set=${setS} k="company_name" /></${Field}>
      <${Field} label="Phone"><${Input} obj=${s} set=${setS} k="company_phone" /></${Field}>
      <${Field} label="Email"><${Input} obj=${s} set=${setS} k="company_email" /></${Field}>
      <${Field} label="Website"><${Input} obj=${s} set=${setS} k="company_website" /></${Field}>
      <${Field} label="Address" class="span2"><${Text} obj=${s} set=${setS} k="company_address" rows="2" /></${Field}>
      <${Field} label="Contractor license #"><${Input} obj=${s} set=${setS} k="license_no" /></${Field}>
    </div></section>`}
    ${tab === 'quotes' && html`<section class="card"><div class="form-grid four">
      <${Field} label="Default tax rate (%)"><${Input} obj=${s} set=${setS} k="default_tax_rate" type="number" step="any" /></${Field}>
      <${Field} label="Default deposit (%)"><${Input} obj=${s} set=${setS} k="default_deposit_pct" type="number" step="any" /></${Field}>
      <${Field} label="Quotes valid for (days)"><${Input} obj=${s} set=${setS} k="quote_valid_days" type="number" /></${Field}>
      <${Field} label="Invoices due in (days)"><${Input} obj=${s} set=${setS} k="invoice_due_days" type="number" /></${Field}>
      <${Field} label="Next quote #"><${Input} obj=${s} set=${setS} k="next_quote_no" type="number" /></${Field}>
      <${Field} label="Next invoice #"><${Input} obj=${s} set=${setS} k="next_invoice_no" type="number" /></${Field}>
      <${Field} label="Default quote terms" class="span4"><${Text} obj=${s} set=${setS} k="quote_terms" rows="5" /></${Field}>
      <${Field} label="Default invoice notes" class="span4"><${Text} obj=${s} set=${setS} k="invoice_notes" rows="2" /></${Field}>
    </div></section>`}
    ${tab === 'email' && html`<section class="card">
      <p class="muted">Used to email quotes and invoices to customers. With Hostinger email, use host <b>smtp.hostinger.com</b>, port <b>465</b>, and your full mailbox address and password. Gmail needs an "App password".</p>
      <div class="form-grid">
        <${Field} label="SMTP host"><${Input} obj=${s} set=${setS} k="smtp_host" placeholder="smtp.hostinger.com" /></${Field}>
        <${Field} label="Port" hint="465 = SSL, 587 = STARTTLS"><${Input} obj=${s} set=${setS} k="smtp_port" /></${Field}>
        <${Field} label="Username"><${Input} obj=${s} set=${setS} k="smtp_user" autocomplete="off" /></${Field}>
        <${Field} label="Password"><${Input} obj=${s} set=${setS} k="smtp_pass" type="password" autocomplete="new-password" /></${Field}>
        <${Field} label="From" hint='e.g. "Acme Windows <office@acmewindows.com>"' class="span2"><${Input} obj=${s} set=${setS} k="smtp_from" /></${Field}>
        <${Field} label="Public web address of this CRM" hint="Used for links in emails. Leave blank to use the address you're on now." class="span2"><${Input} obj=${s} set=${setS} k="public_url" placeholder="https://crm.yourdomain.com" /></${Field}>
      </div>
      <div class="inline"><input value=${testTo} onInput=${(e) => setTestTo(e.target.value)} /><button class="btn" onClick=${async () => { await save(); attempt(() => api('POST', '/api/settings/test-email', { to: testTo }), 'Test email sent'); }}>Save & send test email</button></div>
    </section>`}
    ${tab === 'users' && html`<${Users} me=${me} />`}
  `;
}
