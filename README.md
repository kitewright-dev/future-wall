# Future Wall

live at **https://futurewall.site**

You write a letter and pick a date. The letter gets encrypted in your browser so it can only be opened after that date, and it's stored in a contract on Polygon. Nobody can read it early. That includes me.

When the date comes it opens for everyone, and the envelope NFT you got when you sealed it turns into the letter itself.

## how the lock works

The letter is encrypted with [drand timelock encryption](https://github.com/drand/tlock-js). drand is a randomness beacon run by a bunch of independent orgs (League of Entropy), and every 3 seconds it publishes a signature for a new round. Your letter is encrypted to one future round. The key for that round doesn't exist until the network publishes it, so there is no back door, no admin key, nothing to hack.

Encrypting only needs drand's public key, which is baked into the site, so sealing a letter works even if drand's servers are unreachable. Opening needs the round signature, which the site fetches from public drand relays and checks against that same key.

To stop someone from putting fake text on the wall, the contract keeps a hash of the real letter (plus a random salt that's inside the encrypted part). Anyone can open a letter once its time has passed, but the contract only accepts the exact original text.

## the contract

`contracts/FutureWall.sol`, solidity 0.8.28, OpenZeppelin ERC721.

- `seal(round, commitment, ciphertext)` pays the fee, stores the encrypted letter and mints the envelope. The date has to be between 1 hour and 100 years away.
- `open(id, salt, text)` works after the date, once, for anyone.
- `tokenURI` draws the envelope (or the opened letter) as SVG fully on chain. No IPFS, no server.
- first 1000 letters get a gold Genesis seal, letters set for 1 January get a blue one.
- the owner can change the fee and withdraw fees. The owner can't touch letters.

Polygon contract: [`0xDDD01055E5A4F8A65FD691B3AD175B77f5C3C853`](https://polygonscan.com/address/0xDDD01055E5A4F8A65FD691B3AD175B77f5C3C853)

`owner.html` is a small page for the owner wallet: withdraw fees, change the fee, hand ownership to another address.

## running it

```
npm ci
npm run compile
npm test           # contract, timelock and wallet checks
npm run build      # outputs the site into site/
```

The tests run the contract on a local chain and do a full encrypt/decrypt round trip against a locally generated drand style key, same scheme as the real network. There's also a check that the art is valid XML, has no script in it and escapes whatever people write.

## wallets

In a normal mobile browser there's no wallet, so the site offers to reopen itself inside MetaMask, Trust Wallet or Coinbase Wallet. Inside a wallet browser (or with a desktop extension) it just connects, and it switches you to Polygon or adds it if your wallet doesn't have it yet.

## caveats

Letters are public after they open, so don't seal secrets. If drand ever shut down for good, sealed letters would stay locked. Anything written on chain stays there, the site can hide a letter but can't delete it.

MIT licence.
