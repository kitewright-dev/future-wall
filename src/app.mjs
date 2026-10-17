import { Interface, formatEther, toBeHex } from 'ethers';
import { sealLetter, openLetter, fetchingClient, timeOfRound, commitmentOf, MAX_TEXT } from './core.mjs';
import { CONFIG } from './config.mjs';

const ABI = [
  'function seal(uint64 round, bytes32 commitment, bytes ciphertext) payable returns (uint256)',
  'function open(uint256 id, bytes32 salt, string text)',
  'function fee() view returns (uint256)',
  'function totalSealed() view returns (uint256)',
  'function lettersForYear(uint256) view returns (uint256)',
  'function letter(uint256 id) view returns (tuple(uint64 round, uint64 unlockTime, uint64 sealedAt, bool revealed, bytes32 commitment) l, string text)',
  'function ciphertextOf(uint256 id) view returns (bytes)',
  'function tokenURI(uint256 id) view returns (string)',
  'event Sealed(uint256 indexed id, address indexed writer, uint64 round, uint64 unlockTime)',
];
const iface = new Interface(ABI);
const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// ---------- read side: public RPCs, tried in order ----------
let rpcIndex = 0;
async function rpc(method, params) {
  let last;
  for (let i = 0; i < CONFIG.rpcs.length; i++) {
    const url = CONFIG.rpcs[(rpcIndex + i) % CONFIG.rpcs.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) { if (j.error.data !== undefined || /revert/i.test(j.error.message)) throw Object.assign(new Error(j.error.message), { revert: true }); throw new Error(j.error.message); }
      rpcIndex = (rpcIndex + i) % CONFIG.rpcs.length;
      return j.result;
    } catch (e) { last = e; if (e.revert) throw e; }
  }
  throw last;
}
async function read(fn, args = []) {
  const data = iface.encodeFunctionData(fn, args);
  const out = await rpc('eth_call', [{ to: CONFIG.contract, data }, 'latest']);
  return iface.decodeFunctionResult(fn, out);
}

