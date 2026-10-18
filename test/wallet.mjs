// Drives the wallet helpers with fake providers that behave like the real wallets do.
import assert from 'node:assert/strict';
import { walletLinks, ensurePolygon, isUnknownChain, walletErrorText, guessKey, ICONS } from '../src/wallet.mjs';

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

function fakeWallet({ chain = '0x1', knowsPolygon = true, wrap = false } = {}) {
  const calls = [];
  const request = async (method, params) => {
    calls.push(method);
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') {
      if (!knowsPolygon) {
        if (wrap) throw Object.assign(new Error('Internal JSON-RPC error.'), { code: -32603, data: { originalError: { code: 4902, message: 'Unrecognized chain ID "0x89".' } } });
        throw Object.assign(new Error('Unrecognized chain ID "0x89". Try adding the chain using wallet_addEthereumChain first.'), { code: 4902 });
      }
      chain = params[0].chainId; return null;
    }
    if (method === 'wallet_addEthereumChain') {
      assert.equal(params[0].chainId, '0x89');
      assert.ok(params[0].rpcUrls[0].startsWith('https://'));
      knowsPolygon = true; chain = '0x89'; return null;
    }
    throw new Error('unexpected ' + method);
  };
  return { request, calls };
}

console.log('wallet');
{
  const l = walletLinks({ host: 'future-wall.vercel.app', pathname: '/', search: '', href: 'https://future-wall.vercel.app/' });
  assert.deepEqual(l.map((x) => x.key), ['metamask', 'trust', 'coinbase']);
  assert.equal(l[0].href, 'https://link.metamask.io/dapp/future-wall.vercel.app/');
  assert.equal(l[1].href, 'https://link.trustwallet.com/open_url?coin_id=966&url=https%3A%2F%2Ffuture-wall.vercel.app%2F');
  assert.equal(l[2].href, 'https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Ffuture-wall.vercel.app%2F');
  ok('three wallets, current MetaMask link format, no OKX');
}
{
  for (const k of ['metamask', 'trust', 'coinbase']) {
    const svg = decodeURIComponent(ICONS[k].split(',')[1]);
    assert.ok(ICONS[k].startsWith('data:image/svg+xml') && svg.startsWith('<svg') && svg.trim().endsWith('</svg>'), k);
  }
  ok('icons for all three wallets are complete svg data uris');
}
{
  const w = fakeWallet({ chain: '0x89' });
  await ensurePolygon(w.request, 'https://x.org');
  assert.deepEqual(w.calls, ['eth_chainId']);
  ok('already on Polygon: no switch prompt');
}
{
  const w = fakeWallet({ chain: '0x1' });
  await ensurePolygon(w.request, 'https://x.org');
  assert.deepEqual(w.calls, ['eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId']);
  ok('on Ethereum: switches to Polygon');
}
{
  const w = fakeWallet({ chain: '0x1', knowsPolygon: false });
  await ensurePolygon(w.request, 'https://x.org');
  assert.ok(w.calls.includes('wallet_addEthereumChain'));
  ok('Polygon missing (code 4902): adds it');
}
{
  const w = fakeWallet({ chain: '0x1', knowsPolygon: false, wrap: true });
  await ensurePolygon(w.request, 'https://x.org');
  assert.ok(w.calls.includes('wallet_addEthereumChain'));
  ok('Polygon missing, MetaMask mobile style wrapped -32603: still adds it');
}
{
  const w = { request: async (m) => { if (m === 'eth_chainId') return '0x1'; throw Object.assign(new Error('User rejected'), { code: 4001 }); } };
  await assert.rejects(ensurePolygon(w.request, 'x'), (e) => walletErrorText(e) === 'You cancelled it in the wallet.' && !isUnknownChain(e));
  ok('user says no to the switch: clean message, no add attempt');
}
{
  const w = { request: async (m) => (m === 'eth_chainId' ? '0x1' : null) };
  await assert.rejects(ensurePolygon(w.request, 'x'), /Switch your wallet to Polygon/);
  ok('wallet claims it switched but did not: caught');
}
{
  assert.match(walletErrorText({ code: -32002 }), /already has a request/);
  assert.equal(guessKey('', { isMetaMask: true }), 'metamask');
  assert.equal(guessKey('Trust Wallet', {}), 'trust');
  assert.equal(guessKey('', { isCoinbaseWallet: true, isMetaMask: true }), 'coinbase');
  ok('pending request message and wallet guessing');
}
{
  const fs = await import('node:fs');
  const { Interface } = await import('ethers');
  const art = new Interface(JSON.parse(fs.readFileSync(new URL('../build/FutureWall.json', import.meta.url))).abi);
  for (const f of ['owner()', 'fee()', 'transferOwnership(address)', 'setFee(uint256)', 'withdraw()']) assert.ok(art.getFunction(f), f);
  ok('owner page calls exist in the deployed contract ABI');
}
console.log(`\n${passed} wallet checks passed`);
