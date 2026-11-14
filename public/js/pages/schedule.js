import { html, useState, useData, api, navigate, Link, Loading, ErrorBox, PageHead, Modal, Field, Input, Text, Select, SearchPick, attempt, confirmDo,
  fmtTime, localDate, addDays, addressLine, mapsUrl, EVENT_KINDS, EVENT_LABEL, Badge } from '../lib.js';

export function EventModal({ event, staff, fixedJob, onClose, onSaved }) {
  const now = new Date(); now.setMinutes(0); now.setHours(now.getHours() + 1);
  const defStart = `${localDate(now)}T${String(now.getHours()).padStart(2, '0')}:00`;
  const [f, setF] = useState({ kind: 'estimate', duration_min: 60, status: 'scheduled', title: '', notes: '', user_id: '', ...event, starts_at: event.starts_at || defStart });
  const [job, setJob] = useState(fixedJob || (event.job_id ? { id: event.job_id, title: event.job_title, customer_name: event.customer_name } : null));
  const [date, time] = f.starts_at.split('T');
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, job_id: job ? job.id : null, user_id: f.user_id || null };
    const r = await attempt(() => (f.id ? api('PUT', '/api/events/' + f.id, body) : api('POST', '/api/events', body)), f.id ? 'Appointment updated' : 'Appointment scheduled');
    if (r) { onSaved(); onClose(); }
  };
  const del = () => confirmDo('Delete this appointment?', async () => { if (await attempt(() => api('DELETE', '/api/events/' + f.id))) { onSaved(); onClose(); } });
  const DUR = [[30, '30 min'], [60, '1 hr'], [90, '1.5 hr'], [120, '2 hr'], [180, '3 hr'], [240, '4 hr'], [360, '6 hr'], [480, 'Full day (8 hr)'], [960, '2 days'], [1440, '3 days']];
  return html`<${Modal} title=${f.id ? 'Edit appointment' : 'Schedule appointment'} onClose=${onClose}
    footer=${html`${f.id && html`<button class="btn danger left" onClick=${del}>Delete</button>`}<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" form="evf">Save</button>`}>
    <form id="evf" onSubmit=${save}>
      <${Field} label="Job">${job ? html`<div class="picked"><b>${job.customer_name || ''}</b> ${job.title}${!fixedJob && html` <button type="button" class="link" onClick=${() => setJob(null)}>change</button>`}</div>`
        : html`<${SearchPick} url="/api/jobs?open=1&q=" placeholder="Search open jobs… (or leave empty for a general appointment)" onPick=${setJob}
            render=${(r) => html`<b>${r.customer_company || r.customer_name}</b> <span class="muted">${r.title}</span>`} />`}</${Field}>
      <div class="form-grid">
        <${Field} label="Type"><${Select} obj=${f} set=${setF} k="kind" options=${EVENT_KINDS} /></${Field}>
        <${Field} label="Assigned to"><${Select} obj=${f} set=${setF} k="user_id" empty="— Unassigned —" options=${staff.map((s) => [s.id, s.name + (s.role === 'office' ? ' (office)' : '')])} /></${Field}>
        <${Field} label="Date"><input type="date" required value=${date} onInput=${(e) => setF({ ...f, starts_at: `${e.target.value}T${time || '09:00'}` })} /></${Field}>
        <${Field} label="Start time"><input type="time" required value=${time} step="900" onInput=${(e) => setF({ ...f, starts_at: `${date}T${e.target.value}` })} /></${Field}>
        <${Field} label="Length"><select value=${f.duration_min} onChange=${(e) => setF({ ...f, duration_min: Number(e.target.value) })}>${DUR.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></${Field}>
        ${f.id && html`<${Field} label="Status"><${Select} obj=${f} set=${setF} k="status" options=${[['scheduled', 'Scheduled'], ['in_progress', 'In progress'], ['done', 'Done'], ['cancelled', 'Cancelled']]} /></${Field}>`}
        ${!job && html`<${Field} label="Title" class="span2"><${Input} obj=${f} set=${setF} k="title" placeholder="e.g. Supplier pickup" /></${Field}>`}
        <${Field} label="Notes for the crew" class="span2"><${Text} obj=${f} set=${setF} k="notes" placeholder="Gate code, bring lift, park in back…" /></${Field}>
      </div></form></${Modal}>`;
}

function startOfWeek(ymd) { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDate(d); }

export function Schedule({ me }) {
  const [week, setWeek] = useState(startOfWeek(localDate()));
  const [who, setWho] = useState('');
  const [modal, setModal] = useState(null);
  const staffQ = useData('/api/staff');
  const end = addDays(week, 7);
  const { data, error, reload } = useData(`/api/events?from=${week}&to=${end}${who ? '&user_id=' + who : ''}`);
  const staff = staffQ.data || [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const todayStr = localDate();
  const label = `${new Date(week + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(addDays(week, 6) + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return html`
    <${PageHead} title="Schedule" sub=${label}>
      <button class="btn primary" onClick=${() => setModal({})}>+ Appointment</button>
    </${PageHead}>
    <div class="toolbar">
      <div class="seg sm"><button onClick=${() => setWeek(addDays(week, -7))}>‹ Prev</button><button onClick=${() => setWeek(startOfWeek(localDate()))}>This week</button><button onClick=${() => setWeek(addDays(week, 7))}>Next ›</button></div>
      <select value=${who} onChange=${(e) => setWho(e.target.value)}><option value="">Everyone</option>${staff.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select>
    </div>
    ${error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : !data ? html`<${Loading} />` : html`
    <div class="week">${days.map((d) => {
      const evs = data.filter((e) => e.starts_at.slice(0, 10) === d);
      const dt = new Date(d + 'T12:00');
      return html`<div class="day ${d === todayStr ? 'today' : ''} ${d < todayStr ? 'past' : ''}">
        <div class="day-head"><b>${dt.toLocaleDateString('en-US', { weekday: 'short' })}</b> ${dt.getDate()}
          <button class="icon-btn sm" title="Add" onClick=${() => setModal({ starts_at: d + 'T09:00' })}>+</button></div>
        ${evs.map((e) => html`<button class="ev ev-${e.kind} ${e.status}" onClick=${() => setModal(e)}>
          <div class="ev-t">${fmtTime(e.starts_at)} · ${EVENT_LABEL[e.kind]}${e.status === 'done' ? ' ✓' : ''}</div>
          <div class="ev-c">${e.customer_company || e.customer_name || e.title || 'Appointment'}</div>
          <div class="ev-s">${e.user_name || 'Unassigned'}${e.site_city ? ' · ' + e.site_city : ''}</div></button>`)}
      </div>`;
    })}</div>`}
    ${modal && html`<${EventModal} event=${modal} staff=${staff} onClose=${() => setModal(null)} onSaved=${reload} />`}
  `;
}
