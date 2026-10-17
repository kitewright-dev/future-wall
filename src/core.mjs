// Shared logic used by the website and by the tests.
import { timelockEncrypt, timelockDecrypt, HttpChainClient, Buffer } from 'tlock-js';
import { solidityPackedKeccak256, hexlify, randomBytes, toUtf8Bytes, toUtf8String } from 'ethers';

export const QUICKNET = {
  public_key: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  period: 3,
  genesis_time: 1692803367,
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
  schemeID: 'bls-unchained-g1-rfc9380',
  metadata: { beaconID: 'quicknet' },
};
export const RELAYS = [
  'https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh', 'https://drand.cloudflare.com',
];
export const MAX_TEXT = 1200;

// Encryption needs only the network's public key, so sealing works offline.
export function offlineClient(info = QUICKNET) {
  return {
    options: { disableBeaconVerification: false, noCache: false },
    chain: () => ({ baseUrl: '', info: async () => info }),
    get: async () => { throw new Error('offline'); },
    latest: async () => { throw new Error('offline'); },
  };
}

// Tries each public relay until one answers; beacons are still verified
// against the hard-coded quicknet public key, so a relay cannot lie.
export async function fetchingClient(info = QUICKNET, relays = RELAYS) {
  return {
    options: { disableBeaconVerification: false, noCache: false, chainVerificationParams: { chainHash: info.hash, publicKey: info.public_key } },
    chain: () => ({ baseUrl: relays[0] + '/' + info.hash, info: async () => info }),
    latest: async () => { throw new Error('unused'); },
    get: async (round) => {
      let last;
      for (const r of relays) {
        try {
          const res = await fetch(`${r}/${info.hash}/public/${round}`);
          if (res.ok) return await res.json();
          last = new Error('relay ' + r + ' ' + res.status);
        } catch (e) { last = e; }
      }
      throw last || new Error('no relay answered');
    },
  };
}

export const roundAtTime = (unixSeconds, info = QUICKNET) =>
  Math.ceil((unixSeconds - info.genesis_time) / info.period) + 1;
export const timeOfRound = (round, info = QUICKNET) => info.genesis_time + (round - 1) * info.period;

export const commitmentOf = (saltHex, text) => solidityPackedKeccak256(['bytes32', 'string'], [saltHex, text]);

export async function sealLetter(text, unlockUnix, client = offlineClient()) {
  if (!text.trim()) throw new Error('empty');
  if (toUtf8Bytes(text).length > MAX_TEXT) throw new Error('too long');
  const info = await client.chain().info();
  const round = roundAtTime(unlockUnix, info);
  const salt = hexlify(randomBytes(32));
  const payload = Buffer.from(JSON.stringify({ v: 1, t: text, s: salt }), 'utf8');
  const armored = await timelockEncrypt(round, payload, client);
  return { round, salt, commitment: commitmentOf(salt, text), ciphertext: hexlify(toUtf8Bytes(armored)) };
}

export async function openLetter(ciphertextHex, client) {
  const armored = toUtf8String(ciphertextHex);
  const plain = await timelockDecrypt(armored, client);
  const { t, s } = JSON.parse(Buffer.from(plain).toString('utf8'));
  return { text: t, salt: s };
}
