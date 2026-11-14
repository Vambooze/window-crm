import { html, useState, useRef, useData, api, navigate, Link, Loading, ErrorBox, PageHead, Modal, Field, Input, Text, Select, Menu, attempt, confirmDo,
  money, money0, fmtDate, fmtDateTime, ago, addressLine, mapsUrl, shrinkImage, STAGES, STAGE_LABEL, JOB_KINDS, KIND_LABEL, EVENT_LABEL, Badge } from '../lib.js';
import { EventModal } from './schedule.js';

// ---------- shared: notes + photos (also used by installer view) ----------
export function Activity({ jobId, items, onChange, me }) {
  const [body, setBody] = useState('');
  const add = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    if (await attempt(() => api('POST', `/api/jobs/${jobId}/notes`, { body }))) { setBody(''); onChange(); }
  };
  return html`<section class="card"><div class="card-head"><h2>Notes & activity</h2></div>
    <form class="note-form" onSubmit=${add}><textarea rows="2" placeholder="Add a note (call log, measurements, gate code, customer preferences…)" value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
      <button class="btn primary" disabled=${!body.trim()}>Add note</button></form>
    <ul class="feed">${items.map((a) => html`<li class=${a.kind}>
      <div class="feed-meta"><b>${a.user_name || (a.kind === 'system' ? 'System' : 'Customer')}</b> · ${ago(a.created_at)}
        ${a.kind === 'note' && (me.role === 'office' || a.user_id === me.id) && html`<button class="link sm" onClick=${() => confirmDo('Delete this note?', async () => { if (await attempt(() => api('DELETE', '/api/activity/' + a.id))) onChange(); })}>delete</button>`}</div>
      <div class="feed-body">${a.body}</div></li>`)}</ul></section>`;
}

export function Photos({ jobId, photos, onChange, me }) {
  const inp = useRef();
  const [busy, setBusy] = useState(0);
  const [view, setView] = useState(null);
  const upload = async (files) => {
    const list = [...files];
    setBusy(list.length);
    for (const f of list) {
      const blob = await shrinkImage(f);
      await attempt(() => api('POST', `/api/jobs/${jobId}/photos`, blob instanceof Blob && blob.type ? blob : f));
      setBusy((n) => n - 1);
    }
    inp.current.value = '';
    onChange();
  };
  return html`<section class="card"><div class="card-head"><h2>Photos</h2>
      <button class="btn" onClick=${() => inp.current.click()} disabled=${busy > 0}>${busy ? `Uploading ${busy}…` : '+ Add photos'}</button>
      <input ref=${inp} type="file" accept="image/*" multiple hidden onChange=${(e) => upload(e.target.files)} /></div>
    ${photos.length ? html`<div class="photos">${photos.map((p) => html`<button class="ph" onClick=${() => setView(p)}><img loading="lazy" src=${'/api/photos/' + p.id} alt="" /></button>`)}</div>`
      : html`<p class="muted">No photos yet. Snap the openings, damage, or the finished install.</p>`}
    ${view && html`<${Modal} title=${'Photo · ' + (view.user_name || '') + ' · ' + ago(view.created_at)} onClose=${() => setView(null)} wide
        footer=${html`<a class="btn" href=${'/api/photos/' + view.id} target="_blank">Open full size</a>
          ${(me.role === 'office' || view.user_name === me.name) && html`<button class="btn danger" onClick=${() => confirmDo('Delete this photo?', async () => { if (await attempt(() => api('DELETE', '/api/photos/' + view.id))) { setView(null); onChange(); } })}>Delete</button>`}`}>
      <img class="ph-full" src=${'/api/photos/' + view.id} alt="" /></${Modal}>`}
  </section>`;
}

