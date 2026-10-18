// Wallet plumbing kept apart from the page so the tests can drive it with a fake provider.
import metamaskIcon from '@web3icons/core/svgs/wallets/background/metamask.svg.js';
import trustIcon from '@web3icons/core/svgs/wallets/background/trust.svg.js';
import coinbaseIcon from '@web3icons/core/svgs/wallets/background/coinbase.svg.js';

const svgUri = (s) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
export const ICONS = { metamask: svgUri(metamaskIcon), trust: svgUri(trustIcon), coinbase: svgUri(coinbaseIcon) };

export const POLYGON = {
  chainId: '0x89',
  chainName: 'Polygon',
  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
  blockExplorerUrls: ['https://polygonscan.com'],
};

// Links that open the page inside a wallet app's own browser.
// MetaMask moved its links to link.metamask.io; the old metamask.app.link
// often just opens the wallet home screen without loading the page.
export function walletLinks(loc) {
  const bare = loc.host + loc.pathname + loc.search;
  const enc = encodeURIComponent(loc.href);
  return [
    { key: 'metamask', name: 'MetaMask', href: `https://link.metamask.io/dapp/${bare}` },
    { key: 'trust', name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=966&url=${enc}` },
    { key: 'coinbase', name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${enc}` },
  ];
}

// Best guess at which known wallet an injected provider is, for its icon.
export function guessKey(name = '', p = {}) {
  const n = name.toLowerCase();
  if (p.isTrust || p.isTrustWallet || n.includes('trust')) return 'trust';
  if (p.isCoinbaseWallet || n.includes('coinbase')) return 'coinbase';
  if (p.isMetaMask || n.includes('metamask')) return 'metamask';
  return null;
}

// Error codes come back in different places depending on the wallet.
// MetaMask mobile wraps "unknown chain" as -32603 with the real code inside.
export function codeOf(e) {
  return e?.code ?? e?.data?.originalError?.code ?? e?.error?.code;
}
export function isUnknownChain(e) {
  const c = [e?.code, e?.data?.originalError?.code, e?.error?.code];
  return c.includes(4902) || /unrecognized chain|not added|unknown chain|try adding the chain/i.test(e?.message || '');
}

// Makes sure the wallet is on Polygon, adding the network if it has never seen it.
export async function ensurePolygon(request, rpcUrl) {
  const now = await request('eth_chainId');
  if (BigInt(now) === 137n) return;
  try {
    await request('wallet_switchEthereumChain', [{ chainId: POLYGON.chainId }]);
  } catch (e) {
    if (!isUnknownChain(e)) throw e;
    await request('wallet_addEthereumChain', [{ ...POLYGON, rpcUrls: [rpcUrl] }]);
  }
  const after = await request('eth_chainId');
  if (BigInt(after) !== 137n) throw new Error('Switch your wallet to Polygon and try again.');
}

export function walletErrorText(e) {
  const c = codeOf(e);
  if (e?.code === 'ACTION_REJECTED' || c === 4001) return 'You cancelled it in the wallet.';
  if (c === -32002) return 'Your wallet already has a request waiting. Open the wallet and answer it.';
  const m = e?.shortMessage || e?.reason || e?.message || String(e);
  if (/insufficient funds/i.test(m)) return 'Not enough POL in this wallet for the fee plus gas.';
  return m.length > 140 ? m.slice(0, 140) + '…' : m;
}
