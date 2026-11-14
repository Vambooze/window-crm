'use strict';
// Window company CRM — zero-dependency Node.js server.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, DATA_DIR, hashPassword, verifyPassword, getSettings, setSetting, nextNumber, tx } = require('./db');
const pricing = require('./lib/pricing');
const docs = require('./lib/docs');
const { sendMail } = require('./lib/smtp');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_DAYS = 30;

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in server TZ
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toLocaleDateString('en-CA'); };
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const numv = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const token = () => crypto.randomBytes(18).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const STAGES = ['lead', 'estimate', 'measured', 'quoted', 'won', 'ordered', 'scheduled', 'installed', 'invoiced', 'paid', 'lost'];
const STAGE_RANK = Object.fromEntries(STAGES.map((s, i) => [s, i]));
const JOB_KINDS = ['replacement', 'new_construction', 'repair', 'service'];
const EVENT_KINDS = ['estimate', 'measure', 'install', 'repair', 'service', 'followup', 'other'];
const UNITS = ['each', 'sqft', 'ui', 'lf', 'hour', 'percent'];
const CATEGORIES = ['window', 'door', 'option', 'labor', 'repair', 'other'];

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function sendHtml(res, status, html, csp) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': csp || "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(html);
}
function redirect(res, to) { res.writeHead(303, { Location: to }); res.end(); }

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Upload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 2 * 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { bad('Invalid JSON'); }
}
async function readForm(req) {
  const buf = await readBody(req, 64 * 1024);
  return Object.fromEntries(new URLSearchParams(buf.toString('utf8')));
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted; }
function baseUrl(req) {
  const s = getSettings();
  if (s.public_url) return s.public_url.replace(/\/+$/, '');
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress; }

// ---------- auth ----------
function getUser(req) {
  const t = parseCookies(req).sid;
  if (!t) return null;
  const row = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.must_change_pw, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha(t));
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  return row;
}
function createSession(res, req, userId) {
  const t = crypto.randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)').run(sha(t), userId, exp);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  res.setHeader('Set-Cookie', `sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`);
}
const loginAttempts = new Map(); // ip -> {count, until}
function checkRate(ip) {
  const a = loginAttempts.get(ip);
  if (a && a.until > Date.now() && a.count >= 8) throw new HttpError(429, 'Too many login attempts. Try again in 15 minutes.');
}
function noteFail(ip) {
  const a = loginAttempts.get(ip);
  if (!a || a.until < Date.now()) loginAttempts.set(ip, { count: 1, until: Date.now() + 15 * 60e3 });
  else a.count++;
}

// ---------- activity ----------
function log(jobId, userId, body, kind = 'system') {
  const job = jobId ? db.prepare('SELECT customer_id FROM jobs WHERE id = ?').get(jobId) : null;
  db.prepare('INSERT INTO activity (job_id, customer_id, user_id, kind, body) VALUES (?,?,?,?,?)').run(jobId || null, job ? job.customer_id : null, userId || null, kind, body);
}
function advanceStage(jobId, stage, userId) {
  const job = db.prepare('SELECT stage FROM jobs WHERE id = ?').get(jobId);
  if (!job || job.stage === 'lost') return;
  if (STAGE_RANK[stage] > STAGE_RANK[job.stage]) {
    db.prepare("UPDATE jobs SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(stage, jobId);
    log(jobId, userId, `Stage moved to "${stage}"`);
  }
}

// ---------- access helpers ----------
function installerCanSeeJob(user, jobId) {
  const j = db.prepare('SELECT installer_id FROM jobs WHERE id = ?').get(jobId);
  if (!j) return false;
  if (j.installer_id === user.id) return true;
  return !!db.prepare('SELECT 1 FROM events WHERE job_id = ? AND user_id = ? LIMIT 1').get(jobId, user.id);
}
function assertJobAccess(user, jobId) {
  if (user.role === 'office') return;
  if (!installerCanSeeJob(user, jobId)) throw new HttpError(403, 'Not your job');
}

// ---------- data loaders ----------
function loadQuote(id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!q) return null;
  q.items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort, id').all(id).map((i) => ({ ...i, options: JSON.parse(i.options || '[]') }));
  return q;
}
function loadInvoice(id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) return null;
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id').all(id);
  inv.payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, id').all(id);
  inv.paid = pricing.r2(inv.payments.reduce((a, p) => a + p.amount, 0));
  inv.balance = pricing.r2(inv.total - inv.paid);
  return inv;
}
function jobWithCustomer(jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return {};
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(job.customer_id);
  return { job, customer };
}
function refreshInvoiceStatus(invoiceId) {
  const inv = loadInvoice(invoiceId);
  if (!inv || inv.status === 'void') return;
  if (inv.total > 0 && inv.balance <= 0 && inv.status !== 'paid') {
    db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(invoiceId);
    // Job is paid when every non-void invoice is paid.
    const open = db.prepare("SELECT COUNT(*) c FROM invoices WHERE job_id = ? AND status NOT IN ('paid','void')").get(inv.job_id).c;
    if (!open) advanceStage(inv.job_id, 'paid');
  } else if (inv.balance > 0 && inv.status === 'paid') {
    db.prepare("UPDATE invoices SET status = ? WHERE id = ?").run(inv.sent_at ? 'sent' : 'draft', invoiceId);
  }
}

// ---------- email ----------
function smtpConfig() {
  const s = getSettings();
  if (!s.smtp_host) throw new HttpError(400, 'Email is not set up yet. Add SMTP details in Settings → Email.');
  return { host: s.smtp_host, port: s.smtp_port, user: s.smtp_user, pass: s.smtp_pass, from: s.smtp_from || `${s.company_name} <${s.smtp_user}>` };
}
function emailWrap(settings, messageHtml, link, linkLabel) {
  return `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1b2430;max-width:560px">
    ${messageHtml}
    <p style="margin:24px 0"><a href="${docs.esc(link)}" style="background:#1f5fa8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${docs.esc(linkLabel)}</a></p>
    <p style="color:#6b7684;font-size:13px">${docs.esc(settings.company_name)} · ${docs.esc(settings.company_phone)}</p></div>`;
}

// ---------- router ----------
const routes = [];
function route(method, pattern, role, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, role, handler });
}
const OFFICE = 'office', ANY = 'any', PUBLIC = 'public';

