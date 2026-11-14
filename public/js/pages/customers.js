import { html, useState, useEffect, useData, api, navigate, Link, Loading, ErrorBox, PageHead, Modal, Field, Input, Text, Select, Menu, attempt, confirmDo,
  money0, ago, addressLine, mapsUrl, STAGE_LABEL, KIND_LABEL, SOURCES, Empty } from '../lib.js';
import { NewLeadModal } from './jobs.js';

export function CustomerForm({ initial, onClose, onSaved }) {
  const [c, setC] = useState(initial || { type: 'residential', name: '', company: '', email: '', phone: '', phone2: '', address: '', city: '', state: '', zip: '', source: '', notes: '' });
  const save = async (e) => {
    e.preventDefault();
    const r = await attempt(() => (c.id ? api('PUT', '/api/customers/' + c.id, c) : api('POST', '/api/customers', c)), 'Saved');
    if (r) { onSaved(r.id || c.id); onClose(); }
  };
  return html`<${Modal} title=${c.id ? 'Edit customer' : 'New customer'} onClose=${onClose} wide footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" form="custf">Save</button>`}>
    <form id="custf" onSubmit=${save}>
      <div class="seg sm"><button type="button" class=${c.type === 'residential' ? 'on' : ''} onClick=${() => setC({ ...c, type: 'residential' })}>Residential</button>
        <button type="button" class=${c.type === 'commercial' ? 'on' : ''} onClick=${() => setC({ ...c, type: 'commercial' })}>Commercial</button></div>
      <div class="form-grid">
        <${Field} label=${c.type === 'commercial' ? 'Contact name *' : 'Name *'}><${Input} obj=${c} set=${setC} k="name" required /></${Field}>
        <${Field} label="Company"><${Input} obj=${c} set=${setC} k="company" /></${Field}>
        <${Field} label="Phone"><${Input} obj=${c} set=${setC} k="phone" type="tel" /></${Field}>
        <${Field} label="Alt. phone"><${Input} obj=${c} set=${setC} k="phone2" type="tel" /></${Field}>
        <${Field} label="Email" class="span2"><${Input} obj=${c} set=${setC} k="email" type="email" /></${Field}>
        <${Field} label="Street address" class="span2"><${Input} obj=${c} set=${setC} k="address" /></${Field}>
        <${Field} label="City"><${Input} obj=${c} set=${setC} k="city" /></${Field}>
        <div class="form-grid tight"><${Field} label="State"><${Input} obj=${c} set=${setC} k="state" /></${Field}><${Field} label="ZIP"><${Input} obj=${c} set=${setC} k="zip" /></${Field}></div>
        <${Field} label="Lead source"><${Select} obj=${c} set=${setC} k="source" empty="—" options=${[...new Set([...SOURCES, c.source].filter(Boolean))].map((s) => [s, s])} /></${Field}>
        <${Field} label="Notes" class="span2"><${Text} obj=${c} set=${setC} k="notes" /></${Field}>
      </div></form></${Modal}>`;
}

export function Customers() {
  const [q, setQ] = useState(''); const [qd, setQd] = useState('');
  const [type, setType] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQd(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, reload } = useData(`/api/customers?q=${encodeURIComponent(qd)}${type ? '&type=' + type : ''}`);
  return html`
    <${PageHead} title="Customers"><button class="btn primary" onClick=${() => setAdding(true)}>+ New customer</button></${PageHead}>
    <div class="toolbar"><input class="search" placeholder="Search name, phone, email, address…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="seg sm"><button class=${!type ? 'on' : ''} onClick=${() => setType('')}>All</button><button class=${type === 'residential' ? 'on' : ''} onClick=${() => setType('residential')}>Residential</button><button class=${type === 'commercial' ? 'on' : ''} onClick=${() => setType('commercial')}>Commercial</button></div></div>
    ${error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : !data ? html`<${Loading} />` : !data.length ? html`<${Empty}><p>No customers found.</p></${Empty}>` : html`
      <div class="card flush"><table class="tbl">
        <thead><tr><th>Name</th><th>Phone</th><th class="hide-sm">Address</th><th class="hide-sm">Source</th><th class="r">Jobs</th><th class="hide-sm">Added</th></tr></thead>
        <tbody>${data.map((c) => html`<tr class="click" onClick=${() => navigate('/customers/' + c.id)}>
          <td><b>${c.company || c.name}</b>${c.company && html`<div class="sm muted">${c.name}</div>`}${c.type === 'commercial' && html` <span class="badge b-com">Com</span>`}</td>
          <td>${c.phone}</td><td class="hide-sm">${addressLine(c)}</td><td class="hide-sm">${c.source}</td>
          <td class="r">${c.job_count}${c.open_jobs ? html` <span class="muted">(${c.open_jobs} open)</span>` : ''}</td><td class="muted hide-sm">${ago(c.created_at)}</td></tr>`)}</tbody></table></div>`}
    ${adding && html`<${CustomerForm} onClose=${() => setAdding(false)} onSaved=${(id) => navigate('/customers/' + id)} />`}
  `;
}

export function CustomerPage({ id }) {
  const { data: c, error, reload } = useData('/api/customers/' + id);
  const [modal, setModal] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!c) return html`<${Loading} />`;
  const addr = addressLine(c);
  const del = () => confirmDo(`Delete ${c.name} and ALL their jobs, quotes, invoices and photos? This can't be undone.`, async () => {
    if (await attempt(() => api('DELETE', '/api/customers/' + id), 'Customer deleted')) navigate('/customers');
  });
  return html`
    <${PageHead} back=${['/customers', 'Customers']} title=${c.company || c.name} sub=${(c.company ? c.name + ' · ' : '') + (c.type === 'commercial' ? 'Commercial' : 'Residential') + (c.source ? ' · via ' + c.source : '')}>
      <button class="btn primary" onClick=${() => setModal('job')}>+ New job</button>
      <button class="btn" onClick=${() => setModal('edit')}>Edit</button>
      <${Menu} items=${[{ label: 'Delete customer', danger: true, onClick: del }]} />
    </${PageHead}>
    <div class="cols">
      <div class="col-main">
        <section class="card"><div class="card-head"><h2>Jobs</h2></div>
          ${c.jobs.length ? html`<table class="tbl"><tbody>${c.jobs.map((j) => html`<tr class="click" onClick=${() => navigate('/jobs/' + j.id)}>
            <td><b>${j.title}</b><div class="sm muted">${KIND_LABEL[j.kind]} · ${ago(j.created_at)}</div></td>
            <td><span class="badge st-${j.stage}">${STAGE_LABEL[j.stage]}</span></td><td class="r">${money0(j.quote_total || j.est_value)}</td></tr>`)}</tbody></table>`
            : html`<p class="muted">No jobs yet.</p>`}
        </section>
        <section class="card"><div class="card-head"><h2>Recent activity</h2></div>
          ${c.activity.length ? html`<ul class="feed">${c.activity.map((a) => html`<li class=${a.kind}><div class="feed-meta"><b>${a.user_name || 'System'}</b> · ${a.job_title || ''} · ${ago(a.created_at)}</div><div class="feed-body">${a.body}</div></li>`)}</ul>`
            : html`<p class="muted">Nothing yet.</p>`}
        </section>
      </div>
      <div class="col-side"><section class="card">
        <div class="kv"><span class="lbl">Phone</span>${c.phone ? html`<a href=${'tel:' + c.phone}>${c.phone}</a>` : '—'}${c.phone2 && html`<div><a href=${'tel:' + c.phone2}>${c.phone2}</a></div>`}</div>
        <div class="kv"><span class="lbl">Email</span>${c.email ? html`<a href=${'mailto:' + c.email}>${c.email}</a>` : '—'}</div>
        <div class="kv"><span class="lbl">Address</span>${addr ? html`<a href=${mapsUrl(addr)} target="_blank" rel="noopener">${addr}</a>` : '—'}</div>
        ${c.notes && html`<div class="kv"><span class="lbl">Notes</span><div class="desc">${c.notes}</div></div>`}
      </section></div>
    </div>
    ${modal === 'edit' && html`<${CustomerForm} initial=${c} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'job' && html`<${NewLeadModal} customer=${c} onClose=${() => setModal(null)} />`}
  `;
}
