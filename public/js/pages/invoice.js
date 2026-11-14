import { html, useState, useEffect, useData, api, navigate, Link, Loading, ErrorBox, PageHead, Modal, Field, Menu, attempt, confirmDo, copyText,
  money, fmtDate, localDate, Badge, Empty } from '../lib.js';
import { totals, r2 } from '../pricing.js';
import { SendModal } from './quote.js';

export function InvoicesList() {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useData('/api/invoices' + (status ? '?status=' + status : ''));
  const today = localDate();
  const outstanding = (data || []).filter((i) => i.status === 'sent').reduce((a, i) => a + i.balance, 0);
  return html`<${PageHead} title="Invoices" sub=${data ? `${money(outstanding)} outstanding` : ''} />
    <div class="toolbar"><div class="seg sm">${[['', 'All'], ['draft', 'Draft'], ['sent', 'Unpaid'], ['paid', 'Paid'], ['void', 'Void']].map(([v, l]) =>
      html`<button class=${status === v ? 'on' : ''} onClick=${() => setStatus(v)}>${l}</button>`)}</div></div>
    ${error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : !data ? html`<${Loading} />` : !data.length ? html`<${Empty}><p>No invoices yet. Create one from a job.</p></${Empty}>` : html`
    <div class="card flush"><table class="tbl"><thead><tr><th>#</th><th>Customer</th><th class="hide-sm">Job</th><th>Status</th><th class="hide-sm">Due</th><th class="r">Total</th><th class="r">Balance</th></tr></thead>
      <tbody>${data.map((i) => html`<tr class="click" onClick=${() => navigate('/invoices/' + i.id)}><td><b>${i.number}</b></td><td>${i.customer_company || i.customer_name}</td>
        <td class="hide-sm">${i.job_title}</td><td><${Badge} kind=${i.status}>${i.status === 'sent' ? 'unpaid' : i.status}</${Badge}>${i.status === 'sent' && i.due_on && i.due_on < today ? html` <span class="badge b-declined">overdue</span>` : ''}</td>
        <td class="muted hide-sm">${fmtDate(i.due_on)}</td><td class="r">${money(i.total)}</td><td class="r ${i.balance > 0 && i.status !== 'void' ? 'neg' : ''}"><b>${i.status === 'void' ? '—' : money(i.balance)}</b></td></tr>`)}</tbody></table></div>`}`;
}

