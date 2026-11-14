'use strict';
// Server-rendered, printable quote & invoice documents (also used for customer-facing links and emails).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(String(d).length <= 10 ? d + 'T12:00:00' : String(d).replace(' ', 'T') + 'Z');
  return isNaN(dt) ? esc(d) : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};
const num = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''); };

const UNIT_LABEL = { each: 'ea', sqft: 'sq ft', ui: 'UI', lf: 'lin ft', hour: 'hr', percent: '%' };

function sizeText(it) {
  if (!(Number(it.width) > 0 && Number(it.height) > 0)) return '';
  return `${num(it.width)}" W × ${num(it.height)}" H`;
}

const STYLE = `
  *{box-sizing:border-box} body{margin:0;background:#eef1f5;color:#1b2430;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .page{max-width:860px;margin:24px auto;background:#fff;padding:40px 44px;border-radius:10px;box-shadow:0 2px 14px rgba(0,0,0,.08)}
  .top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #1f5fa8;padding-bottom:18px;margin-bottom:22px}
  .co h1{margin:0 0 4px;font-size:22px;color:#1f5fa8} .co div{color:#4a5563;font-size:13px}
  .doc{text-align:right} .doc h2{margin:0;font-size:26px;letter-spacing:.04em;text-transform:uppercase;color:#1b2430}
  .doc table{margin-left:auto;margin-top:6px;font-size:13px} .doc td{padding:1px 0 1px 12px} .doc td:first-child{color:#6b7684}
  .parties{display:flex;gap:40px;margin-bottom:22px;flex-wrap:wrap} .parties h3{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7684}
  table.items{width:100%;border-collapse:collapse;margin-bottom:16px}
  table.items th{background:#f2f5f9;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#4a5563;padding:8px}
  table.items td{padding:9px 8px;border-bottom:1px solid #e6e9ee;vertical-align:top}
  table.items .r{text-align:right;white-space:nowrap} .sub{color:#6b7684;font-size:12px}
  .totals{margin-left:auto;width:300px;font-size:14px;border-collapse:collapse} .totals td{padding:4px 0} .totals td:last-child{text-align:right}
  .totals .grand td{border-top:2px solid #1b2430;font-weight:700;font-size:17px;padding-top:8px}
  .box{background:#f7f9fb;border:1px solid #e6e9ee;border-radius:8px;padding:12px 14px;margin-top:18px;font-size:13px}
  .box h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#4a5563}
  .status{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;background:#e7eef8;color:#1f5fa8}
  .status.accepted,.status.paid{background:#e3f4e8;color:#1d7a3a} .status.declined,.status.void{background:#fbe8e8;color:#b42318}
  .actions{max-width:860px;margin:16px auto 0;display:flex;gap:10px;justify-content:flex-end;padding:0 4px}
  button,.btn{font:inherit;border:0;border-radius:8px;padding:10px 18px;background:#1f5fa8;color:#fff;cursor:pointer;text-decoration:none}
  button.secondary{background:#fff;color:#1b2430;border:1px solid #cdd3db}
  .accept{margin-top:22px;border:2px solid #1f5fa8;border-radius:10px;padding:16px} .accept input{font:inherit;padding:9px 10px;border:1px solid #cdd3db;border-radius:8px;width:260px;max-width:100%}
  .sig{display:flex;gap:40px;margin-top:40px} .sig div{flex:1;border-top:1px solid #1b2430;padding-top:4px;font-size:12px;color:#6b7684}
  .paid-banner{background:#e3f4e8;color:#1d7a3a;font-weight:700;padding:10px 14px;border-radius:8px;margin-bottom:16px}
  @media (max-width:640px){.page{margin:0;border-radius:0;padding:22px 16px}.top{flex-direction:column}.doc{text-align:left}.doc table{margin-left:0}.totals{width:100%}table.items th:nth-child(1),table.items td:nth-child(1){display:none}}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:0}.actions,.accept form,.noprint{display:none!important}}
`;

function companyBlock(s) {
  return `<div class="co"><h1>${esc(s.company_name)}</h1>
    <div>${nl2br(s.company_address)}</div>
    <div>${esc(s.company_phone)}${s.company_email ? ' · ' + esc(s.company_email) : ''}</div>
    ${s.company_website ? `<div>${esc(s.company_website)}</div>` : ''}
    ${s.license_no ? `<div>License #${esc(s.license_no)}</div>` : ''}</div>`;
}