// ===== Auth =====
route('POST', '/api/login', PUBLIC, async ({ req, res }) => {
  const ip = clientIp(req);
  checkRate(ip);
  const { email, password } = await readJson(req);
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(str(email, 200));
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) { noteFail(ip); throw new HttpError(401, 'Wrong email or password'); }
  loginAttempts.delete(ip);
  createSession(res, req, u.id);
  return { ok: true };
});
route('POST', '/api/logout', PUBLIC, ({ req, res }) => {
  const t = parseCookies(req).sid;
  if (t) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(t));
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return { ok: true };
});
route('GET', '/api/me', ANY, ({ user }) => {
  const s = getSettings();
  return { user, company_name: s.company_name };
});
route('POST', '/api/me/password', ANY, async ({ req, res, user }) => {
  const { current, next } = await readJson(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(String(current || ''), u.password_hash)) throw new HttpError(400, 'Current password is wrong');
  if (String(next || '').length < 8) bad('New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').run(hashPassword(String(next)), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  createSession(res, req, user.id);
  return { ok: true };
});
route('PUT', '/api/me', ANY, async ({ req, user }) => {
  const b = await readJson(req);
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(str(b.name, 120) || user.name, str(b.phone, 40), user.id);
  return { ok: true };
});

// ===== Users =====
route('GET', '/api/users', OFFICE, () => db.prepare('SELECT id, name, email, phone, role, active, must_change_pw, created_at FROM users ORDER BY active DESC, name').all());
route('POST', '/api/users', OFFICE, async ({ req, user }) => {
  const b = await readJson(req);
  const email = str(b.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) bad('Enter a valid email');
  if (!str(b.name)) bad('Name is required');
  if (String(b.password || '').length < 8) bad('Temporary password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) bad('A user with that email already exists');
  const r = db.prepare('INSERT INTO users (name, email, phone, role, password_hash, must_change_pw) VALUES (?,?,?,?,?,1)')
    .run(str(b.name, 120), email, str(b.phone, 40), oneOf(b.role, ['office', 'installer'], 'installer'), hashPassword(String(b.password)));
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/users/:id', OFFICE, async ({ req, params, user }) => {
  const b = await readJson(req);
  const id = Number(params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'User not found');
  const role = oneOf(b.role, ['office', 'installer'], u.role);
  const active = b.active === undefined ? u.active : (b.active ? 1 : 0);
  if (id === user.id && (role !== 'office' || !active)) bad("You can't remove your own office access");
  if (u.role === 'office' && (role !== 'office' || !active)) {
    const others = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'office' AND active = 1 AND id != ?").get(id).c;
    if (!others) bad('At least one active office user is required');
  }
  const email = b.email ? str(b.email, 200).toLowerCase() : u.email;
  if (email !== u.email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, id)) bad('Email already in use');
  db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, active = ? WHERE id = ?')
    .run(str(b.name ?? u.name, 120), email, str(b.phone ?? u.phone, 40), role, active, id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  if (b.password) {
    if (String(b.password).length < 8) bad('Password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?').run(hashPassword(String(b.password)), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  return { ok: true };
});
route('GET', '/api/staff', OFFICE, () => db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY role DESC, name').all());

// ===== Settings =====
const SETTING_KEYS = ['company_name', 'company_address', 'company_phone', 'company_email', 'company_website', 'license_no', 'default_tax_rate',
  'default_deposit_pct', 'quote_valid_days', 'invoice_due_days', 'next_quote_no', 'next_invoice_no', 'quote_terms', 'invoice_notes', 'public_url',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];
route('GET', '/api/settings', OFFICE, () => {
  const s = getSettings();
  return { ...s, smtp_pass: s.smtp_pass ? '********' : '' };
});
route('PUT', '/api/settings', OFFICE, async ({ req }) => {
  const b = await readJson(req);
  tx(() => {
    for (const k of SETTING_KEYS) {
      if (!(k in b)) continue;
      if (k === 'smtp_pass' && b[k] === '********') continue;
      setSetting(k, str(b[k], 5000));
    }
  });
  return { ok: true };
});
route('POST', '/api/settings/test-email', OFFICE, async ({ req, user }) => {
  const { to } = await readJson(req);
  const s = getSettings();
  await sendMail(smtpConfig(), { to: str(to, 200) || user.email, subject: `Test email from ${s.company_name} CRM`, text: 'Your CRM email settings work.', html: '<p>Your CRM email settings work. ✅</p>' })
    .catch((e) => { throw new HttpError(400, 'Email failed: ' + e.message); });
  return { ok: true };
});

// ===== Customers =====
route('GET', '/api/customers', OFFICE, ({ url }) => {
  const q = `%${str(url.searchParams.get('q'), 100)}%`;
  const type = url.searchParams.get('type');
  return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id) job_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id AND j.stage NOT IN ('paid','lost')) open_jobs
    FROM customers c WHERE (c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.address LIKE ? OR c.city LIKE ?)
    ${type ? 'AND c.type = ?' : ''} ORDER BY c.created_at DESC LIMIT 500`).all(q, q, q, q, q, q, ...(type ? [type] : []));
});
function customerFields(b, old = {}) {
  const f = {};
  for (const k of ['name', 'company', 'email', 'phone', 'phone2', 'address', 'city', 'state', 'zip', 'source', 'notes']) f[k] = str(b[k] ?? old[k] ?? '', k === 'notes' ? 5000 : 200);
  f.type = oneOf(b.type, ['residential', 'commercial'], old.type || 'residential');
  if (!f.name) bad('Customer name is required');
  return f;
}
route('POST', '/api/customers', OFFICE, async ({ req }) => {
  const f = customerFields(await readJson(req));
  const r = db.prepare('INSERT INTO customers (type,name,company,email,phone,phone2,address,city,state,zip,source,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(f.type, f.name, f.company, f.email, f.phone, f.phone2, f.address, f.city, f.state, f.zip, f.source, f.notes);
  return { id: Number(r.lastInsertRowid) };
});
route('GET', '/api/customers/:id', OFFICE, ({ params }) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(params.id);
  if (!c) throw new HttpError(404, 'Customer not found');
  c.jobs = db.prepare(`SELECT j.*, (SELECT MAX(total) FROM quotes q WHERE q.job_id = j.id) quote_total FROM jobs j WHERE customer_id = ? ORDER BY created_at DESC`).all(c.id);
  c.activity = db.prepare(`SELECT a.*, u.name user_name, j.title job_title FROM activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.customer_id = ? ORDER BY a.created_at DESC LIMIT 50`).all(c.id);
  return c;
});
route('PUT', '/api/customers/:id', OFFICE, async ({ req, params }) => {
  const old = db.prepare('SELECT * FROM customers WHERE id = ?').get(params.id);
  if (!old) throw new HttpError(404, 'Customer not found');
  const f = customerFields(await readJson(req), old);
  db.prepare('UPDATE customers SET type=?,name=?,company=?,email=?,phone=?,phone2=?,address=?,city=?,state=?,zip=?,source=?,notes=? WHERE id=?')
    .run(f.type, f.name, f.company, f.email, f.phone, f.phone2, f.address, f.city, f.state, f.zip, f.source, f.notes, old.id);
  return { ok: true };
});
route('DELETE', '/api/customers/:id', OFFICE, ({ params }) => {
  for (const p of db.prepare('SELECT p.filename FROM photos p JOIN jobs j ON j.id = p.job_id WHERE j.customer_id = ?').all(params.id)) {
    fs.rm(path.join(UPLOAD_DIR, p.filename), () => {});
  }
  db.prepare('DELETE FROM customers WHERE id = ?').run(params.id);
  return { ok: true };
});

// ===== Jobs =====
route('GET', '/api/jobs', OFFICE, ({ url }) => {
  const q = `%${str(url.searchParams.get('q'), 100)}%`;
  const stage = url.searchParams.get('stage');
  const kind = url.searchParams.get('kind');
  const open = url.searchParams.get('open');
  const where = ['(j.title LIKE ? OR c.name LIKE ? OR c.company LIKE ? OR j.site_address LIKE ? OR c.address LIKE ?)'];
  const args = [q, q, q, q, q];
  if (stage) { where.push('j.stage = ?'); args.push(stage); }
  if (kind) { where.push('j.kind = ?'); args.push(kind); }
  if (open) where.push("j.stage NOT IN ('paid','lost')");
  return db.prepare(`SELECT j.*, c.name customer_name, c.company customer_company, c.type customer_type, c.phone customer_phone, u.name installer_name,
      (SELECT total FROM quotes q WHERE q.job_id = j.id ORDER BY (q.status='accepted') DESC, q.id DESC LIMIT 1) quote_total,
      (SELECT MIN(starts_at) FROM events e WHERE e.job_id = j.id AND e.status = 'scheduled' AND e.starts_at >= ?) next_event
    FROM jobs j JOIN customers c ON c.id = j.customer_id LEFT JOIN users u ON u.id = j.installer_id
    WHERE ${where.join(' AND ')} ORDER BY j.updated_at DESC LIMIT 1000`).all(today(), ...args);
});
function jobFields(b, old = {}) {
  const f = {};
  for (const k of ['title', 'site_address', 'site_city', 'site_state', 'site_zip', 'description', 'lost_reason']) f[k] = str(b[k] ?? old[k] ?? '', k === 'description' ? 5000 : 300);
  f.kind = oneOf(b.kind, JOB_KINDS, old.kind || 'replacement');
  f.stage = oneOf(b.stage, STAGES, old.stage || 'lead');
  f.installer_id = b.installer_id === undefined ? (old.installer_id ?? null) : (b.installer_id ? Number(b.installer_id) : null);
  f.est_value = numv(b.est_value ?? old.est_value, 0);
  if (!f.title) bad('Job title is required');
  return f;
}
route('POST', '/api/jobs', OFFICE, async ({ req, user }) => {
  const b = await readJson(req);
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(b.customer_id);
  if (!c) bad('Pick a customer');
  if (!b.site_address && !b.site_city) Object.assign(b, { site_address: c.address, site_city: c.city, site_state: c.state, site_zip: c.zip });
  const f = jobFields(b);
  const r = db.prepare('INSERT INTO jobs (customer_id,title,kind,stage,site_address,site_city,site_state,site_zip,installer_id,est_value,description) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(c.id, f.title, f.kind, f.stage, f.site_address, f.site_city, f.site_state, f.site_zip, f.installer_id, f.est_value, f.description);
  const id = Number(r.lastInsertRowid);
  log(id, user.id, `Job created (${f.kind.replace('_', ' ')})`);
  return { id };
});
route('GET', '/api/jobs/:id', ANY, ({ params, user }) => {
  const id = Number(params.id);
  assertJobAccess(user, id);
  const { job, customer } = jobWithCustomer(id);
  if (!job) throw new HttpError(404, 'Job not found');
  const events = db.prepare('SELECT e.*, u.name user_name FROM events e LEFT JOIN users u ON u.id = e.user_id WHERE job_id = ? ORDER BY starts_at').all(id);
  const activity = db.prepare('SELECT a.*, u.name user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE job_id = ? ORDER BY a.created_at DESC, a.id DESC').all(id);
  const photos = db.prepare('SELECT p.id, p.caption, p.created_at, u.name user_name FROM photos p LEFT JOIN users u ON u.id = p.user_id WHERE job_id = ? ORDER BY p.id DESC').all(id);
  const installer = job.installer_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(job.installer_id) : null;
  if (user.role !== 'office') {
    // Installer view: no prices, no invoices.
    const q = db.prepare("SELECT id FROM quotes WHERE job_id = ? ORDER BY (status='accepted') DESC, id DESC LIMIT 1").get(id);
    const items = q ? loadQuote(q.id).items.map((i) => ({ name: i.name, location: i.location, width: i.width, height: i.height, qty: i.qty, unit: i.unit, note: i.note, options: i.options.map((o) => ({ name: o.name })) })) : [];
    const { est_value, lost_reason, ...safeJob } = job;
    return {
      job: safeJob, installer, events: events.filter((e) => e.user_id === user.id || user.role === 'office'), activity, photos, items,
      customer: { name: customer.name, company: customer.company, phone: customer.phone, phone2: customer.phone2, email: customer.email, type: customer.type },
    };
  }
  const quotes = db.prepare('SELECT id, number, status, total, created_at, sent_at, accepted_at FROM quotes WHERE job_id = ? ORDER BY id DESC').all(id);
  const invoices = db.prepare('SELECT id FROM invoices WHERE job_id = ? ORDER BY id DESC').all(id).map((r) => {
    const inv = loadInvoice(r.id); delete inv.items; return inv;
  });
  return { job, customer, installer, events, activity, photos, quotes, invoices };
});
route('PUT', '/api/jobs/:id', OFFICE, async ({ req, params, user }) => {
  const old = db.prepare('SELECT * FROM jobs WHERE id = ?').get(params.id);
  if (!old) throw new HttpError(404, 'Job not found');
  const f = jobFields(await readJson(req), old);
  db.prepare("UPDATE jobs SET title=?,kind=?,stage=?,site_address=?,site_city=?,site_state=?,site_zip=?,installer_id=?,est_value=?,description=?,lost_reason=?,updated_at=datetime('now') WHERE id=?")
    .run(f.title, f.kind, f.stage, f.site_address, f.site_city, f.site_state, f.site_zip, f.installer_id, f.est_value, f.description, f.lost_reason, old.id);
  if (f.stage !== old.stage) log(old.id, user.id, `Stage changed: ${old.stage} → ${f.stage}${f.stage === 'lost' && f.lost_reason ? ` (${f.lost_reason})` : ''}`);
  if (f.installer_id !== old.installer_id) {
    const n = f.installer_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(f.installer_id)?.name : 'nobody';
    log(old.id, user.id, `Assigned to ${n}`);
  }
  return { ok: true };
});
route('DELETE', '/api/jobs/:id', OFFICE, ({ params }) => {
  for (const p of db.prepare('SELECT filename FROM photos WHERE job_id = ?').all(params.id)) fs.rm(path.join(UPLOAD_DIR, p.filename), () => {});
  db.prepare('DELETE FROM jobs WHERE id = ?').run(params.id);
  return { ok: true };
});
route('POST', '/api/jobs/:id/notes', ANY, async ({ req, params, user }) => {
  const id = Number(params.id);
  assertJobAccess(user, id);
  const { body } = await readJson(req);
  if (!str(body)) bad('Note is empty');
  log(id, user.id, str(body, 5000), 'note');
  db.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").run(id);
  return { ok: true };
});
route('DELETE', '/api/activity/:id', ANY, ({ params, user }) => {
  const a = db.prepare('SELECT * FROM activity WHERE id = ?').get(params.id);
  if (!a || a.kind !== 'note') throw new HttpError(404, 'Note not found');
  if (user.role !== 'office' && a.user_id !== user.id) throw new HttpError(403, 'You can only delete your own notes');
  db.prepare('DELETE FROM activity WHERE id = ?').run(a.id);
  return { ok: true };
});

// ===== Photos =====
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/gif': '.gif' };
route('POST', '/api/jobs/:id/photos', ANY, async ({ req, params, user, url }) => {
  const id = Number(params.id);
  assertJobAccess(user, id);
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  if (!IMAGE_TYPES[mime]) bad('Only JPEG, PNG, WebP, HEIC or GIF images');
  const buf = await readBody(req, 15 * 1024 * 1024);
  if (!buf.length) bad('Empty file');
  const filename = `${id}-${crypto.randomBytes(10).toString('hex')}${IMAGE_TYPES[mime]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  const r = db.prepare('INSERT INTO photos (job_id, user_id, filename, mime, caption) VALUES (?,?,?,?,?)').run(id, user.id, filename, mime, str(url.searchParams.get('caption'), 300));
  log(id, user.id, 'Added a photo');
  return { id: Number(r.lastInsertRowid) };
});
route('GET', '/api/photos/:id', ANY, ({ params, user, res }) => {
  const p = db.prepare('SELECT * FROM photos WHERE id = ?').get(params.id);
  if (!p) throw new HttpError(404, 'Photo not found');
  assertJobAccess(user, p.job_id);
  const file = path.join(UPLOAD_DIR, path.basename(p.filename));
  if (!fs.existsSync(file)) throw new HttpError(404, 'Photo file missing');
  res.writeHead(200, { 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
  return undefined;
});
route('DELETE', '/api/photos/:id', ANY, ({ params, user }) => {
  const p = db.prepare('SELECT * FROM photos WHERE id = ?').get(params.id);
  if (!p) throw new HttpError(404, 'Photo not found');
  if (user.role !== 'office' && p.user_id !== user.id) throw new HttpError(403, 'You can only delete your own photos');
  fs.rm(path.join(UPLOAD_DIR, path.basename(p.filename)), () => {});
  db.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
  return { ok: true };
});

// ===== Events / schedule =====
function eventsQuery(where, args) {
  return db.prepare(`SELECT e.*, u.name user_name, j.title job_title, j.kind job_kind, j.stage job_stage,
      j.site_address, j.site_city, j.site_state, j.site_zip, c.name customer_name, c.company customer_company, c.phone customer_phone
    FROM events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN jobs j ON j.id = e.job_id LEFT JOIN customers c ON c.id = j.customer_id
    WHERE ${where} ORDER BY e.starts_at`).all(...args);
}
route('GET', '/api/events', ANY, ({ url, user }) => {
  const from = str(url.searchParams.get('from'), 16) || today();
  const to = str(url.searchParams.get('to'), 16) || addDays(today(), 14);
  const where = ['e.starts_at >= ?', 'e.starts_at < ?']; const args = [from, to];
  if (user.role !== 'office') { where.push('e.user_id = ?'); args.push(user.id); }
  else if (url.searchParams.get('user_id')) { where.push('e.user_id = ?'); args.push(Number(url.searchParams.get('user_id'))); }
  if (url.searchParams.get('status') !== 'all') where.push("e.status != 'cancelled'");
  return eventsQuery(where.join(' AND '), args);
});
function eventFields(b, old = {}) {
  const starts = str(b.starts_at ?? old.starts_at, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(starts)) bad('Pick a date and time');
  return {
    job_id: b.job_id === undefined ? old.job_id ?? null : (b.job_id ? Number(b.job_id) : null),
    kind: oneOf(b.kind, EVENT_KINDS, old.kind || 'estimate'),
    title: str(b.title ?? old.title ?? '', 200),
    starts_at: starts,
    duration_min: Math.max(15, Math.min(60 * 24 * 5, parseInt(b.duration_min ?? old.duration_min ?? 60, 10) || 60)),
    user_id: b.user_id === undefined ? old.user_id ?? null : (b.user_id ? Number(b.user_id) : null),
    notes: str(b.notes ?? old.notes ?? '', 3000),
    status: oneOf(b.status, ['scheduled', 'in_progress', 'done', 'cancelled'], old.status || 'scheduled'),
  };
}
const KIND_STAGE = { estimate: 'estimate', measure: 'estimate', install: 'scheduled' };
route('POST', '/api/events', OFFICE, async ({ req, user }) => {
  const f = eventFields(await readJson(req));
  const r = db.prepare('INSERT INTO events (job_id,kind,title,starts_at,duration_min,user_id,notes,status) VALUES (?,?,?,?,?,?,?,?)')
    .run(f.job_id, f.kind, f.title, f.starts_at, f.duration_min, f.user_id, f.notes, f.status);
  if (f.job_id) {
    const who = f.user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(f.user_id)?.name : null;
    log(f.job_id, user.id, `Scheduled ${f.kind} for ${f.starts_at.replace('T', ' ')}${who ? ` with ${who}` : ''}`);
    if (KIND_STAGE[f.kind]) {
      const job = db.prepare('SELECT stage FROM jobs WHERE id = ?').get(f.job_id);
      // Only advance to "estimate" from "lead"; install scheduling advances up to "scheduled".
      if (f.kind !== 'install' || STAGE_RANK[job.stage] >= STAGE_RANK.won) advanceStage(f.job_id, KIND_STAGE[f.kind], user.id);
      if (f.kind === 'install' && f.user_id) db.prepare('UPDATE jobs SET installer_id = COALESCE(installer_id, ?) WHERE id = ?').run(f.user_id, f.job_id);
    }
  }
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/events/:id', ANY, async ({ req, params, user }) => {
  const old = db.prepare('SELECT * FROM events WHERE id = ?').get(params.id);
  if (!old) throw new HttpError(404, 'Appointment not found');
  const b = await readJson(req);
  if (user.role !== 'office') {
    if (old.user_id !== user.id) throw new HttpError(403, 'Not your appointment');
    // Installers can only change status and add to notes.
    const status = oneOf(b.status, ['scheduled', 'in_progress', 'done'], old.status);
    db.prepare("UPDATE events SET status = ?, completed_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE completed_at END WHERE id = ?").run(status, status, old.id);
    if (status !== old.status && old.job_id) {
      log(old.job_id, user.id, status === 'done' ? `Marked ${old.kind} complete` : status === 'in_progress' ? `Started ${old.kind}` : `Re-opened ${old.kind}`);
      if (status === 'done' && (old.kind === 'install')) advanceStage(old.job_id, 'installed', user.id);
      if (status === 'done' && (old.kind === 'measure' || old.kind === 'estimate')) advanceStage(old.job_id, 'measured', user.id);
    }
    return { ok: true };
  }
  const f = eventFields(b, old);
  db.prepare("UPDATE events SET job_id=?,kind=?,title=?,starts_at=?,duration_min=?,user_id=?,notes=?,status=?,completed_at=CASE WHEN ?='done' AND completed_at IS NULL THEN datetime('now') ELSE completed_at END WHERE id=?")
    .run(f.job_id, f.kind, f.title, f.starts_at, f.duration_min, f.user_id, f.notes, f.status, f.status, old.id);
  if (f.job_id && f.status !== old.status) {
    log(f.job_id, user.id, `${f.kind} marked ${f.status.replace('_', ' ')}`);
    if (f.status === 'done' && f.kind === 'install') advanceStage(f.job_id, 'installed', user.id);
    if (f.status === 'done' && (f.kind === 'measure' || f.kind === 'estimate')) advanceStage(f.job_id, 'measured', user.id);
  } else if (f.job_id && f.starts_at !== old.starts_at) log(f.job_id, user.id, `Rescheduled ${f.kind} to ${f.starts_at.replace('T', ' ')}`);
  return { ok: true };
});
route('DELETE', '/api/events/:id', OFFICE, ({ params }) => { db.prepare('DELETE FROM events WHERE id = ?').run(params.id); return { ok: true }; });

// ===== Price list =====
route('GET', '/api/price-items', OFFICE, () => db.prepare('SELECT * FROM price_items ORDER BY category, sort, name').all());
function priceFields(b, old = {}) {
  const f = {
    category: oneOf(b.category, CATEGORIES, old.category || 'window'),
    name: str(b.name ?? old.name, 200), sku: str(b.sku ?? old.sku ?? '', 50),
    unit: oneOf(b.unit, UNITS, old.unit || 'each'),
    price: numv(b.price ?? old.price, 0), min_charge: numv(b.min_charge ?? old.min_charge, 0),
    description: str(b.description ?? old.description ?? '', 500),
    active: b.active === undefined ? (old.active ?? 1) : (b.active ? 1 : 0),
    sort: parseInt(b.sort ?? old.sort ?? 0, 10) || 0,
  };
  if (!f.name) bad('Name is required');
  if (f.unit === 'percent' && f.category !== 'option') bad('Percent pricing is only for options');
  return f;
}
route('POST', '/api/price-items', OFFICE, async ({ req }) => {
  const f = priceFields(await readJson(req));
  const r = db.prepare('INSERT INTO price_items (category,name,sku,unit,price,min_charge,description,active,sort) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(f.category, f.name, f.sku, f.unit, f.price, f.min_charge, f.description, f.active, f.sort);
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/price-items/:id', OFFICE, async ({ req, params }) => {
  const old = db.prepare('SELECT * FROM price_items WHERE id = ?').get(params.id);
  if (!old) throw new HttpError(404, 'Item not found');
  const f = priceFields(await readJson(req), old);
  db.prepare('UPDATE price_items SET category=?,name=?,sku=?,unit=?,price=?,min_charge=?,description=?,active=?,sort=? WHERE id=?')
    .run(f.category, f.name, f.sku, f.unit, f.price, f.min_charge, f.description, f.active, f.sort, old.id);
  return { ok: true };
});
route('DELETE', '/api/price-items/:id', OFFICE, ({ params }) => { db.prepare('DELETE FROM price_items WHERE id = ?').run(params.id); return { ok: true }; });

// ===== Quotes =====
route('GET', '/api/quotes', OFFICE, ({ url }) => {
  const status = url.searchParams.get('status');
  return db.prepare(`SELECT q.id, q.number, q.status, q.total, q.created_at, q.sent_at, q.accepted_at, q.job_id, j.title job_title, c.name customer_name, c.company customer_company
    FROM quotes q JOIN jobs j ON j.id = q.job_id JOIN customers c ON c.id = j.customer_id ${status ? 'WHERE q.status = ?' : ''} ORDER BY q.id DESC LIMIT 500`).all(...(status ? [status] : []));
});
route('POST', '/api/jobs/:id/quotes', OFFICE, ({ params, user }) => {
  const id = Number(params.id);
  if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) throw new HttpError(404, 'Job not found');
  const s = getSettings();
  const qid = tx(() => {
    const number = nextNumber('next_quote_no', 'Q');
    const r = db.prepare('INSERT INTO quotes (number, job_id, tax_rate, deposit_pct, terms, valid_until, token) VALUES (?,?,?,?,?,?,?)')
      .run(number, id, numv(s.default_tax_rate), numv(s.default_deposit_pct), s.quote_terms, addDays(today(), parseInt(s.quote_valid_days, 10) || 30), token());
    log(id, user.id, `Quote ${number} created`);
    return Number(r.lastInsertRowid);
  });
  return { id: qid };
});
route('GET', '/api/quotes/:id', OFFICE, ({ params }) => {
  const q = loadQuote(params.id);
  if (!q) throw new HttpError(404, 'Quote not found');
  return { quote: q, ...jobWithCustomer(q.job_id) };
});
function cleanQuoteItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 300).map((it, i) => {
    const line = {
      sort: i, price_item_id: it.price_item_id ? Number(it.price_item_id) : null,
      name: str(it.name, 200) || 'Item', location: str(it.location, 120),
      unit: oneOf(it.unit, UNITS.filter((u) => u !== 'percent'), 'each'),
      unit_price: numv(it.unit_price), min_charge: numv(it.min_charge),
      width: Math.max(0, numv(it.width)), height: Math.max(0, numv(it.height)),
      qty: numv(it.qty, 1), note: str(it.note, 500),
      options: (Array.isArray(it.options) ? it.options : []).slice(0, 20).map((o) => ({
        price_item_id: o.price_item_id ? Number(o.price_item_id) : null, name: str(o.name, 200),
        unit: oneOf(o.unit, UNITS, 'each'), unit_price: numv(o.unit_price), min_charge: numv(o.min_charge),
      })),
    };
    line.line_total = pricing.lineTotal(line).total;
    return line;
  });
}
route('PUT', '/api/quotes/:id', OFFICE, async ({ req, params }) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(params.id);
  if (!q) throw new HttpError(404, 'Quote not found');
  const b = await readJson(req);
  const items = cleanQuoteItems(b.items);
  const discount = Math.max(0, numv(b.discount)), tax_rate = Math.max(0, numv(b.tax_rate));
  const t = pricing.totals(items, discount, tax_rate);
  tx(() => {
    db.prepare('UPDATE quotes SET tax_rate=?, discount=?, deposit_pct=?, subtotal=?, tax=?, total=?, notes=?, terms=?, valid_until=? WHERE id=?')
      .run(tax_rate, discount, Math.max(0, Math.min(100, numv(b.deposit_pct))), t.subtotal, t.tax, t.total, str(b.notes, 5000), str(b.terms, 5000), str(b.valid_until, 10), q.id);
    db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(q.id);
    const ins = db.prepare('INSERT INTO quote_items (quote_id,sort,price_item_id,name,location,unit,unit_price,min_charge,width,height,qty,options,note,line_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const l of items) ins.run(q.id, l.sort, l.price_item_id, l.name, l.location, l.unit, l.unit_price, l.min_charge, l.width, l.height, l.qty, JSON.stringify(l.options), l.note, l.line_total);
    db.prepare("UPDATE jobs SET est_value = ?, updated_at = datetime('now') WHERE id = ? AND (est_value = 0 OR ? = 'accepted' OR NOT EXISTS (SELECT 1 FROM quotes WHERE job_id = ? AND status = 'accepted'))")
      .run(t.total, q.job_id, q.status, q.job_id);
  });
  return { ok: true, ...t };
});
route('POST', '/api/quotes/:id/status', OFFICE, async ({ req, params, user }) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(params.id);
  if (!q) throw new HttpError(404, 'Quote not found');
  const { status } = await readJson(req);
  const st = oneOf(status, ['draft', 'sent', 'accepted', 'declined'], null);
  if (!st) bad('Bad status');
  db.prepare(`UPDATE quotes SET status = ?, sent_at = CASE WHEN ? = 'sent' AND sent_at IS NULL THEN datetime('now') ELSE sent_at END,
    accepted_at = CASE WHEN ? = 'accepted' THEN datetime('now') ELSE accepted_at END,
    accepted_name = CASE WHEN ? = 'accepted' AND accepted_name = '' THEN ? ELSE accepted_name END WHERE id = ?`)
    .run(st, st, st, st, `${user.name} (recorded by office)`, q.id);
  log(q.job_id, user.id, `Quote ${q.number} marked ${st}`);
  if (st === 'sent') advanceStage(q.job_id, 'quoted', user.id);
  if (st === 'accepted') { advanceStage(q.job_id, 'won', user.id); db.prepare('UPDATE jobs SET est_value = ? WHERE id = ?').run(q.total, q.job_id); }
  return { ok: true };
});
route('POST', '/api/quotes/:id/duplicate', OFFICE, ({ params, user }) => {
  const q = loadQuote(params.id);
  if (!q) throw new HttpError(404, 'Quote not found');
  const id = tx(() => {
    const number = nextNumber('next_quote_no', 'Q');
    const r = db.prepare('INSERT INTO quotes (number,job_id,tax_rate,discount,deposit_pct,subtotal,tax,total,notes,terms,valid_until,token) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(number, q.job_id, q.tax_rate, q.discount, q.deposit_pct, q.subtotal, q.tax, q.total, q.notes, q.terms, addDays(today(), parseInt(getSettings().quote_valid_days, 10) || 30), token());
    const nid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO quote_items (quote_id,sort,price_item_id,name,location,unit,unit_price,min_charge,width,height,qty,options,note,line_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const l of q.items) ins.run(nid, l.sort, l.price_item_id, l.name, l.location, l.unit, l.unit_price, l.min_charge, l.width, l.height, l.qty, JSON.stringify(l.options), l.note, l.line_total);
    log(q.job_id, user.id, `Quote ${number} copied from ${q.number}`);
    return nid;
  });
  return { id };
});
route('DELETE', '/api/quotes/:id', OFFICE, ({ params, user }) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(params.id);
  if (!q) throw new HttpError(404, 'Quote not found');
  db.prepare('DELETE FROM quotes WHERE id = ?').run(q.id);
  log(q.job_id, user.id, `Quote ${q.number} deleted`);
  return { ok: true };
});
route('POST', '/api/quotes/:id/send', OFFICE, async ({ req, params, user }) => {
  const q = loadQuote(params.id);
  if (!q) throw new HttpError(404, 'Quote not found');
  const b = await readJson(req);
  const { job, customer } = jobWithCustomer(q.job_id);
  const to = str(b.to, 200) || customer.email;
  if (!to) bad('Customer has no email address');
  const s = getSettings();
  const link = `${baseUrl(req)}/q/${q.token}`;
  const msg = str(b.message, 5000) || `Hi ${customer.name.split(' ')[0]},\n\nThank you for the opportunity. Your quote for "${job.title}" is ready — you can view it, print it, and accept it online using the link below.`;
  await sendMail(smtpConfig(), {
    to, replyTo: s.company_email || undefined,
    subject: str(b.subject, 200) || `Your quote ${q.number} from ${s.company_name}`,
    text: `${msg}\n\nView your quote: ${link}\n\n${s.company_name}\n${s.company_phone}`,
    html: emailWrap(s, docs.esc(msg).replace(/\n/g, '<br>'), link, `View quote ${q.number}`),
  }).catch((e) => { throw new HttpError(400, 'Email failed: ' + e.message); });
  if (q.status === 'draft') db.prepare("UPDATE quotes SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(q.id);
  else db.prepare("UPDATE quotes SET sent_at = COALESCE(sent_at, datetime('now')) WHERE id = ?").run(q.id);
  log(q.job_id, user.id, `Quote ${q.number} emailed to ${to}`);
  advanceStage(q.job_id, 'quoted', user.id);
  return { ok: true };
});

// ===== Invoices =====
route('GET', '/api/invoices', OFFICE, ({ url }) => {
  const status = url.searchParams.get('status');
  const rows = db.prepare(`SELECT i.id, i.number, i.status, i.total, i.issued_on, i.due_on, i.job_id, j.title job_title, c.name customer_name, c.company customer_company,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id), 0) paid
    FROM invoices i JOIN jobs j ON j.id = i.job_id JOIN customers c ON c.id = j.customer_id ${status ? 'WHERE i.status = ?' : ''} ORDER BY i.id DESC LIMIT 500`).all(...(status ? [status] : []));
  return rows.map((r) => ({ ...r, balance: pricing.r2(r.total - r.paid) }));
});
route('POST', '/api/jobs/:id/invoices', OFFICE, async ({ req, params, user }) => {
  const id = Number(params.id);
  if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) throw new HttpError(404, 'Job not found');
  const b = await readJson(req);
  const s = getSettings();
  const q = b.quote_id ? loadQuote(b.quote_id) : null;
  const pct = Math.max(0, Math.min(100, numv(b.percent, 100)));
  const iid = tx(() => {
    const number = nextNumber('next_invoice_no', 'INV');
    const issued = today();
    const r = db.prepare('INSERT INTO invoices (number,job_id,quote_id,issued_on,due_on,tax_rate,notes,token) VALUES (?,?,?,?,?,?,?,?)')
      .run(number, id, q ? q.id : null, issued, addDays(issued, parseInt(s.invoice_due_days, 10) || 14), q ? q.tax_rate : numv(s.default_tax_rate), s.invoice_notes, token());
    const invId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id,sort,description,qty,unit_price,line_total) VALUES (?,?,?,?,?,?)');
    let items = [];
    if (q && pct === 100 && b.mode !== 'balance') {
      items = q.items.map((l, i) => {
        const size = l.width && l.height ? ` (${l.width}" × ${l.height}")` : '';
        const opts = l.options.length ? ` — ${l.options.map((o) => o.name).join(', ')}` : '';
        const each = l.qty ? pricing.r2(l.line_total / l.qty) : 0;
        return { description: `${l.name}${l.location ? ' – ' + l.location : ''}${size}${opts}`, qty: l.qty, unit_price: each, line_total: l.line_total };
      });
      if (q.discount) items.push({ description: 'Discount', qty: 1, unit_price: -q.discount, line_total: -q.discount });
    } else if (q && b.mode === 'balance') {
      // Remaining balance of the quote after earlier invoices for it.
      const prior = db.prepare("SELECT COALESCE(SUM(subtotal),0) s FROM invoices WHERE quote_id = ? AND status != 'void' AND id != ?").get(q.id, invId).s;
      const amt = pricing.r2((q.subtotal - q.discount) - prior);
      items = [{ description: `Balance for quote ${q.number} — ${db.prepare('SELECT title FROM jobs WHERE id = ?').get(id).title}`, qty: 1, unit_price: amt, line_total: amt }];
    } else if (q) {
      const amt = pricing.r2((q.subtotal - q.discount) * pct / 100);
      items = [{ description: `Deposit (${pct}%) for quote ${q.number} — ${db.prepare('SELECT title FROM jobs WHERE id = ?').get(id).title}`, qty: 1, unit_price: amt, line_total: amt }];
    }
    items.forEach((it, i) => ins.run(invId, i, it.description, it.qty, it.unit_price, it.line_total));
    const t = pricing.totals(items, 0, q ? q.tax_rate : numv(s.default_tax_rate));
    db.prepare('UPDATE invoices SET subtotal=?, tax=?, total=? WHERE id=?').run(t.subtotal, t.tax, t.total, invId);
    log(id, user.id, `Invoice ${number} created`);
    return invId;
  });
  return { id: iid };
});
route('GET', '/api/invoices/:id', OFFICE, ({ params }) => {
  const inv = loadInvoice(params.id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  return { invoice: inv, ...jobWithCustomer(inv.job_id) };
});
route('PUT', '/api/invoices/:id', OFFICE, async ({ req, params }) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const b = await readJson(req);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map((it, i) => {
    const qty = numv(it.qty, 1), unit_price = numv(it.unit_price);
    return { sort: i, description: str(it.description, 500) || 'Item', qty, unit_price, line_total: pricing.r2(qty * unit_price) };
  });
  const discount = Math.max(0, numv(b.discount)), tax_rate = Math.max(0, numv(b.tax_rate));
  const t = pricing.totals(items, discount, tax_rate);
  tx(() => {
    db.prepare('UPDATE invoices SET issued_on=?, due_on=?, tax_rate=?, discount=?, subtotal=?, tax=?, total=?, notes=?, status=? WHERE id=?')
      .run(str(b.issued_on, 10) || inv.issued_on, str(b.due_on, 10), tax_rate, discount, t.subtotal, t.tax, t.total, str(b.notes, 5000),
        oneOf(b.status, ['draft', 'sent', 'paid', 'void'], inv.status), inv.id);
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(inv.id);
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id,sort,description,qty,unit_price,line_total) VALUES (?,?,?,?,?,?)');
    for (const l of items) ins.run(inv.id, l.sort, l.description, l.qty, l.unit_price, l.line_total);
  });
  refreshInvoiceStatus(inv.id);
  return { ok: true, ...t };
});
route('DELETE', '/api/invoices/:id', OFFICE, ({ params, user }) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
  log(inv.job_id, user.id, `Invoice ${inv.number} deleted`);
  return { ok: true };
});
route('POST', '/api/invoices/:id/payments', OFFICE, async ({ req, params, user }) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const b = await readJson(req);
  const amount = pricing.r2(numv(b.amount));
  if (!(amount > 0)) bad('Enter a payment amount');
  db.prepare('INSERT INTO payments (invoice_id, amount, method, paid_on, note) VALUES (?,?,?,?,?)').run(inv.id, amount, str(b.method, 40), str(b.paid_on, 10) || today(), str(b.note, 300));
  log(inv.job_id, user.id, `Payment of ${docs.money(amount)} recorded on ${inv.number}${b.method ? ` (${str(b.method, 40)})` : ''}`);
  if (inv.status === 'draft') db.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(inv.id);
  refreshInvoiceStatus(inv.id);
  return { ok: true };
});
route('DELETE', '/api/payments/:id', OFFICE, ({ params, user }) => {
  const p = db.prepare('SELECT p.*, i.job_id, i.number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ?').get(params.id);
  if (!p) throw new HttpError(404, 'Payment not found');
  db.prepare('DELETE FROM payments WHERE id = ?').run(p.id);
  log(p.job_id, user.id, `Payment of ${docs.money(p.amount)} removed from ${p.number}`);
  refreshInvoiceStatus(p.invoice_id);
  return { ok: true };
});
route('POST', '/api/invoices/:id/send', OFFICE, async ({ req, params, user }) => {
  const inv = loadInvoice(params.id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const b = await readJson(req);
  const { job, customer } = jobWithCustomer(inv.job_id);
  const to = str(b.to, 200) || customer.email;
  if (!to) bad('Customer has no email address');
  const s = getSettings();
  const link = `${baseUrl(req)}/i/${inv.token}`;
  const msg = str(b.message, 5000) || `Hi ${customer.name.split(' ')[0]},\n\nPlease find invoice ${inv.number} for "${job.title}". Balance due: ${docs.money(inv.balance)}${inv.due_on ? ` by ${docs.fmtDate(inv.due_on)}` : ''}.`;
  await sendMail(smtpConfig(), {
    to, replyTo: s.company_email || undefined,
    subject: str(b.subject, 200) || `Invoice ${inv.number} from ${s.company_name}`,
    text: `${msg}\n\nView your invoice: ${link}\n\n${s.company_name}\n${s.company_phone}`,
    html: emailWrap(s, docs.esc(msg).replace(/\n/g, '<br>'), link, `View invoice ${inv.number}`),
  }).catch((e) => { throw new HttpError(400, 'Email failed: ' + e.message); });
  db.prepare("UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = datetime('now') WHERE id = ?").run(inv.id);
  log(inv.job_id, user.id, `Invoice ${inv.number} emailed to ${to}`);
  advanceStage(inv.job_id, 'invoiced', user.id);
  return { ok: true };
});
route('POST', '/api/invoices/:id/mark-sent', OFFICE, ({ params, user }) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  db.prepare("UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, datetime('now')) WHERE id = ?").run(inv.id);
  log(inv.job_id, user.id, `Invoice ${inv.number} marked sent`);
  advanceStage(inv.job_id, 'invoiced', user.id);
  return { ok: true };
});