function PaymentModal({ inv, onClose, onSaved }) {
  const [f, setF] = useState({ amount: inv.balance > 0 ? inv.balance : '', method: 'Check', paid_on: localDate(), note: '' });
  const save = async () => { if (await attempt(() => api('POST', `/api/invoices/${inv.id}/payments`, f), 'Payment recorded')) { onSaved(); onClose(); } };
  return html`<${Modal} title="Record payment" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save payment</button>`}>
    <div class="form-grid">
      <${Field} label="Amount ($)"><input type="number" step="0.01" value=${f.amount} onInput=${(e) => setF({ ...f, amount: e.target.value })} autofocus /></${Field}>
      <${Field} label="Date"><input type="date" value=${f.paid_on} onInput=${(e) => setF({ ...f, paid_on: e.target.value })} /></${Field}>
      <${Field} label="Method"><select value=${f.method} onChange=${(e) => setF({ ...f, method: e.target.value })}>${['Check', 'Cash', 'Credit card', 'ACH / bank transfer', 'Financing', 'Zelle', 'Venmo', 'Other'].map((m) => html`<option>${m}</option>`)}</select></${Field}>
      <${Field} label="Reference / note"><input value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })} placeholder="Check #1234" /></${Field}>
    </div></${Modal}>`;
}

export function InvoiceEditor({ id }) {
  const { data, error, reload } = useData('/api/invoices/' + id);
  const [inv, setInv] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState(null);
  useEffect(() => { if (data) { setInv({ ...data.invoice }); setDirty(false); } }, [data]);
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!inv || !data) return html`<${Loading} />`;
  const { job, customer } = data;
  const edit = (p) => { setInv({ ...inv, ...p }); setDirty(true); };
  const items = inv.items.map((l) => ({ ...l, line_total: r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0)) }));
  const t = totals(items, inv.discount, inv.tax_rate);
  const paid = data.invoice.paid;
  const setItem = (i, p) => edit({ items: inv.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const save = async () => { const ok = await attempt(() => api('PUT', '/api/invoices/' + id, { ...inv, items }), 'Invoice saved'); if (ok) { setDirty(false); reload(); } return ok; };
  const saveThen = async (fn) => { if (dirty && !(await save())) return; fn(); };
  const setStatus = (status) => saveThen(async () => { if (await attempt(() => api('PUT', '/api/invoices/' + id, { ...data.invoice, status }), 'Updated')) reload(); });
  return html`
    <${PageHead} back=${['/jobs/' + job.id, job.title]} title=${html`Invoice ${inv.number} <${Badge} kind=${inv.status}>${inv.status === 'sent' ? 'unpaid' : inv.status}</${Badge}>`} sub=${customer.company || customer.name}>
      <button class="btn primary" disabled=${!dirty} onClick=${save}>${dirty ? 'Save' : 'Saved ✓'}</button>
      <button class="btn" onClick=${() => saveThen(() => window.open('/doc/invoice/' + id, '_blank'))}>Preview / Print</button>
      <button class="btn" onClick=${() => saveThen(() => setModal('send'))}>Email</button>
      <button class="btn" onClick=${() => saveThen(() => setModal('pay'))}>Record payment</button>
      <${Menu} items=${[
        { label: 'Copy customer link', onClick: () => saveThen(async () => { if (inv.status === 'draft') { await api('POST', `/api/invoices/${id}/mark-sent`); reload(); } copyText(`${location.origin}/i/${inv.token}`); }) },
        inv.status === 'draft' && { label: 'Mark as sent', onClick: () => saveThen(async () => { if (await attempt(() => api('POST', `/api/invoices/${id}/mark-sent`))) reload(); }) },
        inv.status !== 'void' && { label: 'Void invoice', onClick: () => confirmDo('Void this invoice?', () => setStatus('void')) },
        inv.status === 'void' && { label: 'Un-void (back to draft)', onClick: () => setStatus('draft') },
        { label: 'Delete invoice', danger: true, onClick: () => confirmDo('Delete this invoice and its payments?', async () => { if (await attempt(() => api('DELETE', '/api/invoices/' + id))) navigate('/jobs/' + job.id); }) },
      ]} />
    </${PageHead}>
    <section class="card">
      <div class="form-grid four">
        <${Field} label="Invoice date"><input type="date" value=${inv.issued_on} onInput=${(e) => edit({ issued_on: e.target.value })} /></${Field}>
        <${Field} label="Due date"><input type="date" value=${inv.due_on} onInput=${(e) => edit({ due_on: e.target.value })} /></${Field}>
        <${Field} label="Tax rate (%)"><input type="number" step="any" value=${inv.tax_rate} onInput=${(e) => edit({ tax_rate: e.target.value })} /></${Field}>
        <${Field} label="Discount ($)"><input type="number" step="any" value=${inv.discount} onInput=${(e) => edit({ discount: e.target.value })} /></${Field}>
      </div>
      <table class="tbl inv-lines"><thead><tr><th>Description</th><th class="r w80">Qty</th><th class="r w120">Rate</th><th class="r w120">Amount</th><th></th></tr></thead>
        <tbody>${items.map((l, i) => html`<tr>
          <td><input value=${l.description} onInput=${(e) => setItem(i, { description: e.target.value })} /></td>
          <td><input class="r" type="number" step="any" value=${l.qty} onInput=${(e) => setItem(i, { qty: e.target.value })} /></td>
          <td><input class="r" type="number" step="any" value=${l.unit_price} onInput=${(e) => setItem(i, { unit_price: e.target.value })} /></td>
          <td class="r">${money(l.line_total)}</td>
          <td><button class="icon-btn sm danger" onClick=${() => edit({ items: inv.items.filter((_, j) => j !== i) })}>✕</button></td></tr>`)}</tbody></table>
      <button class="btn" onClick=${() => edit({ items: [...inv.items, { description: '', qty: 1, unit_price: 0 }] })}>+ Add line</button>
    </section>
    <div class="grid2">
      <section class="card">
        <${Field} label="Notes on invoice"><textarea rows="3" value=${inv.notes} onInput=${(e) => edit({ notes: e.target.value })}></textarea></${Field}>
        <h3 class="sect">Payments</h3>
        ${data.invoice.payments.length ? html`<ul class="list">${data.invoice.payments.map((p) => html`<li><div class="row-main">${fmtDate(p.paid_on)} · ${p.method}${p.note ? ' · ' + p.note : ''}
            <span class="right"><b>${money(p.amount)}</b> <button class="link sm" onClick=${() => confirmDo('Remove this payment?', async () => { if (await attempt(() => api('DELETE', '/api/payments/' + p.id))) reload(); })}>remove</button></span></div></li>`)}</ul>`
          : html`<p class="muted">No payments yet.</p>`}
      </section>
      <section class="card totals-card">
        <div class="trow"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
        ${Number(inv.discount) > 0 && html`<div class="trow"><span>Discount</span><b>−${money(inv.discount)}</b></div>`}
        ${Number(inv.tax_rate) > 0 && html`<div class="trow"><span>Tax (${inv.tax_rate}%)</span><b>${money(t.tax)}</b></div>`}
        <div class="trow grand"><span>Total</span><b>${money(t.total)}</b></div>
        <div class="trow"><span>Paid</span><b>${money(paid)}</b></div>
        <div class="trow grand"><span>Balance due</span><b class=${t.total - paid > 0 ? 'neg' : ''}>${money(r2(t.total - paid))}</b></div>
      </section>
    </div>
    ${modal === 'send' && html`<${SendModal} kind="invoice" doc=${inv} customer=${customer} onClose=${() => setModal(null)} onSent=${reload} />`}
    ${modal === 'pay' && html`<${PaymentModal} inv=${data.invoice} onClose=${() => setModal(null)} onSaved=${reload} />`}
  `;
}
