// Puts the new contract on Polygon from the wallet that opens this page.
// That wallet becomes the owner and every fee goes straight to it.
import { Interface, AbiCoder, formatEther, parseEther, getCreateAddress, toQuantity } from 'ethers';
import ART from '../build/FutureWall.json';
import { CONFIG } from './config.mjs';
import { ensurePolygon, walletErrorText } from './wallet.mjs';

const $ = (s) => document.querySelector(s);
const say = (t) => { $('#msg').textContent = t; };
const FEE = parseEther('11');
const iface = new Interface(ART.abi);

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
const eth = (method, params = []) => window.ethereum.request({ method, params });
let account = null;

$('#fee').textContent = formatEther(FEE) + ' POL';
$('#connect').onclick = async () => {
  try {
    if (!window.ethereum) return say('Open this page inside your wallet app (MetaMask, Trust…).');
    account = (await eth('eth_requestAccounts'))[0];
    await ensurePolygon(eth, CONFIG.rpcs[0]);
    const [bal, nonce] = await Promise.all([rpc('eth_getBalance', [account, 'latest']), rpc('eth_getTransactionCount', [account, 'latest'])]);
    $('#me').textContent = account;
    $('#bal').textContent = Number(formatEther(BigInt(bal))).toFixed(3) + ' POL';
    $('#addr').textContent = getCreateAddress({ from: account, nonce: BigInt(nonce) });
    $('#go').disabled = BigInt(bal) < parseEther('1.2');
    say(BigInt(bal) < parseEther('1.2') ? 'You need about 1.2 POL in this wallet for the gas.' : 'Ready. This wallet will own the contract and get every fee.');
  } catch (e) { say(walletErrorText(e)); }
};
$('#go').onclick = async () => {
  if (!confirm(`Put Future Wall v2 on Polygon?\n\nOwner and fee receiver:\n${account}`)) return;
  $('#go').disabled = true;
  try {
    await ensurePolygon(eth, CONFIG.rpcs[0]);
    const args = AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [account, FEE]).slice(2);
    const hash = await eth('eth_sendTransaction', [{ from: account, data: ART.bytecode + args, value: toQuantity(0) }]);
    say('Sent, waiting for Polygon…');
    let rc = null;
    for (let i = 0; i < 150 && !rc; i++) { await new Promise((r) => setTimeout(r, 2500)); rc = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null); }
    if (!rc) return say('Still pending. Check the wallet history, then send Claude the tx: ' + hash);
    if (rc.status !== '0x1') return say('The deploy failed on chain. tx ' + hash);
    const addr = rc.contractAddress;
    const call = async (fn) => iface.decodeFunctionResult(fn, await rpc('eth_call', [{ to: addr, data: iface.encodeFunctionData(fn) }, 'latest']))[0];
    const [owner, fee] = await Promise.all([call('owner'), call('fee')]);
    const ok = owner.toLowerCase() === account.toLowerCase() && fee === FEE;
    $('#done').hidden = false;
    $('#newaddr').textContent = addr;
    $('#tx').textContent = hash;
    say(ok ? 'Live. Send Claude the address above.' : 'Deployed but the read-back looks off, send Claude the address.');
  } catch (e) { say(walletErrorText(e)); $('#go').disabled = false; }
};
$('#copy').onclick = async () => { try { await navigator.clipboard.writeText($('#newaddr').textContent + '\n' + $('#tx').textContent); say('Copied.'); } catch {} };
