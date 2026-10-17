// Full test: contract on a local Cancun chain + real tlock encryption/decryption
// against a locally generated drand-style key (same scheme as quicknet).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { ethers } from 'ethers';
import { sealLetter, openLetter, offlineClient, roundAtTime, timeOfRound, commitmentOf, QUICKNET } from '../src/core.mjs';

const require = createRequire(import.meta.url);
const hre = require('hardhat');
const { bls12_381 } = require('@noble/curves/bls12-381');
const { sha256 } = require('@noble/hashes/sha256');
const { Resvg } = require('@resvg/resvg-js');

let passed = 0;
const IFACE = new ethers.Interface(JSON.parse(fs.readFileSync(new URL('../build/FutureWall.json', import.meta.url))).abi.concat(['error OwnableUnauthorizedAccount(address)']));
const ok = (name) => { passed++; console.log('  ✓', name); };
async function rejects(p, err, name) {
  try { await p; } catch (e) {
    let s = String(e.message || e) + (e.shortMessage || '');
    try { s += ' ' + IFACE.parseError(e.data).name; } catch {}
    try { s += ' ' + IFACE.parseError(e.info.error.data).name; } catch {}
    assert.ok(s.includes(err) || (e.revert && e.revert.name === err), `${name}: expected ${err}, got ${s.slice(0, 200)}`);
    return ok(name);
  }
  throw new Error(name + ': did not revert');
}

// ----- fake drand network with our own key -----
const sk = bls12_381.utils.randomPrivateKey();
const pkHex = Buffer.from(bls12_381.G2.ProjectivePoint.BASE.multiply(BigInt('0x' + Buffer.from(sk).toString('hex'))).toRawBytes(true)).toString('hex');
const FAKE = { ...QUICKNET, public_key: pkHex, genesis_time: Math.floor(Date.now() / 1000) - 1_000_000, hash: 'f'.repeat(64) };
function beaconFor(round) {
  const msg = sha256(Buffer.from(round.toString(16).padStart(16, '0'), 'hex'));
  const P = bls12_381.G1.hashToCurve(msg, { DST: 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_' });
  const sig = Buffer.from(P.multiply(BigInt('0x' + Buffer.from(sk).toString('hex'))).toRawBytes(true)).toString('hex');
  return { round, signature: sig, randomness: Buffer.from(sha256(Buffer.from(sig, 'hex'))).toString('hex') };
}
const fakeClient = {
  options: { disableBeaconVerification: false, noCache: false },
  chain: () => ({ baseUrl: '', info: async () => FAKE }),
  get: async (r) => beaconFor(r),
  latest: async () => { throw new Error('x'); },
};

console.log('timelock');
{
  const now = Math.floor(Date.now() / 1000);
  // seal for a round already in the fake network's past so we can open it now
  const s = await sealLetter('سلام آینده 🌙\nline two <b>&</b>', now - 60, offlineClient(FAKE));
  const o = await openLetter(s.ciphertext, fakeClient);
  assert.equal(o.text, 'سلام آینده 🌙\nline two <b>&</b>');
  assert.equal(commitmentOf(o.salt, o.text), s.commitment);
  ok('encrypt with public key only, decrypt with beacon, commitment matches');

  const fut = await sealLetter('not yet', now + 3600, offlineClient(FAKE));
  await assert.rejects(openLetter(fut.ciphertext, fakeClient), /too early/);
  ok('refuses to decrypt before the round');

  const wrongKey = { ...fakeClient, chain: () => ({ info: async () => ({ ...FAKE, public_key: QUICKNET.public_key }) }) };
  await assert.rejects(openLetter(s.ciphertext, wrongKey));
  ok('a beacon that does not verify against the key is rejected');

  // real quicknet: encryption works offline with the real public key
  const q = await sealLetter('real network', now + 86400 * 365);
  assert.ok(ethers.toUtf8String(q.ciphertext).startsWith('-----BEGIN AGE ENCRYPTED FILE-----'));
  assert.equal(q.round, roundAtTime(now + 86400 * 365));
  assert.ok(timeOfRound(q.round) >= now + 86400 * 365 && timeOfRound(q.round) < now + 86400 * 365 + 3);
  ok(`quicknet ciphertext built offline (${ethers.dataLength(q.ciphertext)} bytes)`);
}

console.log('contract');
const art = JSON.parse(fs.readFileSync(new URL('../build/FutureWall.json', import.meta.url)));
const provider = new ethers.BrowserProvider(hre.network.provider);
const [ownerS, alice, bob] = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i)));
const FEE = ethers.parseEther('2');
const factory = new ethers.ContractFactory(art.abi, art.bytecode, ownerS);
const fw = await factory.deploy(await bob.getAddress(), FEE); // bob = fee owner (like his main wallet)
await fw.waitForDeployment();
const deployRcpt = await fw.deploymentTransaction().wait();
ok(`deployed, gas ${deployRcpt.gasUsed}`);
assert.equal(await fw.owner(), await bob.getAddress());
ok('ownership goes straight to the given address, not the deployer');