// ===== Dashboard =====
route('GET', '/api/dashboard', OFFICE, () => {
  const t = today();
  const monthStart = t.slice(0, 8) + '01';
  const pipeline = db.prepare(`SELECT stage, COUNT(*) n, COALESCE(SUM(COALESCE(
      (SELECT total FROM quotes q WHERE q.job_id = j.id ORDER BY (q.status='accepted') DESC, q.id DESC LIMIT 1), est_value)),0) value
    FROM jobs j WHERE stage NOT IN ('paid','lost') GROUP BY stage`).all();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const newLeads = one("SELECT COUNT(*) n FROM jobs WHERE date(created_at) >= ?", monthStart).n;
  const sent = one("SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM quotes WHERE sent_at IS NOT NULL AND date(sent_at) >= ?", monthStart);
  const won = one("SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM quotes WHERE status = 'accepted' AND date(accepted_at) >= ?", monthStart);
  const close90 = one(`SELECT SUM(status='accepted') a, SUM(status='declined') d, SUM(status='sent') s FROM quotes WHERE sent_at IS NOT NULL AND date(sent_at) >= ?`, addDays(t, -90));
  const collected = one('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE paid_on >= ?', monthStart).v;
  const outstanding = one(`SELECT COALESCE(SUM(i.total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id),0)),0) v
    FROM invoices i WHERE i.status = 'sent'`).v;
  const upcoming = eventsQuery("e.starts_at >= ? AND e.starts_at < ? AND e.status IN ('scheduled','in_progress')", [t, addDays(t, 8)]);
  const followups = db.prepare(`SELECT q.id, q.number, q.total, q.sent_at, q.job_id, j.title job_title, c.name customer_name, c.phone customer_phone
    FROM quotes q JOIN jobs j ON j.id = q.job_id JOIN customers c ON c.id = j.customer_id
    WHERE q.status = 'sent' AND q.sent_at IS NOT NULL AND date(q.sent_at) <= ? AND j.stage != 'lost' ORDER BY q.sent_at LIMIT 20`).all(addDays(t, -3));
  const overdue = db.prepare(`SELECT i.id, i.number, i.due_on, i.job_id, c.name customer_name, i.total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id),0) balance
    FROM invoices i JOIN jobs j ON j.id = i.job_id JOIN customers c ON c.id = j.customer_id
    WHERE i.status = 'sent' AND i.due_on != '' AND i.due_on < ? ORDER BY i.due_on LIMIT 20`).all(t);
  const needsQuote = db.prepare(`SELECT j.id, j.title, j.stage, c.name customer_name FROM jobs j JOIN customers c ON c.id = j.customer_id
    WHERE j.stage IN ('lead','estimate','measured') AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.job_id = j.id) ORDER BY j.created_at LIMIT 20`).all();
  const decided = (close90.a || 0) + (close90.d || 0);
  return {
    pipeline, newLeads, quotesSent: sent, quotesWon: won, winRate: decided ? Math.round((close90.a / decided) * 100) : null,
    collected, outstanding: pricing.r2(outstanding), upcoming, followups, overdue: overdue.map((o) => ({ ...o, balance: pricing.r2(o.balance) })), needsQuote,
  };
});

