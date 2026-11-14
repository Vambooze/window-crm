import { html, useState, api, PageHead, Field, attempt, toast } from '../lib.js';

export function Account({ me }) {
  const [p, setP] = useState({ name: me.name, phone: me.phone || '' });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const saveProfile = () => attempt(() => api('PUT', '/api/me', p), 'Profile saved');
  const savePw = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast("New passwords don't match", 'error');
    if (await attempt(() => api('POST', '/api/me/password', { current: pw.current, next: pw.next }), 'Password changed')) setPw({ current: '', next: '', confirm: '' });
  };
  return html`<${PageHead} title="My account" sub=${me.email} />
    <div class="grid2">
      <section class="card"><h2>Profile</h2>
        <${Field} label="Name"><input value=${p.name} onInput=${(e) => setP({ ...p, name: e.target.value })} /></${Field}>
        <${Field} label="Phone"><input type="tel" value=${p.phone} onInput=${(e) => setP({ ...p, phone: e.target.value })} /></${Field}>
        <button class="btn primary" onClick=${saveProfile}>Save</button></section>
      <form class="card" onSubmit=${savePw}><h2>Change password</h2>
        <${Field} label="Current password"><input type="password" autocomplete="current-password" value=${pw.current} onInput=${(e) => setPw({ ...pw, current: e.target.value })} required /></${Field}>
        <${Field} label="New password"><input type="password" autocomplete="new-password" minlength="8" value=${pw.next} onInput=${(e) => setPw({ ...pw, next: e.target.value })} required /></${Field}>
        <${Field} label="Confirm new password"><input type="password" autocomplete="new-password" minlength="8" value=${pw.confirm} onInput=${(e) => setPw({ ...pw, confirm: e.target.value })} required /></${Field}>
        <button class="btn primary">Change password</button></form>
    </div>`;
}
