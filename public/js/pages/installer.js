import { html, useState, useData, api, Link, Loading, ErrorBox, PageHead, attempt, fmtTime, fmtDateTime, localDate, addDays, addressLine, mapsUrl, EVENT_LABEL, KIND_LABEL, Badge, Empty } from '../lib.js';
import { Activity, Photos } from './job.js';

function EventActions({ e, onChange }) {
  const set = async (status) => { if (await attempt(() => api('PUT', '/api/events/' + e.id, { status }), status === 'done' ? 'Marked complete ✓' : 'Updated')) onChange(); };
  if (e.status === 'done') return html`<div class="ev-actions"><span class="badge b-done">Done ✓</span><button class="link sm" onClick=${() => set('scheduled')}>undo</button></div>`;
  return html`<div class="ev-actions">
    ${e.status !== 'in_progress' ? html`<button class="btn" onClick=${() => set('in_progress')}>Start</button>` : html`<span class="badge b-in_progress">In progress</span>`}
    <button class="btn primary" onClick=${() => set('done')}>Mark complete</button></div>`;
}

function EventCard({ e, onChange }) {
  const addr = addressLine(e, 'site_');
  return html`<div class="icard ev-${e.kind} ${e.status}">
    <div class="ic-top"><span class="ic-time">${fmtTime(e.starts_at)}</span><span class="badge ev-${e.kind}">${EVENT_LABEL[e.kind]}</span>
      <span class="muted sm">${Math.round(e.duration_min / 60 * 10) / 10} hr</span></div>
    <div class="ic-name">${e.customer_company || e.customer_name || e.title || 'Appointment'}</div>
    ${e.job_title && html`<div class="muted">${e.job_title}</div>`}
    ${addr && html`<a class="ic-addr" href=${mapsUrl(addr)} target="_blank" rel="noopener">📍 ${addr}</a>`}
    ${e.customer_phone && html`<a class="ic-addr" href=${'tel:' + e.customer_phone}>📞 ${e.customer_phone}</a>`}
    ${e.notes && html`<div class="desc">${e.notes}</div>`}
    <div class="ic-foot">${e.job_id && html`<${Link} class="btn" href=${'/jobs/' + e.job_id}>Job details & photos</${Link}>`}<${EventActions} e=${e} onChange=${onChange} /></div>
  </div>`;
}

export function MySchedule({ me }) {
  const t = localDate();
  const { data, error, reload } = useData(`/api/events?from=${addDays(t, -14)}&to=${addDays(t, 21)}`);
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const overdue = data.filter((e) => e.starts_at.slice(0, 10) < t && e.status !== 'done');
  const upcoming = data.filter((e) => e.starts_at.slice(0, 10) >= t);
  const days = [...new Set(upcoming.map((e) => e.starts_at.slice(0, 10)))];
  const dayLabel = (d) => d === t ? 'Today' : d === addDays(t, 1) ? 'Tomorrow' : new Date(d + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return html`<${PageHead} title=${`Hi, ${me.name.split(' ')[0]}`} sub=${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} />
    ${overdue.length > 0 && html`<h3 class="sect neg">Not marked complete</h3>${overdue.map((e) => html`<${EventCard} e=${e} onChange=${reload} />`)}`}
    ${days.length ? days.map((d) => html`<h3 class="sect">${dayLabel(d)}</h3>${upcoming.filter((e) => e.starts_at.slice(0, 10) === d).map((e) => html`<${EventCard} e=${e} onChange=${reload} />`)}`)
      : html`<${Empty}><p>Nothing on your schedule for the next 3 weeks.</p></${Empty}>`}
    ${!days.includes(t) && days.length > 0 && html`<p class="muted">Nothing scheduled today.</p>`}`;
}

export function InstallerJob({ id, me }) {
  const { data: d, error, reload } = useData('/api/jobs/' + id);
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!d) return html`<${Loading} />`;
  const { job, customer: c } = d;
  const site = addressLine(job, 'site_');
  return html`<${PageHead} back=${['/', 'My schedule']} title=${c.company || c.name} sub=${job.title + ' · ' + KIND_LABEL[job.kind]} />
    <section class="card">
      ${site && html`<a class="ic-addr big" href=${mapsUrl(site)} target="_blank" rel="noopener">📍 ${site}</a>`}
      ${c.phone && html`<a class="ic-addr big" href=${'tel:' + c.phone}>📞 ${c.name}: ${c.phone}</a>`}
      ${c.phone2 && html`<a class="ic-addr" href=${'tel:' + c.phone2}>📞 ${c.phone2}</a>`}
      ${job.description && html`<div class="desc">${job.description}</div>`}
    </section>
    ${d.events.length > 0 && html`<section class="card"><h2>My appointments</h2>${d.events.map((e) => html`<div class="list-row">
      <div><span class="badge ev-${e.kind}">${EVENT_LABEL[e.kind]}</span> ${fmtDateTime(e.starts_at)}${e.notes && html`<div class="sm">${e.notes}</div>`}</div>
      <${EventActions} e=${e} onChange=${reload} /></div>`)}</section>`}
    <section class="card"><h2>Window & work list</h2>
      ${d.items.length ? html`<table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Location</th><th>Size</th><th class="r">Qty</th></tr></thead><tbody>
        ${d.items.map((it, i) => html`<tr><td>${i + 1}</td><td><b>${it.name}</b>${it.options.length > 0 && html`<div class="sm muted">${it.options.map((o) => o.name).join(', ')}</div>`}${it.note && html`<div class="sm">${it.note}</div>`}</td>
          <td>${it.location}</td><td>${it.width && it.height ? `${it.width}″ × ${it.height}″` : '—'}</td><td class="r">${it.qty}</td></tr>`)}</tbody></table>`
        : html`<p class="muted">No item list on this job yet. Ask the office.</p>`}
    </section>
    <${Photos} jobId=${id} photos=${d.photos} onChange=${reload} me=${me} />
    <${Activity} jobId=${id} items=${d.activity} onChange=${reload} me=${me} />`;
}
