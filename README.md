# Higher or Lower

An on-chain card game. Players deposit USDC on Circle Arc Testnet, bet and guess higher or lower on as many rounds as they want, and cash out. All verified by the smart contract, no middleman. Unlimited rounds, two transactions.

**Live contract:** `0xB0A622de5A303ef6488A676884e8468e0CE4C6d2` on Arc Testnet (chain ID 5042002)

---

# The Problem

Traditional betting has a trust problem. Casinos and online platforms control the outcome — you're taking their word for it. Online platforms add fees on top, and you have no way to verify whether a result was changed after you placed your guess.

Going on-chain fixes the trust problem but creates a new one: if the contract picks each card the moment you guess, a miner can see your transaction in the mempool, know the next card, and front-run or suppress it. The house edge becomes an attack vector.

This game eliminates both. The card sequence is locked in cryptographically before play starts, and every outcome is verified on-chain at cashout.

---

## What I Built

The challenge was making a game that is simultaneously:

- **Trustless** — neither the house nor the player can manipulate the cards
- **Gas-efficient** — gameplay doesn't require an on chain transaction per round
- **Financially sound** — the house can always pay out; players can always recover funds

The solution combines a commit/reveal randomness scheme with EIP-712 session keys and full on-chain replay verification at cashout.

### House model

I deploy the contract and seed it with USDC as the house bankroll. Players deposit to bet against that bankroll. The contract enforces a 2× check at deposit time — if my house balance can't cover a full-win session, no new sessions can open. When players lose rounds, the USDC stays in the contract. I can withdraw profits via `withdrawHouse()` at any time.

---

## How to Play

1. **Connect** — MetaMask on Arc Testnet.
2. **Deposit** — Choose a USDC amount and session duration (1h / 4h / 24h). One on-chain transaction.
3. **Authorize** — Sign a gasless EIP-712 message to lock in cashout rights. No gas.
4. **Play** — Entirely off-chain. Guess higher or lower each round; wins add to your balance, losses subtract. Tie: no change. Play as many rounds as you want within your session window.
5. **Cash out** — One final transaction. The contract independently verifies every round and pays out.

**Two transactions + one signature for an unlimited number of rounds.**

### Card rankings

Cards rank from **1 (Ace, lowest) to 13 (King, highest)**:

| Value | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|-------|---|---|---|---|---|---|---|---|---|----|----|----|----|
| Label | A | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | J  | Q  | K  |

Suits are cosmetic — outcomes are determined by rank only.

### Session expiry

If a session expires before cashout, the player calls `refundExpired` to recover their original deposit. The frontend detects stale sessions from localStorage and surfaces the refund option automatically.

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
   `nonce = 0` → current card. `nonce = 1` → next card. The full sequence is fixed at deposit time — neither party can alter it.

3. **Reveal (at cashout)** — The player submits `masterSecret`. The contract verifies the hash matches, re-derives every card, replays every round, recomputes the final balance, and rejects if anything doesn't match.

### EIP-712 session authorization

Instead of a transaction per round, the player signs one structured off-chain message at session creation:

```
Session(
  uint256 sessionId,
  address player,
  uint256 depositAmount,
  uint256 expiry,
  bytes32 commitment
)
```

The signature is domain-separated (bound to the contract address and chain ID) — it can't be replayed on another contract or network. The contract recovers the signer at cashout; if it doesn't match the session's player address, the cashout is rejected.

- No one else can cash out your session.
- All session parameters are cryptographically bound to your wallet.
- Zero gas cost for authorization.

### On-chain replay verification

The contract never trusts the frontend's reported outcomes. At cashout it independently:

1. Re-derives every card from `masterSecret`.
2. Re-evaluates every guess.
3. Recomputes the running balance from the deposit amount.
4. Rejects if the result doesn't match the submitted history.

A player cannot fabricate wins, inflate bets, or omit losing rounds.

---

## Learnings

**Sessions over single rounds.** The first version was one deposit, one round, done. It worked but the UX was terrible and gas was too much per play. Then I redesiged it around sessions — deposit once, play unlimited rounds off-chain, cash out once.

**VRF vs commit/reveal.** Chainlink VRF would give provably random cards from an external oracle, but it requires an on-chain write per round — too slow and too expensive. Commit/reveal locks the full card sequence on-chain before play starts. It's trustless and costs nothing extra per round. The tradeoff is the randomness quality depends on the browser's RNG rather than an external oracle.

**EIP-712 killed the transaction problem.** Early on each round needed two transactions. Unusable. Session signatures let players authorize an entire session upfront — all rounds happen off-chain, and one final transaction settles everything.

**Tooling matters.** Started on Base Sepolia. Slow RPCs, bad block explorer. Moved to Circle Arc Testnet and the development loop got noticeably faster.

**Trustless means no escape hatch.** Every guarantee has to be provable from the contract alone — no admin override, no support ticket. Designing around that constraint changed how I think about building software.

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
