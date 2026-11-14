'use strict';
// Pricing rules shared by the server (authoritative) and mirrored in the browser for live previews.
//   each    – flat price per unit
//   sqft    – (width × height ÷ 144) × price
//   ui      – united inches (width + height) × price
//   lf      – perimeter in linear feet (2 × (width + height) ÷ 12) × price
//   hour    – price per hour (qty = hours)
//   percent – price % of the base item (options only)
// min_charge is a per-unit floor.

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function unitAmount(unit, price, minCharge, width, height, base = 0) {
  const w = Number(width) || 0, h = Number(height) || 0, p = Number(price) || 0;
  let amt;
  switch (unit) {
    case 'sqft': amt = (w * h / 144) * p; break;
    case 'ui': amt = (w + h) * p; break;
    case 'lf': amt = (2 * (w + h) / 12) * p; break;
    case 'percent': amt = (Number(base) || 0) * p / 100; break;
    default: amt = p; // each, hour
  }
  return r2(Math.max(amt, Number(minCharge) || 0));
}

function lineTotal(line) {
  const base = unitAmount(line.unit, line.unit_price, line.min_charge, line.width, line.height);
  let opts = 0;
  for (const o of line.options || []) opts += unitAmount(o.unit, o.unit_price, o.min_charge, line.width, line.height, base);
  return { base, each: r2(base + opts), total: r2((base + opts) * (Number(line.qty) || 0)) };
}

function totals(lines, discount, taxRate) {
  const subtotal = r2(lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0));
  const taxable = Math.max(0, subtotal - (Number(discount) || 0));
  const tax = r2(taxable * (Number(taxRate) || 0) / 100);
  return { subtotal, tax, total: r2(taxable + tax) };
}

module.exports = { r2, unitAmount, lineTotal, totals };