function customerBlock(c, job) {
  const site = [job.site_address, [job.site_city, job.site_state].filter(Boolean).join(', ') + (job.site_zip ? ' ' + job.site_zip : '')].filter((x) => x && x.trim());
  const bill = [c.address, [c.city, c.state].filter(Boolean).join(', ') + (c.zip ? ' ' + c.zip : '')].filter((x) => x && x.trim());
  const sameSite = site.join('|') === bill.join('|') || site.length === 0;
  return `<div class="parties">
    <div><h3>Prepared for</h3><strong>${esc(c.company || c.name)}</strong>${c.company ? `<br>Attn: ${esc(c.name)}` : ''}
      ${bill.length ? '<br>' + bill.map(esc).join('<br>') : ''}${c.phone ? '<br>' + esc(c.phone) : ''}${c.email ? '<br>' + esc(c.email) : ''}</div>
    ${sameSite ? '' : `<div><h3>Job site</h3>${site.map(esc).join('<br>')}</div>`}
    <div><h3>Project</h3>${esc(job.title)}</div>
  </div>`;
}

function shell(title, inner, withScript = true) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title><style>${STYLE}</style>${withScript ? '<script src="/doc.js" defer></script>' : ''}</head><body>${inner}</body></html>`;
}

function quoteItemsTable(items) {
  const rows = items.map((it, i) => {
    const opts = (it.options || []).map((o) => esc(o.name)).join(', ');
    const size = sizeText(it);
    return `<tr><td>${i + 1}</td>
      <td><strong>${esc(it.name)}</strong>${it.location ? ` <span class="sub">— ${esc(it.location)}</span>` : ''}
        ${size ? `<div class="sub">${size}</div>` : ''}${opts ? `<div class="sub">Options: ${opts}</div>` : ''}${it.note ? `<div class="sub">${esc(it.note)}</div>` : ''}</td>
      <td class="r">${num(it.qty)}${it.unit === 'hour' ? ' hr' : ''}</td>
      <td class="r">${money(it.qty ? it.line_total / it.qty : 0)}</td>
      <td class="r">${money(it.line_total)}</td></tr>`;
  }).join('');
  return `<table class="items"><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Each</th><th class="r">Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="sub">No items</td></tr>'}</tbody></table>`;
}

function totalsTable(d, extraRows = '') {
  return `<table class="totals">
    <tr><td>Subtotal</td><td>${money(d.subtotal)}</td></tr>
    ${Number(d.discount) ? `<tr><td>Discount</td><td>−${money(d.discount)}</td></tr>` : ''}
    ${Number(d.tax_rate) ? `<tr><td>Tax (${num(d.tax_rate)}%)</td><td>${money(d.tax)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td>${money(d.total)}</td></tr>${extraRows}</table>`;
}

function renderQuote({ settings: s, quote: q, items, job, customer, mode }) {
  // mode: 'print' (staff) | 'public' (customer link) | 'email'
  const deposit = Number(q.deposit_pct) ? Math.round(q.total * q.deposit_pct) / 100 : 0;
  const depositRow = deposit ? `<tr><td>Deposit due (${num(q.deposit_pct)}%)</td><td>${money(deposit)}</td></tr>` : '';
  let accept = '';
  if (mode === 'public') {
    if (q.status === 'accepted') accept = `<div class="accept"><strong>✓ Accepted</strong> by ${esc(q.accepted_name)} on ${fmtDate(q.accepted_at)}. Thank you! We'll be in touch to schedule.</div>`;
    else if (q.status === 'declined') accept = `<div class="accept">This quote was declined. Contact us at ${esc(s.company_phone)} if you'd like to revisit it.</div>`;
    else accept = `<div class="accept"><h3 style="margin:0 0 8px">Ready to go ahead?</h3>
      <form method="post" action="/q/${esc(q.token)}/accept"><p style="margin:0 0 10px">Type your full name to accept this quote${deposit ? ` (a ${money(deposit)} deposit will be due)` : ''}.</p>
      <input name="name" required maxlength="120" placeholder="Full name" autocomplete="name"> <button type="submit">Accept quote</button></form></div>`;
  }
  const inner = `
  ${mode !== 'email' ? `<div class="actions noprint">${mode === 'print' ? '<button class="secondary" data-act="back">Back</button>' : ''}<button data-act="print">Print / Save PDF</button></div>` : ''}
  <div class="page">
    <div class="top">${companyBlock(s)}
      <div class="doc"><h2>Quote</h2><table>
        <tr><td>Quote #</td><td><strong>${esc(q.number)}</strong></td></tr>
        <tr><td>Date</td><td>${fmtDate(q.sent_at || q.created_at)}</td></tr>
        ${q.valid_until ? `<tr><td>Valid until</td><td>${fmtDate(q.valid_until)}</td></tr>` : ''}
        ${mode !== 'email' ? `<tr><td>Status</td><td><span class="status ${esc(q.status)}">${esc(q.status)}</span></td></tr>` : ''}
      </table></div></div>
    ${customerBlock(customer, job)}
    ${quoteItemsTable(items)}
    ${totalsTable(q, depositRow)}
    ${q.notes ? `<div class="box"><h3>Notes</h3>${nl2br(q.notes)}</div>` : ''}
    ${q.terms ? `<div class="box"><h3>Terms</h3>${nl2br(q.terms)}</div>` : ''}
    ${accept}
    ${mode === 'print' ? `<div class="sig"><div>Customer signature</div><div>Date</div></div>` : ''}
  </div>`;
  return shell(`Quote ${q.number} — ${s.company_name}`, inner, mode !== 'email');
}