// ---------- office job page ----------
function EditJob({ job, staff, onClose, onSaved }) {
  const [f, setF] = useState({ ...job, installer_id: job.installer_id || '' });
  const save = async (e) => {
    e.preventDefault();
    if (await attempt(() => api('PUT', '/api/jobs/' + job.id, f), 'Saved')) { onSaved(); onClose(); }
  };
  return html`<${Modal} title="Edit job" onClose=${onClose} wide footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" form="jobf">Save</button>`}>
    <form id="jobf" onSubmit=${save} class="form-grid">
      <${Field} label="Job title" class="span2"><${Input} obj=${f} set=${setF} k="title" required /></${Field}>
      <${Field} label="Type of work"><${Select} obj=${f} set=${setF} k="kind" options=${JOB_KINDS} /></${Field}>
      <${Field} label="Stage"><${Select} obj=${f} set=${setF} k="stage" options=${STAGES} /></${Field}>
      ${f.stage === 'lost' && html`<${Field} label="Why was it lost?" class="span2"><${Input} obj=${f} set=${setF} k="lost_reason" placeholder="Price, went with competitor, postponed…" /></${Field}>`}
      <${Field} label="Lead installer"><${Select} obj=${f} set=${setF} k="installer_id" empty="— Unassigned —" options=${staff.map((s) => [s.id, s.name])} /></${Field}>
      <${Field} label="Estimated value ($)" hint="Updated automatically from quotes"><${Input} obj=${f} set=${setF} k="est_value" type="number" step="0.01" /></${Field}>
      <${Field} label="Site address" class="span2"><${Input} obj=${f} set=${setF} k="site_address" /></${Field}>
      <${Field} label="City"><${Input} obj=${f} set=${setF} k="site_city" /></${Field}>
      <div class="form-grid tight"><${Field} label="State"><${Input} obj=${f} set=${setF} k="site_state" /></${Field}><${Field} label="ZIP"><${Input} obj=${f} set=${setF} k="site_zip" /></${Field}></div>
      <${Field} label="Description / scope" class="span2"><${Text} obj=${f} set=${setF} k="description" rows="4" /></${Field}>
    </form></${Modal}>`;
}

function NewInvoiceModal({ job, quotes, invoices, onClose }) {
  const accepted = quotes.filter((q) => q.status === 'accepted');
  const base = accepted[0] || quotes[0];
  const hasPrior = base && invoices.some((i) => i.quote_id === base.id && i.status !== 'void');
  const [f, setF] = useState({ quote_id: base ? base.id : '', mode: hasPrior ? 'balance' : 'full', percent: 50 });
  const create = async () => {
    const body = !f.quote_id ? {} : f.mode === 'deposit' ? { quote_id: f.quote_id, percent: f.percent } : f.mode === 'balance' ? { quote_id: f.quote_id, mode: 'balance' } : { quote_id: f.quote_id, percent: 100 };
    const r = await attempt(() => api('POST', `/api/jobs/${job.id}/invoices`, body));
    if (r) { onClose(); navigate('/invoices/' + r.id); }
  };
  return html`<${Modal} title="New invoice" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${create}>Create invoice</button>`}>
    <${Field} label="Based on quote"><select value=${f.quote_id} onChange=${(e) => setF({ ...f, quote_id: e.target.value ? Number(e.target.value) : '' })}>
      <option value="">— Blank invoice —</option>${quotes.map((q) => html`<option value=${q.id}>${q.number} · ${money(q.total)} · ${q.status}</option>`)}</select></${Field}>
    ${f.quote_id && html`<div class="radios">
      <label class="check"><input type="radio" checked=${f.mode === 'full'} onChange=${() => setF({ ...f, mode: 'full' })} /> Full amount — copy every line from the quote</label>
      <label class="check"><input type="radio" checked=${f.mode === 'deposit'} onChange=${() => setF({ ...f, mode: 'deposit' })} /> Deposit of <input class="w60" type="number" value=${f.percent} onInput=${(e) => setF({ ...f, percent: e.target.value, mode: 'deposit' })} />%</label>
      <label class="check"><input type="radio" checked=${f.mode === 'balance'} onChange=${() => setF({ ...f, mode: 'balance' })} /> Remaining balance (quote minus earlier invoices)</label></div>`}
  </${Modal}>`;
}

