'use strict';
// Minimal SMTP client (no dependencies). Supports implicit TLS (port 465) and STARTTLS (587/25), AUTH LOGIN.
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const os = require('node:os');

function encodeHeader(s) {
  s = String(s ?? '');
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
}
function addr(s) { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : String(s)).trim(); }
function wrap64(buf) { return buf.toString('base64').replace(/.{76}/g, '$&\r\n'); }

function sendMail(cfg, { to, subject, html, text, replyTo }) {
  return new Promise((resolve, reject) => {
    const port = parseInt(cfg.port, 10) || 465;
    const implicitTLS = port === 465;
    const host = cfg.host;
    let sock;
    let buf = '';
    let waiter = null;
    const timeout = setTimeout(() => fail(new Error('SMTP timeout')), 30000);

    function fail(err) { clearTimeout(timeout); try { sock && sock.destroy(); } catch {} reject(err); }
    function onData(d) {
      buf += d.toString('utf8');
      // A complete reply ends with a line "NNN text" (space after code)
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const reply = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null;
          if (w) w(reply);
          return;
        }
      }
    }
    function attach(s) { s.on('data', onData); s.on('error', fail); }
    function read() { return new Promise((res) => { waiter = res; }); }
    async function cmd(line, expect) {
      if (line != null) sock.write(line + '\r\n');
      const reply = await read();
      const code = parseInt(reply.slice(0, 3), 10);
      if (expect && !expect.includes(code)) throw new Error(`SMTP error after "${(line || '').split(' ')[0]}": ${reply}`);
      return reply;
    }

    async function run() {
      const me = os.hostname() || 'localhost';
      await cmd(null, [220]);
      let ehlo = await cmd(`EHLO ${me}`, [250]);
      if (!implicitTLS && /STARTTLS/i.test(ehlo)) {
        await cmd('STARTTLS', [220]);
        sock.removeAllListeners('data');
        sock = tls.connect({ socket: sock, servername: host });
        attach(sock);
        await new Promise((r) => sock.once('secureConnect', r));
        ehlo = await cmd(`EHLO ${me}`, [250]);
      }
      if (cfg.user) {
        await cmd('AUTH LOGIN', [334]);
        await cmd(Buffer.from(cfg.user).toString('base64'), [334]);
        await cmd(Buffer.from(cfg.pass || '').toString('base64'), [235]);
      }
      const from = cfg.from || cfg.user;
      await cmd(`MAIL FROM:<${addr(from)}>`, [250]);
      await cmd(`RCPT TO:<${addr(to)}>`, [250, 251]);
      await cmd('DATA', [354]);
      const boundary = 'b' + crypto.randomBytes(12).toString('hex');
      const headers = [
        `From: ${from.includes('<') ? from.replace(/^([^<]*)</, (m, n) => encodeHeader(n.trim()) + ' <') : from}`,
        `To: ${to}`,
        replyTo ? `Reply-To: ${replyTo}` : null,
        `Subject: ${encodeHeader(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${addr(from).split('@')[1] || 'localhost'}>`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ].filter(Boolean);
      const body = [
        `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
        wrap64(Buffer.from(text || '')),
        `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
        wrap64(Buffer.from(html || '')),
        `--${boundary}--`, '',
      ];
      sock.write(headers.join('\r\n') + '\r\n\r\n' + body.join('\r\n') + '\r\n.\r\n');
      await cmd(null, [250]);
      sock.write('QUIT\r\n');
      clearTimeout(timeout);
      sock.end();
      resolve(true);
    }

    sock = implicitTLS ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    attach(sock);
    run().catch(fail);
  });
}

module.exports = { sendMail };