function renderInvoice({ settings: s, invoice: inv, items, payments, job, customer, mode }) {
  const paid = payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const balance = Math.round((inv.total - paid) * 100) / 100;
  const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.description)}</td><td class="r">${num(it.qty)}</td><td class="r">${money(it.unit_price)}</td><td class="r">${money(it.line_total)}</td></tr>`).join('');
  const payRows = payments.map((p) => `<tr><td>Payment ${fmtDate(p.paid_on)}${p.method ? ' (' + esc(p.method) + ')' : ''}</td><td>−${money(p.amount)}</td></tr>`).join('');
  const inner = `
  ${mode !== 'email' ? `<div class="actions noprint">${mode === 'print' ? '<button class="secondary" data-act="back">Back</button>' : ''}<button data-act="print">Print / Save PDF</button></div>` : ''}
  <div class="page">
    <div class="top">${companyBlock(s)}
      <div class="doc"><h2>Invoice</h2><table>
        <tr><td>Invoice #</td><td><strong>${esc(inv.number)}</strong></td></tr>
        <tr><td>Date</td><td>${fmtDate(inv.issued_on)}</td></tr>
        ${inv.due_on ? `<tr><td>Due</td><td>${fmtDate(inv.due_on)}</td></tr>` : ''}
        <tr><td>Balance due</td><td><strong>${money(Math.max(0, balance))}</strong></td></tr>
      </table></div></div>
    ${inv.status === 'paid' || (balance <= 0 && inv.total > 0) ? '<div class="paid-banner">PAID IN FULL — thank you!</div>' : ''}
    ${customerBlock(customer, job)}
    <table class="items"><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="sub">No items</td></tr>'}</tbody></table>
    ${totalsTable(inv, payRows + (payments.length ? `<tr class="grand"><td>Balance due</td><td>${money(Math.max(0, balance))}</td></tr>` : ''))}
    ${inv.notes ? `<div class="box"><h3>Notes</h3>${nl2br(inv.notes)}</div>` : ''}
    <div class="box"><h3>How to pay</h3>Please reference invoice <strong>${esc(inv.number)}</strong> with your payment. Questions? Call ${esc(s.company_phone)}${s.company_email ? ' or email ' + esc(s.company_email) : ''}.</div>
  </div>`;
  return shell(`Invoice ${inv.number} — ${s.company_name}`, inner, mode !== 'email');
}

function simplePage(title, message) {
  return shell(title, `<div class="page"><h2 style="margin-top:0">${esc(title)}</h2><p>${message}</p></div>`);
}

module.exports = { renderQuote, renderInvoice, simplePage, esc, money, fmtDate, UNIT_LABEL };
