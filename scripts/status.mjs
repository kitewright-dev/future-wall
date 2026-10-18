// Runs in CI: reads both contracts off Polygon and writes what it sees.
import fs from 'node:fs';
import { id } from 'ethers';
const RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://1rpc.io/matic', 'https://polygon-rpc.com'];
async function any(method, params) {
  let last;
  for (const u of RPCS) {
    try { const j = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (!j.error) return j.result; last = j.error.message; } catch (e) { last = e.message; }
  }
  throw new Error(last);
}
const sel = (sig) => id(sig).slice(0, 10);
const call = (to, sig) => any('eth_call', [{ to, data: sel(sig) }, 'latest']);
const pol = (h) => (Number(BigInt(h) / 10n ** 14n) / 1e4).toString();
const out = [];
const v1 = JSON.parse(fs.readFileSync('v1/deploy.json', 'utf8')).contract;
const live = fs.readFileSync('src/config.mjs', 'utf8').match(/"contract":\s*"(0x[0-9a-fA-F]{40})"/)[1];
try {
  const list = [['v1', v1]];
  if (live.toLowerCase() !== v1.toLowerCase()) list.push(['live', live]);
  for (const [name, addr] of list) {
    const code = await any('eth_getCode', [addr, 'latest']);
    if (!code || code === '0x') { out.push(`${name} ${addr} no code`); continue; }
    const [o, f, t, b] = await Promise.all([call(addr, 'owner()'), call(addr, 'fee()'), call(addr, 'totalSealed()'), any('eth_getBalance', [addr, 'latest'])]);
    out.push(`${name} ${addr} owner 0x${o.slice(-40)} fee ${pol(f)} POL letters ${BigInt(t)} holding ${pol(b)} POL`);
  }
  out.push('RESULT ok');
} catch (e) { out.push('RESULT error ' + e.message); process.exitCode = 1; }
console.log(out.join('\n'));
fs.mkdirSync('ci-out', { recursive: true });
fs.writeFileSync('ci-out/status.txt', out.join('\n') + '\n');
