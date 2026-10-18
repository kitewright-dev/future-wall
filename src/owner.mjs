// Owner tools: move ownership to the main wallet, change the fee, pull fees out.
import { Interface, formatEther, parseEther, getAddress, toQuantity } from 'ethers';
import { CONFIG } from './config.mjs';
import { ensurePolygon, walletErrorText } from './wallet.mjs';

const iface = new Interface([
  'function owner() view returns (address)',
  'function fee() view returns (uint256)',
  'function transferOwnership(address)',
  'function setFee(uint256)',
  'function withdraw()',
]);
const $ = (s) => document.querySelector(s);
const say = (t) => { $('#msg').textContent = t; };

async function rpc(method, params) {
  let last;
  for (const u of CONFIG.rpcs) {
    try {
      const j = await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
      if (!j.error) return j.result; last = new Error(j.error.message);
    } catch (e) { last = e; }
  }
  throw last;
}
const call = async (fn) => iface.decodeFunctionResult(fn, await rpc('eth_call', [{ to: CONFIG.contract, data: iface.encodeFunctionData(fn) }, 'latest']))[0];

let account = null;
const eth = (method, params = []) => window.ethereum.request({ method, params });

async function refresh() {
  try {
    const [owner, fee, bal] = await Promise.all([call('owner'), call('fee'), rpc('eth_getBalance', [CONFIG.contract, 'latest'])]);
    $('#owner').textContent = owner;
    $('#fee').textContent = formatEther(fee) + ' POL';
    $('#bal').textContent = formatEther(BigInt(bal)) + ' POL';
    const mine = account && owner.toLowerCase() === account.toLowerCase();
    document.querySelectorAll('.own').forEach((b) => { b.disabled = !mine; });
    if (account && !mine) say('This wallet is not the owner. Connect the owner wallet.');
  } catch (e) { say('Could not reach Polygon: ' + e.message); }
}

async function send(fn, args) {
  await ensurePolygon(eth, CONFIG.rpcs[0]);
  const hash = await eth('eth_sendTransaction', [{ from: account, to: CONFIG.contract, data: iface.encodeFunctionData(fn, args), value: toQuantity(0) }]);
  say('Sent, waiting for the network…');
  for (let i = 0; i < 120; i++) {
    const rc = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (rc) { say(rc.status === '0x1' ? 'Done.' : 'It failed on chain.'); return refresh(); }
    await new Promise((r) => setTimeout(r, 2500));
  }
  say('Still pending, check the wallet history.');
}
const guard = (f) => async () => { try { await f(); } catch (e) { say(walletErrorText(e)); } };

$('#connect').onclick = guard(async () => {
  if (!window.ethereum) return say('Open this page inside the owner wallet app.');
  account = (await eth('eth_requestAccounts'))[0];
  await ensurePolygon(eth, CONFIG.rpcs[0]);
  $('#me').textContent = account;
  await refresh();
});
$('#transfer').onclick = guard(async () => {
  const to = getAddress($('#to').value.trim());
  if (!confirm(`Hand the contract to\n${to}\n\nThis can't be undone from this wallet afterwards.`)) return;
  await send('transferOwnership', [to]);
});
$('#setfee').onclick = guard(async () => { await send('setFee', [parseEther($('#newfee').value.trim())]); });
$('#withdraw').onclick = guard(async () => { await send('withdraw', []); });
$('#scan').href = `https://polygonscan.com/address/${CONFIG.contract}`;
refresh();
