// Reloj real: permite que Chrome entregue IntersectionObserver dentro de iframes.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function chromeSmokeResult(chrome, profile, url) {
  const child = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1100', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  let socket;
  let launchError;
  child.on('error', err => { launchError = err; });
  const pending = new Map();
  let sequence = 0;
  let diagnostic;
  try {
    let target;
    const end = Date.now() + 20000;
    while (!target && Date.now() < end) {
      if (launchError) throw launchError;
      try {
        const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
        const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
        target = pages.find(page => page.type === 'page' && page.url === url);
      } catch {}
      if (!target) await delay(100);
    }
    if (!target) throw new Error('Chrome no abrió la página de prueba.');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const handler = pending.get(message.id);
      if (handler) { pending.delete(message.id); handler(message); }
    });
    while (Date.now() < end) {
      const id = ++sequence;
      const response = new Promise(resolve => pending.set(id, resolve));
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
        expression: `({smoke:document.body?.dataset.smoke,frames:[...document.querySelectorAll('iframe')].map(f=>({url:f.contentWindow.location.href,stage:f.contentDocument.body?.dataset.stage,errors:f.contentWindow.smokeErrors}))})`, returnByValue: true,
      } }));
      const result = await Promise.race([response, delay(2000).then(() => { throw new Error('Chrome no responde.'); })]);
      diagnostic = result.result?.result?.value;
      if (diagnostic?.smoke) return diagnostic.smoke;
      await delay(100);
    }
    throw new Error('La prueba no publicó resultado: ' + JSON.stringify(diagnostic));
  } finally {
    socket?.close();
    if (child.exitCode === null) {
      const closed = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([closed, delay(3000)]);
    }
  }
};
