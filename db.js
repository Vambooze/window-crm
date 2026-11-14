'use strict';
// SQLite schema, migrations and seed data (uses Node's built-in node:sqlite).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'crm.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('office','installer')),
    password_hash TEXT NOT NULL,
    must_change_pw INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,           -- sha256 of the cookie token
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'residential' CHECK (type IN ('residential','commercial')),
    name TEXT NOT NULL,
    company TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    phone2 TEXT DEFAULT '',
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    zip TEXT DEFAULT '',
    source TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'replacement' CHECK (kind IN ('replacement','new_construction','repair','service')),
    stage TEXT NOT NULL DEFAULT 'lead',
    site_address TEXT DEFAULT '',
    site_city TEXT DEFAULT '',
    site_state TEXT DEFAULT '',
    site_zip TEXT DEFAULT '',
    installer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    est_value REAL DEFAULT 0,
    description TEXT DEFAULT '',
    lost_reason TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX jobs_customer ON jobs(customer_id);
  CREATE INDEX jobs_stage ON jobs(stage);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'estimate' CHECK (kind IN ('estimate','measure','install','repair','service','followup','other')),
    title TEXT DEFAULT '',
    starts_at TEXT NOT NULL,        -- local "YYYY-MM-DDTHH:MM"
    duration_min INTEGER NOT NULL DEFAULT 60,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','done','cancelled')),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX events_start ON events(starts_at);

  CREATE TABLE price_items (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('window','door','option','labor','repair','other')),
    name TEXT NOT NULL,
    sku TEXT DEFAULT '',
    unit TEXT NOT NULL CHECK (unit IN ('each','sqft','ui','lf','hour','percent')),
    price REAL NOT NULL DEFAULT 0,
    min_charge REAL NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE quotes (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined')),
    tax_rate REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    deposit_pct REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    terms TEXT DEFAULT '',
    valid_until TEXT DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    accepted_name TEXT DEFAULT '',
    sent_at TEXT, accepted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE quote_items (
    id INTEGER PRIMARY KEY,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    price_item_id INTEGER REFERENCES price_items(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    location TEXT DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'each',
    unit_price REAL NOT NULL DEFAULT 0,
    min_charge REAL NOT NULL DEFAULT 0,
    width REAL DEFAULT 0,
    height REAL DEFAULT 0,
    qty REAL NOT NULL DEFAULT 1,
    options TEXT NOT NULL DEFAULT '[]',   -- JSON [{price_item_id,name,unit,unit_price,min_charge}]
    note TEXT DEFAULT '',
    line_total REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
    issued_on TEXT NOT NULL,
    due_on TEXT DEFAULT '',
    tax_rate REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE invoice_items (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    taxable INTEGER NOT NULL DEFAULT 1,
    line_total REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    method TEXT DEFAULT '',
    paid_on TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'note',  -- note | system
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX activity_job ON activity(job_id);

  CREATE TABLE photos (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    caption TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  let row = db.prepare('SELECT v FROM schema_version').get();
  if (!row) { db.prepare('INSERT INTO schema_version (v) VALUES (0)').run(); row = { v: 0 }; }
  for (let i = row.v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.prepare('UPDATE schema_version SET v = ?').run(i + 1);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

const DEFAULT_SETTINGS = {
  company_name: 'Your Window Company',
  company_address: '123 Main St\nYour City, ST 00000',
  company_phone: '(555) 555-0100',
  company_email: 'office@example.com',
  company_website: '',
  license_no: '',
  default_tax_rate: '0',
  default_deposit_pct: '50',
  quote_valid_days: '30',
  invoice_due_days: '14',
  next_quote_no: '1001',
  next_invoice_no: '1001',
  quote_terms: 'A deposit is due when the quote is accepted. The balance is due on completion of installation. Custom windows are non-refundable once ordered. Prices include standard installation and removal of old windows unless noted.',
  invoice_notes: 'Thank you for your business!',
  public_url: '',
  smtp_host: '', smtp_port: '465', smtp_user: '', smtp_pass: '', smtp_from: '',
};

function seed() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);

  const count = db.prepare('SELECT COUNT(*) c FROM price_items').get().c;
  if (count === 0) {
    const p = db.prepare('INSERT INTO price_items (category,name,sku,unit,price,min_charge,description,sort) VALUES (?,?,?,?,?,?,?,?)');
    const items = [
      // category, name, sku, unit, price, min, description
      ['window', 'Vinyl Double-Hung', 'VDH', 'ui', 6.5, 350, 'Priced per united inch (width + height)'],
      ['window', 'Vinyl Single-Hung', 'VSH', 'ui', 5.75, 300, 'Priced per united inch'],
      ['window', 'Vinyl Slider', 'VSL', 'ui', 6.0, 325, 'Priced per united inch'],
      ['window', 'Vinyl Casement', 'VCA', 'ui', 8.5, 450, 'Priced per united inch'],
      ['window', 'Vinyl Awning', 'VAW', 'ui', 8.0, 425, 'Priced per united inch'],
      ['window', 'Vinyl Picture / Fixed', 'VPF', 'sqft', 38, 300, 'Priced per square foot'],
      ['window', 'Bay Window (3-lite)', 'BAY', 'each', 3800, 0, ''],
      ['window', 'Bow Window (4-lite)', 'BOW', 'each', 4600, 0, ''],
      ['window', 'Commercial Storefront Glazing', 'CSF', 'sqft', 65, 800, 'Aluminum storefront, per sq ft'],
      ['window', 'Commercial Fixed Aluminum Window', 'CAF', 'sqft', 52, 500, ''],
      ['door', 'Vinyl Sliding Patio Door 6\'', 'PD6', 'each', 2200, 0, ''],
      ['option', 'Low-E Glass', 'LOWE', 'sqft', 4, 0, ''],
      ['option', 'Argon Gas Fill', 'ARG', 'each', 25, 0, ''],
      ['option', 'Triple Pane Upgrade', 'TRP', 'sqft', 12, 0, ''],
      ['option', 'Tempered Glass', 'TMP', 'sqft', 9, 60, 'Required near doors, tubs and floors'],
      ['option', 'Obscure / Privacy Glass', 'OBS', 'each', 45, 0, ''],
      ['option', 'Grids Between Glass', 'GBG', 'each', 55, 0, ''],
      ['option', 'Exterior Color (non-white)', 'CLR', 'percent', 12, 0, '% of the window price'],
      ['labor', 'Installation (standard)', 'INS', 'each', 150, 0, ''],
      ['labor', 'Remove & Dispose Old Window', 'RMV', 'each', 45, 0, ''],
      ['labor', 'Exterior Aluminum Trim Capping', 'CAP', 'lf', 6, 0, 'Per linear foot of window perimeter'],
      ['labor', 'Interior Trim / Casing', 'TRM', 'lf', 4.5, 0, 'Per linear foot'],
      ['labor', 'Second-Story / Lift Access', 'LFT', 'each', 75, 0, ''],
      ['repair', 'Service Call / Diagnosis', 'SVC', 'each', 95, 0, ''],
      ['repair', 'Repair Labor', 'RLB', 'hour', 85, 0, ''],
      ['repair', 'Glass Unit (IGU) Replacement', 'IGU', 'sqft', 28, 175, 'Fogged / broken sealed unit'],
      ['repair', 'Balance / Spring Replacement', 'BAL', 'each', 65, 0, 'Per sash'],
      ['repair', 'Lock / Hardware Replacement', 'HDW', 'each', 45, 0, ''],
      ['repair', 'Screen Replacement', 'SCR', 'each', 40, 0, ''],
      ['repair', 'Weatherstripping / Re-seal', 'SEAL', 'lf', 3.5, 60, ''],
      ['other', 'Permit Fee', 'PRM', 'each', 150, 0, ''],
    ];
    db.exec('BEGIN');
    items.forEach((it, i) => p.run(...it, i));
    db.exec('COMMIT');
  }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

function ensureAdmin() {
  const any = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (any > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  let pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    pw = crypto.randomBytes(9).toString('base64url');
    console.log(`\n*** First admin created: ${email} / ${pw} (change it after logging in) ***\n`);
  }
  db.prepare('INSERT INTO users (name, email, role, password_hash, must_change_pw) VALUES (?,?,?,?,1)')
    .run(process.env.ADMIN_NAME || 'Office Admin', email, 'office', hashPassword(pw));
}

migrate();
seed();
ensureAdmin();

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSetting(k, v) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v ?? ''));
}
function nextNumber(key, prefix) {
  const n = parseInt(getSettings()[key] || '1001', 10);
  setSetting(key, n + 1);
  return `${prefix}-${n}`;
}
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, DATA_DIR, hashPassword, verifyPassword, getSettings, setSetting, nextNumber, tx };
