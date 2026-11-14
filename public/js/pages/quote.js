import { html, useState, useEffect, useMemo, useData, api, navigate, Link, Loading, ErrorBox, PageHead, Modal, Field, Menu, attempt, confirmDo, copyText,
  money, fmtDate, CATEGORIES, UNIT_SHORT, Badge, Empty } from '../lib.js';
import { lineTotal, totals, r2 } from '../pricing.js';

const CAT_LABEL = Object.fromEntries(CATEGORIES);
const DIM_UNITS = ['ui', 'sqft', 'lf'];

export function QuotesList() {
  const params = new URLSearchParams(location.search);
  const [status, setStatus] = useState(params.get('status') || '');
  const { data, error, reload } = useData('/api/quotes' + (status ? '?status=' + status : ''));
  return html`<${PageHead} title="Quotes" sub="Create quotes from a job's page." />
    <div class="toolbar"><div class="seg sm">${[['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined']].map(([v, l]) =>
      html`<button class=${status === v ? 'on' : ''} onClick=${() => setStatus(v)}>${l}</button>`)}</div></div>
    ${error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : !data ? html`<${Loading} />` : !data.length ? html`<${Empty}><p>No quotes here yet.</p><${Link} class="btn" href="/jobs">Go to jobs</${Link}></${Empty}>` : html`
    <div class="card flush"><table class="tbl"><thead><tr><th>#</th><th>Customer</th><th class="hide-sm">Job</th><th>Status</th><th class="hide-sm">Date</th><th class="r">Total</th></tr></thead>
      <tbody>${data.map((q) => html`<tr class="click" onClick=${() => navigate('/quotes/' + q.id)}><td><b>${q.number}</b></td><td>${q.customer_company || q.customer_name}</td>
        <td class="hide-sm">${q.job_title}</td><td><${Badge} kind=${q.status}>${q.status}</${Badge}></td>
        <td class="muted hide-sm">${fmtDate(q.accepted_at || q.sent_at || q.created_at)}</td><td class="r"><b>${money(q.total)}</b></td></tr>`)}</tbody></table></div>`}`;
}

