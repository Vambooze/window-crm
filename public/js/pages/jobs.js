import { html, useState, useEffect, useData, api, navigate, Link, Loading, ErrorBox, PageHead, Modal, Field, Input, Text, Select, SearchPick, attempt,
  money0, fmtDateTime, ago, STAGES, STAGE_LABEL, JOB_KINDS, KIND_LABEL, SOURCES, Empty } from '../lib.js';

export function NewLeadModal({ onClose, customer: preset }) {
  const [mode, setMode] = useState(preset ? 'existing' : 'new');
  const [cust, setCust] = useState(preset || null);
  const [c, setC] = useState({ type: 'residential', name: '', company: '', phone: '', email: '', address: '', city: '', state: '', zip: '', source: '' });
  const [j, setJ] = useState({ title: '', kind: 'replacement', description: '', diffSite: false, site_address: '', site_city: '', site_state: '', site_zip: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const r = await attempt(async () => {
      let customerId = cust && cust.id;
      if (mode === 'new') customerId = (await api('POST', '/api/customers', c)).id;
      if (!customerId) throw new Error('Pick a customer');
      const body = { customer_id: customerId, title: j.title || defaultTitle(), kind: j.kind, description: j.description };
      if (j.diffSite) Object.assign(body, { site_address: j.site_address, site_city: j.site_city, site_state: j.site_state, site_zip: j.site_zip });
      return api('POST', '/api/jobs', body);
    }, 'Lead created');
    setBusy(false);
    if (r) { onClose(); navigate('/jobs/' + r.id); }
  };
  const defaultTitle = () => {
    const k = { replacement: 'Window replacement', new_construction: 'New construction windows', repair: 'Window repair', service: 'Service call' }[j.kind];
    const nm = mode === 'new' ? (c.company || c.name) : (cust && (cust.company || cust.name));
    return nm ? `${k} – ${nm}` : k;
  };
  return html`<${Modal} title="New lead" onClose=${onClose} wide footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" form="leadf" disabled=${busy}>Create lead</button>`}>
    <form id="leadf" onSubmit=${save}>
      ${!preset && html`<div class="seg"><button type="button" class=${mode === 'new' ? 'on' : ''} onClick=${() => setMode('new')}>New customer</button>
        <button type="button" class=${mode === 'existing' ? 'on' : ''} onClick=${() => setMode('existing')}>Existing customer</button></div>`}
      ${mode === 'new' ? html`
        <div class="seg sm"><button type="button" class=${c.type === 'residential' ? 'on' : ''} onClick=${() => setC({ ...c, type: 'residential' })}>Residential</button>
          <button type="button" class=${c.type === 'commercial' ? 'on' : ''} onClick=${() => setC({ ...c, type: 'commercial' })}>Commercial</button></div>
        <div class="form-grid">
          <${Field} label=${c.type === 'commercial' ? 'Contact name *' : 'Name *'}><${Input} obj=${c} set=${setC} k="name" required autofocus /></${Field}>
          ${c.type === 'commercial' && html`<${Field} label="Company"><${Input} obj=${c} set=${setC} k="company" /></${Field}>`}
          <${Field} label="Phone"><${Input} obj=${c} set=${setC} k="phone" type="tel" /></${Field}>
          <${Field} label="Email"><${Input} obj=${c} set=${setC} k="email" type="email" /></${Field}>
          <${Field} label="Street address" class="span2"><${Input} obj=${c} set=${setC} k="address" /></${Field}>
          <${Field} label="City"><${Input} obj=${c} set=${setC} k="city" /></${Field}>
          <div class="form-grid tight"><${Field} label="State"><${Input} obj=${c} set=${setC} k="state" maxlength="20" /></${Field}>
            <${Field} label="ZIP"><${Input} obj=${c} set=${setC} k="zip" /></${Field}></div>
          <${Field} label="Lead source"><${Select} obj=${c} set=${setC} k="source" empty="—" options=${SOURCES.map((s) => [s, s])} /></${Field}>
        </div>` : cust ? html`<div class="picked"><b>${cust.company || cust.name}</b> ${cust.company && html`<span class="muted">(${cust.name})</span>`}
            ${!preset && html`<button type="button" class="link" onClick=${() => setCust(null)}>change</button>`}</div>`
        : html`<${SearchPick} url="/api/customers?q=" placeholder="Search customers by name, phone, address…" onPick=${setCust}
            render=${(r) => html`<b>${r.company || r.name}</b> <span class="muted">${r.phone} ${r.address}</span>`} />`}
      <h3 class="sect">Job</h3>
      <div class="form-grid">
        <${Field} label="Type of work"><${Select} obj=${j} set=${setJ} k="kind" options=${JOB_KINDS} /></${Field}>
        <${Field} label="Job title" hint=${'Leave blank for "' + defaultTitle() + '"'}><${Input} obj=${j} set=${setJ} k="title" /></${Field}>
        <${Field} label="What do they need?" class="span2"><${Text} obj=${j} set=${setJ} k="description" placeholder="e.g. 12 windows, 2nd floor bedrooms drafty, wants white vinyl, interested in financing…" /></${Field}>
      </div>
      <label class="check"><input type="checkbox" checked=${j.diffSite} onChange=${(e) => setJ({ ...j, diffSite: e.target.checked })} /> Job site is a different address</label>
      ${j.diffSite && html`<div class="form-grid">
        <${Field} label="Site address" class="span2"><${Input} obj=${j} set=${setJ} k="site_address" /></${Field}>
        <${Field} label="City"><${Input} obj=${j} set=${setJ} k="site_city" /></${Field}>
        <div class="form-grid tight"><${Field} label="State"><${Input} obj=${j} set=${setJ} k="site_state" /></${Field}><${Field} label="ZIP"><${Input} obj=${j} set=${setJ} k="site_zip" /></${Field}></div>
      </div>`}
    </form></${Modal}>`;
}

export function Jobs() {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState(() => { try { return localStorage.getItem('jobsView') || 'board'; } catch { return 'board'; } });
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [kind, setKind] = useState('');
  const [stage, setStage] = useState(params.get('stage') || '');
  const [showClosed, setShowClosed] = useState(false);
  const [lead, setLead] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQd(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { try { localStorage.setItem('jobsView', view); } catch {} }, [view]);
  const url = `/api/jobs?q=${encodeURIComponent(qd)}${kind ? '&kind=' + kind : ''}${view === 'list' && stage ? '&stage=' + stage : ''}`;
  const { data, error, loading, reload } = useData(url);
  const stages = STAGES.filter(([s]) => showClosed || !['paid', 'lost'].includes(s));

  const move = async (job, newStage) => {
    if (await attempt(() => api('PUT', `/api/jobs/${job.id}`, { stage: newStage }))) reload();
  };

  return html`
    <${PageHead} title="Jobs">
      <button class="btn primary" onClick=${() => setLead(true)}>+ New lead</button>
    </${PageHead}>
    <div class="toolbar">
      <input class="search" placeholder="Search jobs, customers, addresses…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <select value=${kind} onChange=${(e) => setKind(e.target.value)}><option value="">All work types</option>${JOB_KINDS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
      ${view === 'list' && html`<select value=${stage} onChange=${(e) => setStage(e.target.value)}><option value="">All stages</option>${STAGES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>`}
      ${view === 'board' && html`<label class="check"><input type="checkbox" checked=${showClosed} onChange=${(e) => setShowClosed(e.target.checked)} /> Show paid & lost</label>`}
      <div class="seg sm right"><button class=${view === 'board' ? 'on' : ''} onClick=${() => setView('board')}>Board</button><button class=${view === 'list' ? 'on' : ''} onClick=${() => setView('list')}>List</button></div>
    </div>
    ${error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : !data ? html`<${Loading} />` : view === 'board' ? html`
      <div class="board">${stages.map(([s, label]) => {
        const jobs = data.filter((j) => j.stage === s);
        const total = jobs.reduce((a, j) => a + (j.quote_total || j.est_value || 0), 0);
        return html`<div class="col" onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => { const id = e.dataTransfer.getData('text/job'); const jb = data.find((x) => String(x.id) === id); if (jb && jb.stage !== s) move(jb, s); }}>
          <div class="col-head st-bd-${s}"><b>${label}</b><span>${jobs.length}${total ? ' · ' + money0(total) : ''}</span></div>
          ${jobs.map((jb) => html`<${Link} href=${'/jobs/' + jb.id} class="jcard" draggable="true" onDragStart=${(e) => e.dataTransfer.setData('text/job', String(jb.id))}>
            <div class="jc-title">${jb.customer_company || jb.customer_name}</div>
            <div class="jc-sub">${jb.title}</div>
            <div class="jc-meta"><span class="badge k-${jb.kind}">${KIND_LABEL[jb.kind]}</span>${jb.customer_type === 'commercial' && html`<span class="badge b-com">Commercial</span>`}
              ${(jb.quote_total || jb.est_value) ? html`<b class="right">${money0(jb.quote_total || jb.est_value)}</b>` : ''}</div>
            ${jb.next_event && html`<div class="jc-ev">📅 ${fmtDateTime(jb.next_event)}</div>`}
          </${Link}>`)}
        </div>`;
      })}</div>` : data.length ? html`
      <div class="card flush"><table class="tbl">
        <thead><tr><th>Customer</th><th>Job</th><th>Type</th><th>Stage</th><th>Installer</th><th class="r">Value</th><th>Updated</th></tr></thead>
        <tbody>${data.filter((j) => !stage || j.stage === stage).map((j) => html`<tr class="click" onClick=${() => navigate('/jobs/' + j.id)}>
          <td><b>${j.customer_company || j.customer_name}</b>${j.customer_type === 'commercial' && html` <span class="badge b-com">Com</span>`}</td>
          <td>${j.title}</td><td>${KIND_LABEL[j.kind]}</td><td><span class="badge st-${j.stage}">${STAGE_LABEL[j.stage]}</span></td>
          <td>${j.installer_name || html`<span class="muted">—</span>`}</td><td class="r">${money0(j.quote_total || j.est_value)}</td><td class="muted">${ago(j.updated_at)}</td></tr>`)}</tbody>
      </table></div>` : html`<${Empty}><p>No jobs yet.</p><button class="btn primary" onClick=${() => setLead(true)}>Add your first lead</button></${Empty}>`}
    ${lead && html`<${NewLeadModal} onClose=${() => setLead(false)} />`}
  `;
}
