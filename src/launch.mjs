import { LAUNCH } from './launch-data.mjs';
import { CONFIG } from './config.mjs';
const $ = (s) => document.querySelector(s);
async function call(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return r.json();
}
async function any(method, params) {
  let last;
  for (const u of CONFIG.rpcs) { try { const j = await call(u, method, params); if (!j.error) return j.result; last = j.error.message; } catch (e) { last = e.message; } }
  throw new Error(last);
}
const pol = (hex) => (Number(BigInt(hex) / 10n ** 14n) / 1e4).toFixed(4);
async function refresh() {
  $('#from').textContent = LAUNCH.from; $('#addr').textContent = LAUNCH.contract;
  try {
    const rc = await any('eth_getTransactionReceipt', [LAUNCH.hash]);
    if (rc) {
      const ok = rc.status === '0x1';
      $('#state').textContent = ok ? 'Live on Polygon.' : 'The launch transaction failed. Tell Claude.';
      $('#go').hidden = true;
      $('#links').hidden = !ok;
      return true;
    }
    const bal = await any('eth_getBalance', [LAUNCH.from, 'latest']);
    const nonce = await any('eth_getTransactionCount', [LAUNCH.from, 'latest']);
    $('#bal').textContent = pol(bal) + ' POL';
    if (BigInt(nonce) > 0n) { $('#state').textContent = 'This wallet already sent something else, so the prepared launch can no longer go through. Tell Claude.'; $('#go').hidden = true; return true; }
    const enough = BigInt(bal) >= 1360000000000000000n;
    $('#state').textContent = enough ? 'Ready to launch.' : 'Waiting for at least 1.4 POL in the launch wallet.';
    $('#go').disabled = !enough;
  } catch (e) { $('#state').textContent = 'Could not reach Polygon: ' + e.message; }
  return false;
}
$('#go').onclick = async () => {
  $('#go').disabled = true; $('#go').textContent = 'Sending…';
  const results = await Promise.allSettled(CONFIG.rpcs.map((u) => call(u, 'eth_sendRawTransaction', [LAUNCH.raw])));
  const msgs = results.map((r) => r.status === 'fulfilled' ? (r.value.result || r.value.error?.message) : r.reason.message);
  $('#log').textContent = msgs.join('\n');
  $('#go').textContent = 'Launch';
  const t = setInterval(async () => { if (await refresh()) clearInterval(t); }, 4000);
};
refresh();