// ---------- wallet ----------
let account = null;
const eth = (method, params = []) => window.ethereum.request({ method, params });
async function connect() {
  if (!window.ethereum) {
    const here = location.host + location.pathname;
    toast('No wallet here. Open this page inside your wallet app browser.', `https://metamask.app.link/dapp/${here}${location.search}`);
    throw new Error('no wallet');
  }
  const accs = await eth('eth_requestAccounts');
  account = accs[0];
  const chain = await eth('eth_chainId');
  if (BigInt(chain) !== 137n) {
    try {
      await eth('wallet_switchEthereumChain', [{ chainId: '0x89' }]);
    } catch (e) {
      if (e.code === 4902 || /unrecognized|not added/i.test(e.message || '')) {
        await eth('wallet_addEthereumChain', [{ chainId: '0x89', chainName: 'Polygon', nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 }, rpcUrls: [CONFIG.rpcs[0]], blockExplorerUrls: ['https://polygonscan.com'] }]);
      } else throw e;
    }
  }
  $('#connect').textContent = short(account);
  return account;
}
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
// Sends a contract call from the connected wallet and waits for it to be mined.
async function send(fn, args, value = 0n) {
  const tx = { from: account, to: CONFIG.contract, data: iface.encodeFunctionData(fn, args), value: toBeHex(value) };
  const hash = await eth('eth_sendTransaction', [tx]);
  return { hash, wait: () => waitReceipt(hash) };
}
async function waitReceipt(hash) {
  for (let i = 0; i < 300; i++) {
    let rc = null;
    try { rc = await rpc('eth_getTransactionReceipt', [hash]); } catch {}
    if (!rc) { try { rc = await eth('eth_getTransactionReceipt', [hash]); } catch {} }
    if (rc) {
      if (rc.status !== '0x1') throw new Error('The transaction failed on chain.');
      return rc;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Still waiting for the network. Check the wallet history.');
}

// ---------- small ui helpers ----------
let toastTimer;
function toast(msg, link) {
  const t = $('#toast');
  t.replaceChildren(el('span', null, msg));
  if (link) { const a = el('a', null, 'Open in MetaMask'); a.href = link; t.append(' ', a); }
  t.dataset.show = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.dataset.show = ''; }, link ? 9000 : 4500);
}
function errText(e) {
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001) return 'You cancelled it in the wallet.';
  const m = e?.shortMessage || e?.reason || e?.message || String(e);
  if (/insufficient funds/i.test(m)) return 'Not enough POL in this wallet for the fee plus gas.';
  return m.length > 140 ? m.slice(0, 140) + '…' : m;
}
const fmtDate = (unix) => new Date(unix * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function countdown(unix) {
  let s = Math.max(0, Math.floor(unix - Date.now() / 1000));
  if (s === 0) return 'ready';
  const y = Math.floor(s / 31557600); s -= y * 31557600;
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (y) return `${y}y ${d}d`;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s - m * 60}s`;
}
const imageOf = (uri) => JSON.parse(atob(uri.split(',')[1])).image;
const hidden = new Set(CONFIG.hidden.map(String));

// ---------- stats ----------
async function loadStats() {
  try {
    const [[total], [fee]] = await Promise.all([read('totalSealed'), read('fee')]);
    $('#total').textContent = total.toString();
    $('#fee').textContent = formatEther(fee);
    state.fee = fee;
    const now = new Date().getUTCFullYear();
    const years = [now, now + 1, 2030, 2035, 2050].filter((v, i, a) => a.indexOf(v) === i && v >= now);
    const counts = await Promise.all(years.map((y) => read('lettersForYear', [y]).then((r) => r[0])));
    const box = $('#years'); box.replaceChildren();
    years.forEach((y, i) => {
      const c = el('div', 'year');
      c.append(el('b', null, counts[i].toString()), el('span', null, `waiting for ${y}`));
      box.append(c);
    });
    return Number(total);
  } catch (e) {
    $('#total').textContent = '·';
    console.warn(e);
    return 0;
  }
}

// ---------- recent letters ----------
async function loadRecent(total) {
  const grid = $('#recent'); grid.replaceChildren();
  if (!total) { grid.append(el('p', 'muted', 'No letters yet. Yours could be number one.')); return; }
  const ids = [];
  for (let i = total; i >= 1 && ids.length < 12; i--) if (!hidden.has(String(i))) ids.push(i);
  await Promise.all(ids.map(async (id, k) => {
    const card = el('a', 'card'); card.href = `?id=${id}`; card.style.setProperty('--i', k);
    const img = el('img'); img.alt = `Letter ${id}`; img.loading = 'lazy';
    card.append(img, el('span', 'cd', '…'));
    grid.append(card);
    try {
      const [[uri], [l]] = await Promise.all([read('tokenURI', [id]), read('letter', [id])]);
      img.src = imageOf(uri);
      const t = Number(l.unlockTime);
      const tick = () => { card.lastChild.textContent = l.revealed ? 'opened' : countdown(t); };
      tick(); timers.push(setInterval(tick, 1000));
    } catch { card.lastChild.textContent = '?'; }
  }));
}
const timers = [];

// ---------- writing ----------
const state = { fee: null, unlock: null };
function setUnlock(unix, label) {
  state.unlock = unix;
  $('#when').textContent = `Opens ${fmtDate(unix)}${label ? ' · ' + label : ''}`;
}
function presetDate(kind) {
  const now = new Date();
  if (kind === '1y') return Math.floor(new Date(now.getTime() + 365.25 * 864e5).getTime() / 1000);
  if (kind === '5y') return Math.floor(new Date(now.getTime() + 5 * 365.25 * 864e5).getTime() / 1000);
  if (kind === '2030') return Date.UTC(2030, 0, 1) / 1000;
  return null;
}
function wireWriter() {
  const ta = $('#text'), cnt = $('#count');
  const enc = new TextEncoder();
  ta.addEventListener('input', () => {
    const n = enc.encode(ta.value).length;
    cnt.textContent = `${n} / ${MAX_TEXT}`;
    cnt.dataset.over = n > MAX_TEXT ? '1' : '';
  });
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-preset]').forEach((x) => x.removeAttribute('aria-pressed'));
    b.setAttribute('aria-pressed', 'true');
    const k = b.dataset.preset;
    if (k === 'pick') { $('#pick').hidden = false; $('#pick').focus(); return; }
    $('#pick').hidden = true;
    setUnlock(presetDate(k), k === '2030' ? 'New Year seal' : '');
  }));
  $('#pick').addEventListener('change', (e) => {
    const t = Math.floor(new Date(e.target.value).getTime() / 1000);
    if (!t) return;
    const d = new Date(t * 1000);
    setUnlock(t, d.getUTCMonth() === 0 && d.getUTCDate() === 1 ? 'New Year seal' : '');
  });
  document.querySelector('[data-preset="1y"]').click();

  $('#seal').addEventListener('click', async () => {
    const btn = $('#seal');
    const text = ta.value;
    if (!text.trim()) return toast('Write something first.');
    if (enc.encode(text).length > MAX_TEXT) return toast('That letter is a bit too long.');
    if (!state.unlock || state.unlock < Date.now() / 1000 + 3700) return toast('Pick a date at least an hour or two away.');
    btn.disabled = true;
    try {
      await connect();
      btn.textContent = 'Locking it…';
      const s = await sealLetter(text, state.unlock);
      const fee = state.fee ?? (await read('fee'))[0];
      btn.textContent = 'Confirm in your wallet';
      const tx = await send('seal', [s.round, s.commitment, s.ciphertext], fee);
      btn.textContent = 'Sealing…';
      const rc = await tx.wait();
      const log = rc.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((x) => x?.name === 'Sealed');
      const id = log ? log.args.id.toString() : null;
      ta.value = ''; ta.dispatchEvent(new Event('input'));
      if (id) location.search = `?id=${id}&new=1`;
    } catch (e) {
      if (e.message !== 'no wallet') toast(errText(e));
    } finally {
      btn.disabled = false; btn.textContent = 'Seal it';
    }
  });
}

// ---------- one letter ----------
async function showLetter(id) {
  $('#home').hidden = true;
  const v = $('#view'); v.hidden = false;
  $('#v-title').textContent = `Letter No. ${id}`;
  try {
    const [[uri], [l, text]] = await Promise.all([read('tokenURI', [id]), read('letter', [id])]);
    $('#v-img').src = imageOf(uri);
    const unlock = Number(l.unlockTime);
    const status = $('#v-status');
    const body = $('#v-body');
    const tick = () => {
      if (l.revealed) status.textContent = `Opened. It was locked until ${fmtDate(unlock)}.`;
      else if (Date.now() / 1000 < unlock) status.textContent = `Locked for ${countdown(unlock)} more. Opens ${fmtDate(unlock)}.`;
      else status.textContent = 'The date has passed. Anyone can open it now.';
    };
    tick(); timers.push(setInterval(tick, 1000));
    if (new URLSearchParams(location.search).get('new')) $('#v-new').hidden = false;
    if (l.revealed) {
      body.hidden = false; body.textContent = hidden.has(String(id)) ? '(hidden from this site)' : text;
      return;
    }
    const openBtn = $('#v-open');
    const arm = () => { openBtn.hidden = !(Date.now() / 1000 >= unlock + 5); };
    arm(); timers.push(setInterval(arm, 1000));
    openBtn.onclick = async () => {
      openBtn.disabled = true; openBtn.textContent = 'Getting the key from drand…';
      try {
        const [ct] = await read('ciphertextOf', [id]);
        const o = await openLetter(ct, await fetchingClient());
        if (commitmentOf(o.salt, o.text) !== l.commitment) throw new Error('This one does not match what was sealed.');
        body.hidden = false; body.textContent = o.text;
        openBtn.hidden = true;
        const pub = $('#v-publish'); pub.hidden = false;
        pub.onclick = async () => {
          pub.disabled = true;
          try {
            await connect();
            pub.textContent = 'Confirm in your wallet';
            const tx = await send('open', [id, o.salt, o.text]);
            pub.textContent = 'Saving…';
            await tx.wait();
            toast('Done. The envelope is now the letter, forever.');
            setTimeout(() => location.reload(), 1500);
          } catch (e) { if (e.message !== 'no wallet') toast(errText(e)); pub.disabled = false; pub.textContent = 'Put it on the wall'; }
        };
      } catch (e) {
        toast(errText(e)); openBtn.disabled = false; openBtn.textContent = 'Open it';
      }
    };
  } catch (e) {
    $('#v-status').textContent = 'Could not find that letter.';
  }
  $('#v-share').onclick = async () => {
    const url = location.origin + location.pathname + `?id=${id}`;
    try { if (navigator.share) await navigator.share({ title: 'A letter to the future', url }); else { await navigator.clipboard.writeText(url); toast('Link copied.'); } } catch {}
  };
}

// ---------- boot ----------
async function boot() {
  $('#connect').addEventListener('click', () => connect().catch((e) => { if (e.message !== 'no wallet') toast(errText(e)); }));
  $('#scan').href = `https://polygonscan.com/address/${CONFIG.contract}`;
  const id = new URLSearchParams(location.search).get('id');
  const total = await loadStats();
  if (id && /^\d+$/.test(id)) return showLetter(id);
  wireWriter();
  loadRecent(total);
}
boot();
