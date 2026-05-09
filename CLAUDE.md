# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

On-chain "Higher or Lower" card game deployed on Circle Arc Testnet. Player bets native USDC against the house smart contract. Cards drawn via commit/reveal scheme. Sessions use EIP-712 authorized ephemeral wallets so gameplay requires zero MetaMask prompts after the initial setup.

**Deployed contract:** `0xF525Ed0a987A1aBD5FE9DBC22269C44Db66e1B8B`

## Commands

### Contracts (Foundry — run from `contracts/`)

```bash
forge build                          # compile
forge test                           # run all tests
forge test -vv                       # verbose
forge test --match-test <name>       # single test

# Deploy to Arc Testnet (requires .env)
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
```

### Frontend (run from `frontend/`)

```bash
npm run dev      # Vite dev server → http://localhost:5173
npm run build    # production build
```

## Environment (`contracts/.env`)

```
PRIVATE_KEY=0x...
ARC_TESTNET_RPC=https://rpc.testnet.arc.network
```

After deploying, paste the contract address into `frontend/src/constants/contract.js`.

## Architecture

### Smart Contract (`contracts/src/HigherOrLower.sol`)

Inherits OpenZeppelin `Ownable`. No Chainlink VRF — randomness via commit/reveal.

**Game lifecycle (2 transactions):**
1. `startGame(bytes32 commitment)` payable → stores commitment + `commitBlock`, emits `GameStarted` → `WAITING_REVEAL`
2. `revealAndGuess(gameId, uint256 secret, bool higher)` → verifies commitment, derives both cards, resolves immediately, emits `GameResolved` → `COMPLETE`

**Card derivation:**
```
currentCard = keccak256(secret, blockhash(commitBlock), uint8(0)) % 13 + 1
nextCard    = keccak256(secret, blockhash(block.number - 1), uint8(1)) % 13 + 1
```
Ace = 1, King = 13. Reveal must happen within 256 blocks of commit (~50 min on Arc).

**Payout (pull pattern):** Win → `pendingWithdrawals += betAmt * 2`. Tie → `betAmt` returned. Lose → bet stays in house. Player calls `claimWinnings()` to withdraw.

**Safety:** `refundStuckGame()` refunds bet if player never reveals within 2 hours or 256 blocks.

### Frontend (`frontend/src/`)

**Hooks:**
- `hooks/useGame.js` — contract interaction. Accepts `session` object; uses session wallet as signer when active, MetaMask signer otherwise. Exposes `connect`, `startGame`, `submitGuess`, `claimWinnings`, `endSession`, `reset`.
- `hooks/useSessionKey.js` — session lifecycle. `initSession` generates a random wallet, signs EIP-712 auth payload with MetaMask (free), AES-256-GCM encrypts the private key using `keccak256(signature)` as the key, persists encrypted blob to `sessionStorage`. `recoverSession` re-signs the same payload to re-derive the decryption key. `endSession` auto-claims winnings and sweeps balance back to MetaMask wallet.

**Components:**
- `components/ConnectWallet.jsx` — three-screen flow: (1) connect MetaMask, (2) session setup (spend limit + duration → EIP-712 sign → fund session wallet), (3) recover existing session.
- `components/GameBoard.jsx` — renders all game states. Shows session bar (time remaining, spend limit). Disables betting if session expired or spend limit reached. "End Session" auto-sweeps funds.
- `constants/contract.js` — ABI, deployed address, chain config.

**Session key flow:**
```
MetaMask signs EIP-712 (free, no gas)
  → encryptionKey = keccak256(signature)
  → sessionWallet = Wallet.createRandom()
  → sessionStorage: { encrypted(privateKey, encryptionKey), authPayload }

MetaMask funds session wallet (1 payable tx)
  → all game txs auto-signed by sessionWallet via JsonRpcProvider
  → zero MetaMask prompts during gameplay

End session:
  → sessionWallet.claimWinnings() if pending
  → sessionWallet sends balance → MetaMask address
  → sessionStorage cleared
```

**EIP-712 authorization payload:**
```js
{
  sessionKey:     "0x...",          // session wallet address
  expiresAt:      unix_timestamp,   // 15min / 1hr / 2hr
  maxSpend:       "5000...",        // in wei (18 decimals)
  allowedMethods: ["startGame", "revealAndGuess", "claimWinnings"],
  nonce:          Date.now(),
}
// domain: { name, version: "1", chainId: 5042002, verifyingContract }
```

Uses `ethers.js v6`. All amounts in 18 decimals (Arc native USDC behaves like ETH at the EVM level despite displaying as USDC).

### Circle Arc Testnet
- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com` (select "Arc Testnet")
- Native token: USDC — 18 decimals at EVM level, displays as USDC in wallets

### Dependencies
- `contracts/node_modules/@openzeppelin/contracts@4.9.6` — Ownable
- `foundry.toml` remapping: `@openzeppelin/contracts/` → `node_modules/@openzeppelin/contracts/`
- `frontend/node_modules/ethers` — v6
