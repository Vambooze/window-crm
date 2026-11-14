import { html, useState, useData, Link, Loading, ErrorBox, PageHead, money0, money, fmtDateTime, fmtDate, daysSince, STAGES, STAGE_LABEL, EVENT_LABEL, addressLine } from '../lib.js';
import { NewLeadModal } from './jobs.js';

export function Dashboard() {
  const { data: d, error, loading, reload } = useData('/api/dashboard');
  const [lead, setLead] = useState(false);
  if (loading && !d) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const byStage = Object.fromEntries(d.pipeline.map((p) => [p.stage, p]));
  const openStages = STAGES.filter(([s]) => !['paid', 'lost'].includes(s));
  const maxN = Math.max(1, ...d.pipeline.map((p) => p.n));
  const month = new Date().toLocaleDateString('en-US', { month: 'long' });
  return html`
    <${PageHead} title="Dashboard" sub=${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}>
      <button class="btn primary" onClick=${() => setLead(true)}>+ New lead</button>
    </${PageHead}>
    <div class="kpis">
      <div class="kpi"><span>New leads · ${month}</span><b>${d.newLeads}</b></div>
      <div class="kpi"><span>Quotes sent · ${month}</span><b>${money0(d.quotesSent.v)}</b><small>${d.quotesSent.n} quotes</small></div>
      <div class="kpi"><span>Sold · ${month}</span><b>${money0(d.quotesWon.v)}</b><small>${d.quotesWon.n} accepted</small></div>
      <div class="kpi"><span>Close rate · 90 days</span><b>${d.winRate == null ? '—' : d.winRate + '%'}</b></div>
      <div class="kpi"><span>Collected · ${month}</span><b>${money0(d.collected)}</b></div>
      <div class="kpi"><span>Outstanding invoices</span><b>${money0(d.outstanding)}</b></div>
    </div>

    <section class="card">
      <div class="card-head"><h2>Pipeline</h2><${Link} href="/jobs">Open board →</${Link}></div>
      <div class="pipe">${openStages.map(([s, label]) => {
        const p = byStage[s] || { n: 0, value: 0 };
        return html`<${Link} href=${'/jobs?stage=' + s} class="pipe-row">
          <span class="pipe-label">${label}</span>
          <span class="pipe-bar"><i class="st-bg-${s}" style=${`width:${(p.n / maxN) * 100}%`}></i></span>
          <span class="pipe-n">${p.n}</span><span class="pipe-v">${money0(p.value)}</span></${Link}>`;
      })}</div>
    </section>

    <div class="grid2">
      <section class="card">
        <div class="card-head"><h2>Coming up</h2><${Link} href="/schedule">Schedule →</${Link}></div>
        ${d.upcoming.length ? html`<ul class="list">${d.upcoming.slice(0, 10).map((e) => html`<li>
          <${Link} href=${e.job_id ? '/jobs/' + e.job_id : '/schedule'}>
            <div class="row-main"><span class="badge ev-${e.kind}">${EVENT_LABEL[e.kind]}</span> <b>${e.customer_name || e.title || 'Appointment'}</b></div>
            <div class="row-sub">${fmtDateTime(e.starts_at)}${e.user_name ? ' · ' + e.user_name : ' · unassigned'}${e.site_address ? ' · ' + addressLine(e, 'site_') : ''}</div>
          </${Link}></li>`)}</ul>` : html`<p class="muted">Nothing scheduled for the next week.</p>`}
      </section>

      <section class="card">
        <div class="card-head"><h2>Quotes to follow up</h2><${Link} href="/quotes?status=sent">All sent →</${Link}></div>
        ${d.followups.length ? html`<ul class="list">${d.followups.map((q) => html`<li><${Link} href=${'/jobs/' + q.job_id}>
            <div class="row-main"><b>${q.customer_name}</b> <span class="muted">${q.number}</span><span class="right">${money0(q.total)}</span></div>
            <div class="row-sub">Sent ${daysSince(q.sent_at)} days ago · ${q.job_title}${q.customer_phone ? ' · ' + q.customer_phone : ''}</div>
          </${Link}></li>`)}</ul>` : html`<p class="muted">No quotes waiting more than 3 days. Nice.</p>`}
      </section>

      <section class="card">
        <div class="card-head"><h2>Leads needing a quote</h2></div>
        ${d.needsQuote.length ? html`<ul class="list">${d.needsQuote.map((j) => html`<li><${Link} href=${'/jobs/' + j.id}>
            <div class="row-main"><b>${j.customer_name}</b><span class="right badge st-${j.stage}">${STAGE_LABEL[j.stage]}</span></div>
            <div class="row-sub">${j.title}</div></${Link}></li>`)}</ul>` : html`<p class="muted">Every open lead has a quote.</p>`}
      </section>

      <section class="card">
        <div class="card-head"><h2>Overdue invoices</h2><${Link} href="/invoices">Invoices →</${Link}></div>
        ${d.overdue.length ? html`<ul class="list">${d.overdue.map((i) => html`<li><${Link} href=${'/invoices/' + i.id}>
            <div class="row-main"><b>${i.customer_name}</b> <span class="muted">${i.number}</span><span class="right neg">${money(i.balance)}</span></div>
            <div class="row-sub">Due ${fmtDate(i.due_on)}</div></${Link}></li>`)}</ul>` : html`<p class="muted">Nothing overdue.</p>`}
      </section>
    </div>
    ${lead && html`<${NewLeadModal} onClose=${() => setLead(false)} />`}
  `;
}