const chainNow = async () => parseInt((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp);
const mine = async (secs) => { await provider.send('evm_increaseTime', [secs]); await provider.send('evm_mine', []); };

const t0 = await chainNow();
const text = 'To whoever reads this in 2030:\n"<script>alert(1)</script>" & \u0001 — درود ✨';
const unlock = t0 + 2 * 86400;
const s1 = await sealLetter(text, unlock);
const A = fw.connect(alice);

await rejects(A.seal(s1.round, s1.commitment, s1.ciphertext, { value: FEE - 1n }), 'FeeTooLow', 'fee too low reverts');
await rejects(A.seal(roundAtTime(t0 + 600), s1.commitment, s1.ciphertext, { value: FEE }), 'BadRound', 'less than an hour reverts');
await rejects(A.seal(roundAtTime(t0 + 101 * 365 * 86400), s1.commitment, s1.ciphertext, { value: FEE }), 'BadRound', 'over 100 years reverts');
await rejects(A.seal(s1.round, s1.commitment, '0x' + '00'.repeat(6001), { value: FEE }), 'TooLong', 'oversized ciphertext reverts');

const tx = await A.seal(s1.round, s1.commitment, s1.ciphertext, { value: FEE });
const rc = await tx.wait();
const ev = rc.logs.map((l) => { try { return fw.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'Sealed');
assert.equal(ev.args.id, 1n);
assert.equal(await fw.ciphertextOf(1), s1.ciphertext);
assert.equal(await fw.lettersForYear(new Date(timeOfRound(s1.round) * 1000).getUTCFullYear()), 1n);
assert.equal(await fw.ownerOf(1), await alice.getAddress());
ok(`seal mints NFT #1, stores the ciphertext and counts the year, gas ${rc.gasUsed} for ${ethers.dataLength(s1.ciphertext)} bytes`);

const parseUri = async (id) => {
  const uri = await fw.tokenURI(id);
  const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
  const svg = Buffer.from(json.image.split(',')[1], 'base64').toString('utf8');
  const errs = [];
  const doc = new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') errs.push(msg); } }).parseFromString(svg, 'image/svg+xml');
  assert.deepEqual(errs, [], 'svg must be well-formed XML');
  assert.ok(![...svg].some((ch) => ch.charCodeAt(0) < 0x20 && ch !== '\n' && ch !== '\t'), 'no control or NUL characters in svg');
  new Resvg(svg); // strict XML parser used by many renderers
  assert.equal(doc.getElementsByTagName('script').length, 0, 'no script element');
  return { json, svg };
};
let m = await parseUri(1);
const d = new Date(timeOfRound(s1.round) * 1000).toISOString().slice(0, 10);
assert.ok(m.json.description.includes(d), 'date in description');
assert.equal(m.json.attributes.find((a) => a.trait_type === 'Status').value, 'Sealed');
assert.equal(m.json.attributes.find((a) => a.trait_type === 'Seal').value, 'Genesis');
assert.ok(!m.svg.includes('2030:'), 'letter text not in sealed art');
fs.mkdirSync('build/preview', { recursive: true }); fs.writeFileSync('build/preview/sealed.svg', m.svg);
ok(`sealed metadata valid, date ${d}, Genesis seal, no text leaked`);

await rejects(fw.connect(bob).open(1, s1.salt, text), 'NotYet', 'cannot open before unlock time');
await mine(3 * 86400);
m = await parseUri(1);
assert.equal(m.json.attributes.find((a) => a.trait_type === 'Status').value, 'Ready');
ok('status flips to Ready after the date');
await rejects(fw.connect(bob).open(1, s1.salt, text + 'x'), 'WrongText', 'a forged text is rejected');
await rejects(fw.connect(bob).open(1, ethers.ZeroHash, text), 'WrongText', 'a wrong salt is rejected');
const orc = await (await fw.connect(bob).open(1, s1.salt, text, { gasLimit: 600000 })).wait();
console.log('    note: explicit gas limit, hardhat estimateGas misreads time after evm_increaseTime');
ok(`anyone can open with the real text, gas ${orc.gasUsed}`);
await rejects(fw.connect(bob).open.staticCall(1, s1.salt, text), 'AlreadyOpen', 'cannot open twice');
const [l, stored] = await fw.letter(1);
assert.equal(stored, text); assert.equal(l.revealed, true);
m = await parseUri(1);
assert.ok(m.svg.includes('درود ✨'), 'persian text rendered');
assert.ok(m.svg.includes('&lt;script&gt;') && m.svg.includes('&amp;') && m.svg.includes('&#34;'), 'escaped');
fs.writeFileSync('build/preview/opened.svg', m.svg);
ok('opened art shows the letter, escaped, well-formed, script-free');

// New Year seal + date maths across many timestamps
for (let i = 0; i < 1000; i++) await (await fw.connect(alice).seal(roundAtTime((await chainNow()) + 7200), s1.commitment, '0x01', { value: FEE, gasLimit: 300000 })).wait();
const ny = Date.UTC(2031, 0, 1) / 1000;
const nyl = await sealLetter('happy new year', ny);
await (await A.seal(nyl.round, nyl.commitment, nyl.ciphertext, { value: FEE, gasLimit: 1500000 })).wait();
const nyId = await fw.totalSealed();
assert.ok(nyId > 1000n);
m = await parseUri(nyId);
assert.equal(m.json.attributes.find((a) => a.trait_type === 'Seal').value, 'New Year');
assert.ok(m.json.description.includes('2031-01-01'));
assert.equal(await fw.lettersForYear(2031), 1n);
fs.writeFileSync('build/preview/newyear.svg', m.svg);
ok(`token #${nyId}: past Genesis supply, New Year seal for 2031-01-01`);

const art2 = { ...art };
for (const ts of [0, 951782400, 1709164800, 4102444800, 4107542400, 1692803367 + 3 * 123456789]) {
  const r = Math.max(1, roundAtTime(ts));
  // roundTime is pure; compare the solidity date to JS for the round's time
  const t = Number(await fw.roundTime(r));
  assert.equal(t, timeOfRound(r));
}
ok('on-chain roundTime matches the website for many rounds');

// owner money
const rawBal = async (a) => BigInt(await provider.send('eth_getBalance', [a, 'latest']));
const held = await rawBal(await fw.getAddress());
assert.equal(held, FEE * 1002n, 'contract holds every fee');
const bal0 = await rawBal(await bob.getAddress());
await rejects(A.withdraw.staticCall(), 'OwnableUnauthorizedAccount', 'only owner can withdraw');
await rejects(A.setFee.staticCall(0), 'OwnableUnauthorizedAccount', 'only owner can change the fee');
const wrc = await (await fw.connect(bob).withdraw({ gasLimit: 100000 })).wait();
const bal1 = await rawBal(await bob.getAddress());
assert.equal(bal1 - bal0 + wrc.gasUsed * wrc.gasPrice, held);
assert.equal(await rawBal(await fw.getAddress()), 0n);
ok('withdraw sends every fee to the owner wallet');
await (await fw.connect(bob).setFee(ethers.parseEther('5'), { gasLimit: 100000 })).wait();
assert.equal(await fw.fee(), ethers.parseEther('5'));
ok('owner can change the fee');

// date check vs JS over random timestamps via a sealed letter's metadata
for (let k = 0; k < 25; k++) {
  const ts = (await chainNow()) + 3600 + Math.floor(Math.random() * 99 * 365 * 86400);
  const sl = await sealLetter('d', ts);
  await (await A.seal(sl.round, sl.commitment, '0x01', { value: ethers.parseEther('5'), gasLimit: 300000 })).wait();
  const mm = await parseUri(await fw.totalSealed());
  assert.ok(mm.json.description.includes(new Date(timeOfRound(sl.round) * 1000).toISOString().slice(0, 10)));
}
ok('on-chain calendar matches JS for 25 random dates up to 99 years out');

console.log(`\n${passed} checks passed`);