// ===== Document pages =====
route('GET', '/doc/quote/:id', OFFICE, ({ params, res }) => {
  const q = loadQuote(params.id);
  if (!q) throw new HttpError(404, 'Quote not found');
  const { job, customer } = jobWithCustomer(q.job_id);
  sendHtml(res, 200, docs.renderQuote({ settings: getSettings(), quote: q, items: q.items, job, customer, mode: 'print' }));
});
route('GET', '/doc/invoice/:id', OFFICE, ({ params, res }) => {
  const inv = loadInvoice(params.id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const { job, customer } = jobWithCustomer(inv.job_id);
  sendHtml(res, 200, docs.renderInvoice({ settings: getSettings(), invoice: inv, items: inv.items, payments: inv.payments, job, customer, mode: 'print' }));
});
route('GET', '/q/:token', PUBLIC, ({ params, res }) => {
  const row = db.prepare('SELECT id FROM quotes WHERE token = ?').get(params.token);
  if (!row) return sendHtml(res, 404, docs.simplePage('Quote not found', 'This link is invalid or the quote was removed.'));
  const q = loadQuote(row.id);
  const { job, customer } = jobWithCustomer(q.job_id);
  sendHtml(res, 200, docs.renderQuote({ settings: getSettings(), quote: q, items: q.items, job, customer, mode: 'public' }));
});
route('POST', '/q/:token/accept', PUBLIC, async ({ req, params, res }) => {
  const q = db.prepare('SELECT * FROM quotes WHERE token = ?').get(params.token);
  if (!q) return sendHtml(res, 404, docs.simplePage('Quote not found', 'This link is invalid or the quote was removed.'));
  const { name } = await readForm(req);
  const nm = str(name, 120);
  if (nm && !['accepted', 'declined'].includes(q.status)) {
    db.prepare("UPDATE quotes SET status = 'accepted', accepted_name = ?, accepted_at = datetime('now') WHERE id = ?").run(nm, q.id);
    log(q.job_id, null, `Quote ${q.number} accepted online by ${nm} (IP ${clientIp(req)})`);
    advanceStage(q.job_id, 'won');
    db.prepare('UPDATE jobs SET est_value = ? WHERE id = ?').run(q.total, q.job_id);
  }
  redirect(res, `/q/${q.token}`);
});
route('GET', '/i/:token', PUBLIC, ({ params, res }) => {
  const row = db.prepare("SELECT id FROM invoices WHERE token = ? AND status != 'draft'").get(params.token);
  if (!row) return sendHtml(res, 404, docs.simplePage('Invoice not found', 'This link is invalid or the invoice was removed.'));
  const inv = loadInvoice(row.id);
  const { job, customer } = jobWithCustomer(inv.job_id);
  sendHtml(res, 200, docs.renderInvoice({ settings: getSettings(), invoice: inv, items: inv.items, payments: inv.payments, job, customer, mode: 'public' }));
});

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const APP_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const PRICING_MJS = `const __m = (() => { const module = { exports: {} };\n${fs.readFileSync(path.join(__dirname, 'lib', 'pricing.js'), 'utf8').replace("'use strict';", '')}\nreturn module.exports; })();
export const { r2, unitAmount, lineTotal, totals } = __m;\n`;
function serveStatic(req, res, pathname) {
  if (pathname === '/js/pricing.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(PRICING_MJS);
    return true;
  }
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(pathname)) return false;
    file = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ...(ext === '.html' ? { 'Content-Security-Policy': APP_CSP } : {}),
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, 'http://local');
  const pathname = url.pathname;
  try {
    if (pathname === '/healthz') return send(res, 200, { ok: true });
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let user = null;
      if (r.role !== PUBLIC) {
        user = getUser(req);
        if (!user) {
          if (pathname.startsWith('/doc/')) return redirect(res, '/login?next=' + encodeURIComponent(pathname));
          throw new HttpError(401, 'Please log in');
        }
        if (r.role === OFFICE && user.role !== 'office') throw new HttpError(403, 'Office staff only');
        // CSRF guard for state-changing API calls: require the custom header our app sends.
        if (req.method !== 'GET' && pathname.startsWith('/api/') && req.headers['x-requested-with'] !== 'crm') throw new HttpError(403, 'Bad request origin');
      } else if (req.method !== 'GET' && pathname.startsWith('/api/') && req.headers['x-requested-with'] !== 'crm') {
        throw new HttpError(403, 'Bad request origin');
      }
      const out = await r.handler({ req, res, params, url, user });
      if (out !== undefined && !res.headersSent) send(res, 200, out);
      return;
    }
    if (pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    if (req.method === 'GET' && serveStatic(req, res, pathname)) return;
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(new Date().toISOString(), req.method, pathname, e);
    if (res.headersSent) return res.end();
    if (pathname.startsWith('/api/')) send(res, status, { error: status === 500 ? 'Something went wrong on the server' : e.message });
    else sendHtml(res, status, docs.simplePage(status === 404 ? 'Not found' : 'Error', docs.esc(status === 500 ? 'Something went wrong.' : e.message)));
  }
});
server.requestTimeout = 120000;
server.listen(PORT, () => console.log(`Window CRM listening on :${PORT} (data in ${DATA_DIR})`));
process.on('SIGTERM', () => { server.close(); db.close(); process.exit(0); });