export function JobPage({ id, me }) {
  const { data: d, error, loading, reload } = useData('/api/jobs/' + id);
  const staffQ = useData('/api/staff');
  const [modal, setModal] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!d) return html`<${Loading} />`;
  const { job, customer: c } = d;
  const staff = staffQ.data || [];
  const site = addressLine(job, 'site_');
  const setStage = async (stage) => { if (await attempt(() => api('PUT', '/api/jobs/' + id, { stage }))) reload(); };
  const newQuote = async () => { const r = await attempt(() => api('POST', `/api/jobs/${id}/quotes`)); if (r) navigate('/quotes/' + r.id); };
  const del = () => confirmDo(`Delete job "${job.title}" with all its quotes, invoices, photos and notes? This can't be undone.`, async () => {
    if (await attempt(() => api('DELETE', '/api/jobs/' + id), 'Job deleted')) navigate('/jobs');
  });
  const invoiced = d.invoices.filter((i) => i.status !== 'void').reduce((a, i) => a + i.total, 0);
  const paid = d.invoices.reduce((a, i) => a + i.paid, 0);

  return html`
    <${PageHead} back=${['/jobs', 'Jobs']} title=${job.title}
      sub=${html`<${Link} href=${'/customers/' + c.id}>${c.company || c.name}</${Link}> · ${KIND_LABEL[job.kind]}${c.type === 'commercial' ? ' · Commercial' : ''}`}>
      <select class="stage-select st-${job.stage}" value=${job.stage} onChange=${(e) => setStage(e.target.value)}>${STAGES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
      <button class="btn" onClick=${() => setModal('edit')}>Edit</button>
      <${Menu} items=${[{ label: 'Delete job', danger: true, onClick: del }]} />
    </${PageHead}>
    <div class="stepper">${STAGES.filter(([s]) => s !== 'lost').map(([s, l]) => html`<button class=${'step ' + (job.stage === s ? 'on' : STAGES.findIndex((x) => x[0] === s) < STAGES.findIndex((x) => x[0] === job.stage) && job.stage !== 'lost' ? 'done' : '')} onClick=${() => setStage(s)}>${l}</button>`)}</div>

    <div class="cols">
      <div class="col-main">
        <section class="card">
          <div class="info-grid">
            <div><span class="lbl">Customer</span><b>${c.name}</b>${c.company && html`<div>${c.company}</div>`}
              ${c.phone && html`<div><a href=${'tel:' + c.phone}>${c.phone}</a></div>`}${c.email && html`<div><a href=${'mailto:' + c.email}>${c.email}</a></div>`}</div>
            <div><span class="lbl">Job site</span>${site ? html`<a href=${mapsUrl(site)} target="_blank" rel="noopener">${site}</a>` : html`<span class="muted">No address</span>`}</div>
            <div><span class="lbl">Lead installer</span>${d.installer ? d.installer.name : html`<span class="muted">Unassigned</span>`}</div>
            <div><span class="lbl">Value</span>${money0(job.est_value)}${invoiced ? html`<div class="muted">Invoiced ${money0(invoiced)} · Paid ${money0(paid)}</div>` : ''}</div>
          </div>
          ${job.description && html`<div class="desc">${job.description}</div>`}
          ${job.stage === 'lost' && job.lost_reason && html`<div class="desc neg">Lost: ${job.lost_reason}</div>`}
        </section>

        <section class="card">
          <div class="card-head"><h2>Quotes</h2><button class="btn primary" onClick=${newQuote}>+ New quote</button></div>
          ${d.quotes.length ? html`<table class="tbl"><tbody>${d.quotes.map((q) => html`<tr class="click" onClick=${() => navigate('/quotes/' + q.id)}>
            <td><b>${q.number}</b></td><td><${Badge} kind=${q.status}>${q.status}</${Badge}></td>
            <td class="muted">${q.accepted_at ? 'Accepted ' + fmtDate(q.accepted_at) : q.sent_at ? 'Sent ' + fmtDate(q.sent_at) : 'Created ' + fmtDate(q.created_at)}</td>
            <td class="r"><b>${money(q.total)}</b></td></tr>`)}</tbody></table>` : html`<p class="muted">No quotes yet. Build one from your price list.</p>`}
        </section>

        <section class="card">
          <div class="card-head"><h2>Invoices</h2><button class="btn" onClick=${() => setModal('invoice')}>+ New invoice</button></div>
          ${d.invoices.length ? html`<table class="tbl"><tbody>${d.invoices.map((i) => html`<tr class="click" onClick=${() => navigate('/invoices/' + i.id)}>
            <td><b>${i.number}</b></td><td><${Badge} kind=${i.status}>${i.status}</${Badge}></td><td class="muted">${fmtDate(i.issued_on)}</td>
            <td class="r">${money(i.total)}${i.balance > 0 && i.status !== 'void' ? html`<div class="sm neg">${money(i.balance)} due</div>` : ''}</td></tr>`)}</tbody></table>`
            : html`<p class="muted">No invoices yet.</p>`}
        </section>

        <${Activity} jobId=${id} items=${d.activity} onChange=${reload} me=${me} />
      </div>
      <div class="col-side">
        <section class="card">
          <div class="card-head"><h2>Appointments</h2><button class="btn" onClick=${() => setModal({ event: { job_id: Number(id), kind: ['lead', 'estimate'].includes(job.stage) ? 'estimate' : job.kind === 'repair' ? 'repair' : 'install', user_id: job.installer_id || '' } })}>+ Schedule</button></div>
          ${d.events.length ? html`<ul class="list">${d.events.map((e) => html`<li><button class="row-btn" onClick=${() => setModal({ event: e })}>
            <div class="row-main"><span class="badge ev-${e.kind}">${EVENT_LABEL[e.kind]}</span> ${fmtDateTime(e.starts_at)}${e.status !== 'scheduled' && html` <${Badge} kind=${e.status}>${e.status.replace('_', ' ')}</${Badge}>`}</div>
            <div class="row-sub">${e.user_name || 'Unassigned'} · ${Math.round(e.duration_min / 60 * 10) / 10} hr${e.notes ? ' · ' + e.notes : ''}</div></button></li>`)}</ul>`
            : html`<p class="muted">Nothing scheduled.</p>`}
        </section>
        <${Photos} jobId=${id} photos=${d.photos} onChange=${reload} me=${me} />
      </div>
    </div>
    ${modal === 'edit' && html`<${EditJob} job=${job} staff=${staff} onClose=${() => setModal(null)} onSaved=${reload} />`}
    ${modal === 'invoice' && html`<${NewInvoiceModal} job=${job} quotes=${d.quotes} invoices=${d.invoices} onClose=${() => setModal(null)} />`}
    ${modal && modal.event && html`<${EventModal} event=${modal.event} staff=${staff} fixedJob=${{ id: job.id, title: job.title, customer_name: c.name }} onClose=${() => setModal(null)} onSaved=${reload} />`}
  `;
}
