// Runs in CI. Sends the pre-signed deploy transaction once and records the result.
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('build/deploy.json', 'utf8'));
const RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://1rpc.io/matic', 'https://polygon-rpc.com'];
async function call(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return r.json();
}
async function any(method, params) {
  let last;
  for (const u of RPCS) { try { const j = await call(u, method, params); if (!j.error) return j.result; last = u + ': ' + j.error.message; } catch (e) { last = u + ': ' + e.message; } }
  throw new Error(last);
}
const out = [];
const log = (s) => { console.log(s); out.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  log(`time ${new Date().toISOString()}`);
  log(`deployer ${d.from}\ncontract ${d.contract}\ntx ${d.hash}`);
  let rc = await any('eth_getTransactionReceipt', [d.hash]);
  if (!rc) {
    const code = await any('eth_getCode', [d.contract, 'latest']);
    if (code && code !== '0x') throw new Error('contract address already has code but not from this tx');
    const nonce = BigInt(await any('eth_getTransactionCount', [d.from, 'latest']));
    const bal = BigInt(await any('eth_getBalance', [d.from, 'latest']));
    const gas = BigInt(await any('eth_gasPrice', []));
    log(`nonce ${nonce} balance ${Number(bal / 10n ** 14n) / 1e4} POL gasPrice ${Number(gas / 10n ** 6n) / 1e3} gwei`);
    if (nonce !== 0n) throw new Error('deployer nonce is not 0, the signed tx is dead, re-sign needed');
    if (gas > 380n * 10n ** 9n) throw new Error('gas price above the signed max of 400 gwei, try again later');
    for (const u of RPCS) {
      try { const j = await call(u, 'eth_sendRawTransaction', [d.raw]); log(`send via ${u}: ${j.result || JSON.stringify(j.error)}`); } catch (e) { log(`send via ${u}: ${e.message}`); }
    }
    for (let i = 0; i < 90 && !rc; i++) { await sleep(4000); try { rc = await any('eth_getTransactionReceipt', [d.hash]); } catch {} }
  }
  if (!rc) throw new Error('no receipt after 6 minutes');
  log(`block ${parseInt(rc.blockNumber, 16)} status ${rc.status} gasUsed ${parseInt(rc.gasUsed, 16)} paid ${Number(BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice) / 10n ** 14n) / 1e4} POL`);
  if (rc.status !== '0x1') throw new Error('deploy reverted');
  // read back
  const iface = { owner: '0x8da5cb5b', fee: '0xddca3f43', name: '0x06fdde03' };
  const owner = await any('eth_call', [{ to: d.contract, data: iface.owner }, 'latest']);
  const fee = await any('eth_call', [{ to: d.contract, data: iface.fee }, 'latest']);
  log(`owner 0x${owner.slice(-40)}\nfee ${Number(BigInt(fee) / 10n ** 14n) / 1e4} POL`);
  log('RESULT live');
} catch (e) {
  log('RESULT error ' + e.message);
  process.exitCode = 1;
} finally {
  fs.mkdirSync('ci-out', { recursive: true });
  fs.writeFileSync('ci-out/launch.txt', out.join('\n') + '\n');
}
