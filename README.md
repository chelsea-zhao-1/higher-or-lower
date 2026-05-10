# Higher or Lower

An on-chain card guessing game deployed on [Arc Testnet](https://arc.network). Guess whether the next card is higher or lower than the current one. Deposit once, play as many rounds as you want, cash out whenever — only two blockchain transactions required for an entire session.

---

## Gameplay

### How a Session Works

1. **Deposit** — Enter an amount of USDC and a session duration (1h, 4h, or 24h). This sends a single transaction to the contract and locks in your stake.
2. **Authorize** — Sign a gasless EIP-712 message in MetaMask. This signature authorizes your eventual cashout without any additional on-chain cost.
3. **Play rounds** — Each round is entirely off-chain:
   - A card is revealed to you.
   - You bet some amount of your balance and guess: **Higher** or **Lower**.
   - The next card is revealed. If you guessed correctly, your bet is added to your balance. If not, it's subtracted (your balance is always floored at zero — you can never go negative).
   - Ties leave your balance unchanged.
   - Repeat as many rounds as you want within your session window.
4. **Cash out** — Submit one final transaction. The contract verifies your entire session history and pays out your final balance.

**Total MetaMask interactions for any number of rounds: 2 transactions + 1 free signature.**

### Card Rankings

Cards rank from **1 (lowest) to 13 (highest)**:

| Value | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|-------|---|---|---|---|---|---|---|---|---|----|----|----|----|
| Label | A | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | J  | Q  | K  |

Ace is the lowest card. King is the highest. There are no jokers.

### Suits Are Cosmetic

The four suits (♠ ♥ ♦ ♣) are **display-only** and have no effect on game logic. Every outcome — win, loss, tie — is determined solely by the numeric rank of the current and next card. A 7♠ and a 7♥ are identical for gameplay purposes.

---

## Security & Trustlessness

### The Problem with On-Chain Randomness

A naive on-chain card game runs into a fundamental problem: if the contract picks your next card at the moment you guess, a miner or validator could see your transaction in the mempool, know the next card, and front-run or suppress your transaction. Alternatively, if the random card is chosen from block data, the house could theoretically influence block production.

This game eliminates both attack vectors.

### Commit / Reveal Randomness

Before any card is shown, the **entire sequence of cards for the session is locked in** using a cryptographic commitment scheme:

1. **Commit (deposit time):** The frontend generates a random 256-bit `masterSecret`. It hashes it:
   ```
   commitment = keccak256(masterSecret)
   ```
   Only the commitment (a hash) is sent to the contract. The secret itself stays in the browser.

2. **Derive (during play):** Every card is derived deterministically from the secret:
   ```
   card = keccak256(masterSecret, roundNum, nonce) % 13 + 1
   ```
   `nonce = 0` gives the current card, `nonce = 1` gives the next card. This means the full deck sequence is fixed the moment you deposit — neither the player nor the contract can alter it.

3. **Reveal (cashout):** The player submits `masterSecret` to the contract. The contract:
   - Verifies `keccak256(masterSecret) == stored commitment` — proving the secret was never changed.
   - Re-derives every card independently using the same formula.
   - Replays every round to confirm the reported outcomes match the on-chain derivation.
   - If anything doesn't match, the session is flagged and the deposit is frozen.

**Neither party can cheat the randomness:** The player commits to the card sequence before seeing any cards. The contract derives the same sequence and verifies every outcome independently at cashout.

### EIP-712 Session Authorization

Rather than requiring a transaction to authorize each round, the player signs a structured off-chain message once at session creation:

```
Session(
  uint256 sessionId,
  address player,
  uint256 depositAmount,
  uint256 expiry,
  bytes32 commitment
)
```

This signature is domain-separated (tied to the specific contract address and chain ID), so it cannot be replayed on a different contract or network. The contract verifies the signature at cashout — if it doesn't match the session's player address, the cashout is rejected.

This means:
- No one else can cash out your session.
- The session parameters (amount, expiry, commitment) are cryptographically locked to your wallet.
- You pay no gas for authorization.

### On-Chain Replay Verification

The contract does not trust the frontend's reported outcomes. At cashout, it independently:

1. Re-derives `currentCard` and `nextCard` for every round using `masterSecret`.
2. Re-evaluates whether each guess was correct.
3. Re-computes the running balance from scratch.
4. Compares the final balance against the player's submitted round history.

If the player reports a win that was actually a loss (or inflates a bet amount), the contract catches it. The player cannot report false results.

### House Solvency Check

When you deposit, the contract checks that the house balance is at least `2 × depositAmount`. This guarantees the contract can always pay out even if every round is a win. You cannot open a session if the contract lacks the funds to honor it.

### Reentrancy Protection

The `cashOut` function is protected by OpenZeppelin's `nonReentrant` guard, preventing any reentrancy attack during the ETH transfer to the player.

### Summary

| Guarantee | Mechanism |
|-----------|-----------|
| Cards can't be manipulated after deposit | Commit/reveal — secret hashed on-chain before any card is shown |
| Player can't fake round outcomes | Contract re-derives all cards and replays all rounds on-chain at cashout |
| Only the player can cash out | EIP-712 signature tied to player's wallet address |
| House can always pay | Solvency check enforced at deposit time |
| No reentrancy exploits | `nonReentrant` modifier on cashout |
| No trusted intermediary | All verification is on-chain; no server or oracle required |

---

## Tech Stack

- **Contracts:** Solidity + [Foundry](https://getfoundry.sh)
- **Frontend:** React + [ethers.js v6](https://docs.ethers.org/v6/)
- **Network:** Arc Testnet (chainId 5042002)
- **Standards:** EIP-712 typed structured data signing, OpenZeppelin ReentrancyGuard
