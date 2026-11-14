import { html, useState, useData, api, Loading, ErrorBox, PageHead, Modal, Field, Input, Select, attempt, confirmDo, money, CATEGORIES, UNITS, UNIT_SHORT } from '../lib.js';

function ItemModal({ item, onClose, onSaved }) {
  const [f, setF] = useState(item);
  const save = async () => {
    const r = await attempt(() => (f.id ? api('PUT', '/api/price-items/' + f.id, f) : api('POST', '/api/price-items', f)), 'Saved');
    if (r) { onSaved(); onClose(); }
  };
  const del = () => confirmDo(`Delete "${f.name}"? Existing quotes keep their prices. To hide it from new quotes instead, untick "Active".`, async () => {
    if (await attempt(() => api('DELETE', '/api/price-items/' + f.id))) { onSaved(); onClose(); }
  });
  const units = f.category === 'option' ? UNITS : UNITS.filter(([u]) => u !== 'percent');
  return html`<${Modal} title=${f.id ? 'Edit price item' : 'New price item'} onClose=${onClose}
    footer=${html`${f.id && html`<button class="btn danger left" onClick=${del}>Delete</button>`}<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button>`}>
    <div class="form-grid">
      <${Field} label="Name" class="span2"><${Input} obj=${f} set=${setF} k="name" autofocus /></${Field}>
      <${Field} label="Category"><${Select} obj=${f} set=${setF} k="category" options=${CATEGORIES} /></${Field}>
      <${Field} label="SKU / code"><${Input} obj=${f} set=${setF} k="sku" /></${Field}>
      <${Field} label="How it's priced" class="span2"><${Select} obj=${f} set=${setF} k="unit" options=${units} /></${Field}>
      <${Field} label=${f.unit === 'percent' ? 'Percent (%)' : 'Price ($)'}><${Input} obj=${f} set=${setF} k="price" type="number" step="any" /></${Field}>
      <${Field} label="Minimum charge ($)" hint="Per unit. 0 for none"><${Input} obj=${f} set=${setF} k="min_charge" type="number" step="any" /></${Field}>
      <${Field} label="Description" class="span2"><${Input} obj=${f} set=${setF} k="description" /></${Field}>
      <label class="check"><input type="checkbox" checked=${!!f.active} onChange=${(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> Active (shows up when building quotes)</label>
    </div>
    <p class="sm muted">Example: a 36″ × 60″ window is 96 united inches and 15 sq ft. At $6.50/UI that's $624.</p>
  </${Modal}>`;
}

export function PriceList() {
  const { data, error, reload } = useData('/api/price-items');
  const [edit, setEdit] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  return html`
    <${PageHead} title="Price list" sub="Quotes are priced from this list. The starting prices are examples, so replace them with your real numbers.">
      <button class="btn primary" onClick=${() => setEdit({ category: 'window', name: '', sku: '', unit: 'ui', price: 0, min_charge: 0, description: '', active: 1 })}>+ Add item</button>
    </${PageHead}>
    ${CATEGORIES.map(([cat, label]) => {
      const items = data.filter((p) => p.category === cat);
      return html`<section class="card flush">
        <div class="card-head pad"><h2>${label}</h2><button class="btn sm" onClick=${() => setEdit({ category: cat, name: '', sku: '', unit: cat === 'option' ? 'each' : cat === 'window' ? 'ui' : 'each', price: 0, min_charge: 0, description: '', active: 1 })}>+ Add</button></div>
        ${items.length ? html`<table class="tbl"><thead><tr><th>Item</th><th class="hide-sm">SKU</th><th class="r">Price</th><th class="r hide-sm">Min.</th><th></th></tr></thead><tbody>
          ${items.map((p) => html`<tr class=${'click ' + (p.active ? '' : 'inactive')} onClick=${() => setEdit(p)}>
            <td><b>${p.name}</b>${p.description && html`<div class="sm muted">${p.description}</div>`}</td><td class="hide-sm muted">${p.sku}</td>
            <td class="r">${p.unit === 'percent' ? p.price + '%' : money(p.price)} <span class="muted sm">${p.unit === 'percent' ? 'of item' : UNIT_SHORT[p.unit]}</span></td>
            <td class="r hide-sm">${p.min_charge ? money(p.min_charge) : ''}</td><td>${!p.active && html`<span class="badge">hidden</span>`}</td></tr>`)}
        </tbody></table>` : html`<p class="muted pad">Nothing here yet.</p>`}
      </section>`;
    })}
    ${edit && html`<${ItemModal} item=${edit} onClose=${() => setEdit(null)} onSaved=${reload} />`}
  `;
}