function SendModal({ kind, doc, customer, onClose, onSent }) {
  const [f, setF] = useState({ to: customer.email || '', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const ok = await attempt(() => api('POST', `/api/${kind}s/${doc.id}/send`, f), 'Email sent');
    setBusy(false);
    if (ok) { onSent(); onClose(); }
  };
  return html`<${Modal} title=${`Email ${kind} ${doc.number}`} onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy || !f.to} onClick=${send}>${busy ? 'Sending…' : 'Send'}</button>`}>
    <${Field} label="To"><input type="email" value=${f.to} onInput=${(e) => setF({ ...f, to: e.target.value })} /></${Field}>
    <${Field} label="Subject" hint="Leave blank for the default subject"><input value=${f.subject} onInput=${(e) => setF({ ...f, subject: e.target.value })} /></${Field}>
    <${Field} label="Message" hint="Leave blank for the default message. A button linking to the online ${kind} is added automatically."><textarea rows="5" value=${f.message} onInput=${(e) => setF({ ...f, message: e.target.value })}></textarea></${Field}>
  </${Modal}>`;
}
export { SendModal };

function NumIn({ value, onInput, ...rest }) {
  return html`<input type="number" inputmode="decimal" step="any" value=${value} onInput=${(e) => onInput(e.target.value)} ...${rest} />`;
}

function LineEditor({ line, idx, count, priceItems, addOnItems, update, remove, duplicate, move }) {
  const calc = lineTotal(line);
  const usesDims = DIM_UNITS.includes(line.unit) || line.options.some((o) => DIM_UNITS.includes(o.unit));
  const pick = (id) => {
    if (id === 'custom') return update({ ...line, price_item_id: null, name: line.name || 'Custom item' });
    const p = priceItems.find((x) => String(x.id) === id);
    if (p) update({ ...line, price_item_id: p.id, name: p.name, unit: p.unit, unit_price: p.price, min_charge: p.min_charge });
  };
  const addOpt = (id) => {
    const p = addOnItems.find((x) => String(x.id) === id);
    if (p && !line.options.some((o) => o.price_item_id === p.id)) update({ ...line, options: [...line.options, { price_item_id: p.id, name: p.name, unit: p.unit, unit_price: p.price, min_charge: p.min_charge }] });
  };
  const groups = CATEGORIES.filter(([c]) => c !== 'option');
  const area = line.width && line.height ? `${r2(line.width * line.height / 144)} sq ft · ${r2(Number(line.width) + Number(line.height))} UI` : '';
  return html`<div class="qline">
    <div class="ql-num">${idx + 1}</div>
    <div class="ql-body">
      <div class="ql-row1">
        <select class="ql-product" value=${line.price_item_id || 'custom'} onChange=${(e) => pick(e.target.value)}>
          ${groups.map(([c, l]) => { const its = priceItems.filter((p) => p.category === c); return its.length ? html`<optgroup label=${l}>${its.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</optgroup>` : null; })}
          <option value="custom">Custom item…</option>
        </select>
        <input class="ql-loc" placeholder="Location (e.g. Kitchen)" value=${line.location} onInput=${(e) => update({ ...line, location: e.target.value })} />
      </div>
      ${!line.price_item_id && html`<input class="ql-name" placeholder="Item description" value=${line.name} onInput=${(e) => update({ ...line, name: e.target.value })} />`}
      <div class="ql-row2">
        <label class=${usesDims ? '' : 'dim'}>W″<${NumIn} value=${line.width || ''} onInput=${(v) => update({ ...line, width: v })} /></label>
        <label class=${usesDims ? '' : 'dim'}>H″<${NumIn} value=${line.height || ''} onInput=${(v) => update({ ...line, height: v })} /></label>
        <label>${line.unit === 'hour' ? 'Hours' : 'Qty'}<${NumIn} value=${line.qty} onInput=${(v) => update({ ...line, qty: v })} /></label>
        <label>Price ${UNIT_SHORT[line.unit]}<${NumIn} value=${line.unit_price} onInput=${(v) => update({ ...line, unit_price: v })} /></label>
        ${!line.price_item_id && html`<label>Pricing<select value=${line.unit} onChange=${(e) => update({ ...line, unit: e.target.value })}>
          ${[['each', 'Each'], ['ui', 'UI'], ['sqft', 'Sq ft'], ['lf', 'Lin ft'], ['hour', 'Hour']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></label>`}
        <div class="ql-total"><span class="muted sm">${money(calc.each)} each</span><b>${money(calc.total)}</b></div>
      </div>
      ${area && html`<div class="sm muted">${area}${line.min_charge && calc.base <= line.min_charge ? ` · minimum charge ${money(line.min_charge)} applied` : ''}</div>`}
      <div class="ql-opts">
        ${line.options.map((o, i) => html`<span class="chip">${o.name}<button title="Remove" onClick=${() => update({ ...line, options: line.options.filter((_, j) => j !== i) })}>×</button></span>`)}
        <select class="add-opt" value="" onChange=${(e) => { addOpt(e.target.value); e.target.value = ''; }}>
          <option value="">+ Add-on…</option>
          ${['option', 'labor'].map((c) => html`<optgroup label=${CAT_LABEL[c]}>${addOnItems.filter((p) => p.category === c && !line.options.some((o) => o.price_item_id === p.id)).map((p) => html`<option value=${p.id}>${p.name}</option>`)}</optgroup>`)}
        </select>
      </div>
      <input class="ql-note" placeholder="Note shown on the quote (optional)" value=${line.note} onInput=${(e) => update({ ...line, note: e.target.value })} />
    </div>
    <div class="ql-actions">
      <button class="icon-btn sm" title="Move up" disabled=${idx === 0} onClick=${() => move(-1)}>↑</button>
      <button class="icon-btn sm" title="Move down" disabled=${idx === count - 1} onClick=${() => move(1)}>↓</button>
      <button class="icon-btn sm" title="Duplicate" onClick=${duplicate}>⧉</button>
      <button class="icon-btn sm danger" title="Remove" onClick=${remove}>✕</button>
    </div>
  </div>`;
}

export function QuoteEditor({ id }) {
  const { data, error, reload } = useData('/api/quotes/' + id);
  const pq = useData('/api/price-items');
  const [q, setQ] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  useEffect(() => { if (data) { setQ({ ...data.quote }); setDirty(false); } }, [data]);
  useEffect(() => {
    const f = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [dirty]);
  const all = pq.data || [];
  const priceItems = useMemo(() => all.filter((p) => p.active && p.category !== 'option'), [all]);
  const addOnItems = useMemo(() => all.filter((p) => p.active && ['option', 'labor'].includes(p.category) && p.unit !== 'hour'), [all]);

  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!q || !data || !pq.data) return html`<${Loading} />`;
  const { job, customer } = data;
  const edit = (patch) => { setQ({ ...q, ...patch }); setDirty(true); };
  const items = q.items.map((l) => ({ ...l, line_total: lineTotal(l).total }));
  const t = totals(items, q.discount, q.tax_rate);
  const deposit = r2(t.total * (Number(q.deposit_pct) || 0) / 100);

  const setItems = (list) => edit({ items: list });
  const newLine = (cat) => {
    const prev = [...q.items].reverse().find((l) => ['window', 'door'].includes(priceItems.find((p) => p.id === l.price_item_id)?.category));
    const first = priceItems.find((p) => p.category === cat);
    const base = { price_item_id: null, name: '', location: '', unit: 'each', unit_price: 0, min_charge: 0, width: '', height: '', qty: 1, options: [], note: '' };
    if (first) Object.assign(base, { price_item_id: first.id, name: first.name, unit: first.unit, unit_price: first.price, min_charge: first.min_charge });
    if (prev && (cat === 'window' || cat === 'door')) Object.assign(base, { price_item_id: prev.price_item_id, name: prev.name, unit: prev.unit, unit_price: prev.unit_price, min_charge: prev.min_charge, options: prev.options.map((o) => ({ ...o })) });
    setItems([...q.items, base]);
  };
  const save = async () => {
    setSaving(true);
    const ok = await attempt(() => api('PUT', '/api/quotes/' + id, { ...q, items }), 'Quote saved');
    setSaving(false);
    if (ok) { setDirty(false); reload(); }
    return ok;
  };
  const saveThen = async (fn) => { if (dirty && !(await save())) return; fn(); };
  const setStatus = (status) => saveThen(async () => { if (await attempt(() => api('POST', `/api/quotes/${id}/status`, { status }), `Marked ${status}`)) reload(); });
  const link = `${location.origin}/q/${q.token}`;
  const locked = q.status === 'accepted';

  return html`
    <${PageHead} back=${['/jobs/' + job.id, job.title]} title=${html`Quote ${q.number} <${Badge} kind=${q.status}>${q.status}</${Badge}>`}
      sub=${html`${customer.company || customer.name} · ${job.title}`}>
      <button class="btn primary" disabled=${!dirty || saving} onClick=${save}>${saving ? 'Saving…' : dirty ? 'Save' : 'Saved ✓'}</button>
      <button class="btn" onClick=${() => saveThen(() => window.open('/doc/quote/' + id, '_blank'))}>Preview / Print</button>
      <button class="btn" onClick=${() => saveThen(() => setModal('send'))}>Email</button>
      <${Menu} items=${[
        { label: 'Copy customer link', onClick: () => saveThen(() => copyText(link)) },
        q.status !== 'sent' && { label: 'Mark as sent', onClick: () => setStatus('sent') },
        q.status !== 'accepted' && { label: 'Mark as accepted (signed)', onClick: () => setStatus('accepted') },
        q.status !== 'declined' && { label: 'Mark as declined', onClick: () => setStatus('declined') },
        q.status !== 'draft' && { label: 'Back to draft', onClick: () => setStatus('draft') },
        { label: 'Duplicate quote', onClick: () => saveThen(async () => { const r = await attempt(() => api('POST', `/api/quotes/${id}/duplicate`), 'Copied'); if (r) navigate('/quotes/' + r.id); }) },
        { label: 'Delete quote', danger: true, onClick: () => confirmDo('Delete this quote?', async () => { if (await attempt(() => api('DELETE', '/api/quotes/' + id))) { setDirty(false); navigate('/jobs/' + job.id); } }) },
      ]} />
    </${PageHead}>
    ${locked && html`<div class="banner ok">Accepted${q.accepted_name ? ' by ' + q.accepted_name : ''} on ${fmtDate(q.accepted_at)}. Changes now will alter the signed quote, so duplicate it for a change order instead.
      <button class="btn sm" onClick=${() => navigate('/jobs/' + job.id)}>Create invoice on the job page →</button></div>`}

    <section class="card">
      <div class="card-head"><h2>Items</h2><span class="muted sm">Prices come from your price list. You can still change any price on this quote.</span></div>
      ${items.length ? items.map((l, i) => html`<${LineEditor} key=${i} line=${l} idx=${i} count=${items.length} priceItems=${priceItems} addOnItems=${addOnItems}
          update=${(nl) => setItems(q.items.map((x, j) => (j === i ? nl : x)))}
          remove=${() => setItems(q.items.filter((_, j) => j !== i))}
          duplicate=${() => setItems([...q.items.slice(0, i + 1), { ...q.items[i], options: q.items[i].options.map((o) => ({ ...o })) }, ...q.items.slice(i + 1)])}
          move=${(d) => { const a = [...q.items]; [a[i], a[i + d]] = [a[i + d], a[i]]; setItems(a); }} />`)
        : html`<p class="muted">No items yet. Add windows, doors, labor or repairs below.</p>`}
      <div class="add-lines">
        <button class="btn" onClick=${() => newLine('window')}>+ Window</button>
        <button class="btn" onClick=${() => newLine('door')}>+ Door</button>
        <button class="btn" onClick=${() => newLine('labor')}>+ Labor</button>
        <button class="btn" onClick=${() => newLine('repair')}>+ Repair / service</button>
        <button class="btn" onClick=${() => newLine('other')}>+ Fee / other</button>
      </div>
    </section>

    <div class="grid2">
      <section class="card">
        <div class="form-grid">
          <${Field} label="Discount ($)"><${NumIn} value=${q.discount} onInput=${(v) => edit({ discount: v })} /></${Field}>
          <${Field} label="Tax rate (%)"><${NumIn} value=${q.tax_rate} onInput=${(v) => edit({ tax_rate: v })} /></${Field}>
          <${Field} label="Deposit (%)"><${NumIn} value=${q.deposit_pct} onInput=${(v) => edit({ deposit_pct: v })} /></${Field}>
          <${Field} label="Valid until"><input type="date" value=${q.valid_until} onInput=${(e) => edit({ valid_until: e.target.value })} /></${Field}>
          <${Field} label="Notes to customer" class="span2"><textarea rows="3" value=${q.notes} onInput=${(e) => edit({ notes: e.target.value })} placeholder="e.g. Includes full-frame replacement of 10 windows. Lead time 4–6 weeks."></textarea></${Field}>
          <${Field} label="Terms" class="span2"><textarea rows="4" value=${q.terms} onInput=${(e) => edit({ terms: e.target.value })}></textarea></${Field}>
        </div>
      </section>
      <section class="card totals-card">
        <div class="trow"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
        ${Number(q.discount) > 0 && html`<div class="trow"><span>Discount</span><b>−${money(q.discount)}</b></div>`}
        ${Number(q.tax_rate) > 0 && html`<div class="trow"><span>Tax (${q.tax_rate}%)</span><b>${money(t.tax)}</b></div>`}
        <div class="trow grand"><span>Total</span><b>${money(t.total)}</b></div>
        ${deposit > 0 && html`<div class="trow"><span>Deposit (${q.deposit_pct}%)</span><b>${money(deposit)}</b></div>`}
        <div class="sm muted">${items.length} line${items.length === 1 ? '' : 's'} · ${items.reduce((a, l) => a + (Number(l.qty) || 0), 0)} units</div>
      </section>
    </div>
    ${modal === 'send' && html`<${SendModal} kind="quote" doc=${q} customer=${customer} onClose=${() => setModal(null)} onSent=${reload} />`}
  `;
}
