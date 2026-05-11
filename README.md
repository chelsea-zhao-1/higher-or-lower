# Higher or Lower

An on-chain card game. Where players deposit USDC on Circle Arc Testnet, bet, guess higher or lower on as many rounds as they want, and cash out. All verified by the smart contract.

**Live contract:** `0xB0A622de5A303ef6488A676884e8468e0CE4C6d2` on Arc Testnet (chain ID 5042002)

---

# The Problem

In traditional betting there is a trust problem. Casinos and online platforms control the outcome and you have to trust them. There is no way to verify whether a result was changed after you placed your guess and the money isn't directly in your control.

Going on-chain can fix the trust problem but it is also vunerable to front running as everything is public. For example, if the contract picks each card the moment you guess, a miner can see your transaction in the mempool, know the next card, and front-run or suppress it.

This game eliminates both issues. The card sequence is locked in cryptographically before play starts, and outcomes are verified on-chain when you cashout your earnings.

---

## What I Built

The challenge was making something that is:

- **Trustless** — neither the house nor the player can manipulate the cards
- **Gas-efficient** — gameplay doesn't require an on chain transaction per round played
- **Financially sound** — the house can always pay out; players can always recover funds

The solution uses a commit/reveal randomness idea with EIP-712 session keys and full on-chain verification at cashout.

### House model

I deployed the contract and funded it with circle's faucet USDC as the house bankroll. Players deposit to bet against that bankroll. The contract enforces a 2× check at deposit time. So, if the house balance can't cover a player win then no new sessions can open. When players lose rounds, the USDC stays in the contract.

---

## How to Play

1. **Connect** — MetaMask on Arc Testnet.
2. **Fund your wallet** - Go to https://faucet.circle.com/ and deposit USDC.
3. **Deposit** — Choose a USDC amount and session duration (1h / 4h / 24h). Confirm on-chain tx to store commitment.
3. **Authorize** — Sign a gasless EIP-712 message to lock in cashout rights. No gas.
4. **Play** — Entirely off-chain. Guess higher or lower each round; wins add to your balance, losses subtract. Tie: no change. Play as many rounds as you want within your session window.
5. **Cash out** — Last tx on-chain where contract verifies every round and pays out to your connected wallet.

### Card rankings

Cards rank from **1 (Ace, lowest) to 13 (King, highest)**:

| Value | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|-------|---|---|---|---|---|---|---|---|---|----|----|----|----|
| Label | A | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | J  | Q  | K  |

Suits are cosmetic so outcomes are determined by rank only.

### Session expiry

If a session expires before cashout, the player calls `refundExpired` to recover their original deposit. The frontend detects stale sessions from storage and initiates the refund option automatically.

---

## Security

### Commit / reveal randomness

The full card sequence is locked in before the game starts:

1. **Commit (at deposit)** — The frontend generates a random 256-bit `masterSecret` and sends only its hash to the contract:
   ```
   commitment = keccak256(masterSecret)
   ```
   The secret stays in the browser until cashout.

2. **Derive (during play)** — Each card is derived deterministically:
   ```
   card = keccak256(masterSecret, roundNum, nonce) % 13 + 1
   ```
   `nonce = 0` → current card. `nonce = 1` → next card. The full sequence is fixed at deposit time so neither party can alter it.

3. **Reveal (at cashout)** — The player submits `masterSecret`. The contract verifies the hash matches, re-derives every card, replays every round, recomputes the final balance, and rejects if anything doesn't match.

### EIP-712 session authorization

Instead of a transaction per round, the player signs one off-chain message at session creation:

```
Session(
  uint256 sessionId,
  address player,
  uint256 depositAmount,
  uint256 expiry,
  bytes32 commitment
)
```

The signature is bound to the contract address, so it can't be replayed on another contract or network.

### On-chain replay verification

The contract never trusts the frontend's reported outcomes. At cashout it will:

1. Re-derives every card from `masterSecret`.
2. Re-evaluates every guess.
3. Recomputes the running balance from the deposit amount.
4. Rejects if the result doesn't match the submitted history.

A player cannot change wins, inflate bets, or omit losing rounds.

---

## Thoughts

**VRF vs commit/reveal.** Chainlink VRF would give provably random cards from an external oracle, but it requires an on-chain write per round which was too slow and too expensive... OD for this higher and lower card game. Commit/reveal locks the full card sequence on-chain before play starts. It's trustless and costs nothing extra per round. The tradeoff is the randomness quality depends on the browser's RNG rather than an external oracle.

**EIP-712 solved the transaction problem.** In my first design each round needed two transactions. So for 5 rounds you would confirm tx 10 times. The UX was bad. Session signatures let players authorize an entire session upfront so all rounds are able to happen off-chain, and one final transaction settles everything.

---

## Running It Yourself

### Prerequisites

- [Foundry](https://getfoundry.sh)
- Node.js v18+
- A wallet funded with Arc Testnet USDC

### 1. Clone & install

```bash
git clone https://github.com/chelsea-zhao-1/higher-or-lower.git
cd "higher-or-lower"

cd contracts && npm install && forge build
cd ../frontend && npm install
```

### 2. Configure environment

Create `contracts/.env`:

```env
PRIVATE_KEY=0xYOUR_DEPLOYER_KEY
ARC_TESTNET_RPC=https://rpc.testnet.arc.network
```

### 3. Deploy the contract

```bash
cd contracts
forge script script/DeploySessionGame.s.sol --rpc-url arc_testnet --broadcast
```

Update `SESSION_GAME_ADDRESS` in `frontend/src/constants/contract.js`, then seed the house bankroll:

```bash
cast send <CONTRACT_ADDRESS> "depositHouse()" --value <AMOUNT_IN_WEI> \
  --rpc-url https://rpc.testnet.arc.network --private-key $PRIVATE_KEY
```

The house balance must be at least 2× any player's deposit for sessions to open.

### 4. Run the frontend

```bash
cd frontend
npm run dev       # http://localhost:5173
npm run build
npx vercel --prod
```

---

## Tech Stack

- **Contracts:** Solidity 0.8.x + Foundry + OpenZeppelin (EIP-712, ReentrancyGuard, Ownable)
- **Frontend:** React 18 + Vite + ethers.js v6
- **Network:** Circle Arc Testnet (chain ID 5042002)
