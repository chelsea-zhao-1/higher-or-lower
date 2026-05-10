# Plan: Session-Based Card Game (feature/lowertx)

## Context
The current `HigherOrLower.sol` requires 2 MetaMask transactions per game round (startGame + revealAndGuess) plus a third for claimWinnings. Goal: reduce to **2 transactions per entire session** (deposit + cashout), with all individual rounds happening fully off-chain. Card randomness is preserved using a single master commit/reveal scaled to session level — same security tradeoff as the existing testnet implementation.

---

## MetaMask Interactions Per Session (down from 2-3 per round)
1. `deposit()` tx — sends ETH, commits `keccak256(masterSecret)`, sets maxBetPerRound + expiry
2. `eth_signTypedData` (EIP-712, no tx) — user signs session authorization; stored in browser, submitted at cashout
3. `cashOut()` tx — submits masterSecret + full round history + session sig; contract verifies everything on-chain

**Off-chain round loop (zero MetaMask prompts):**
- User picks bet amount (≤ maxBetPerRound, changeable each round)
- Frontend derives cards: `keccak256(masterSecret, roundNum, nonce) % 13 + 1`
- User guesses higher/lower
- Result resolved locally, appended to `roundHistory[]`
- Running off-chain balance updated

---

## Card Derivation
Reuses the existing formula from `frontend/src/hooks/useGame.js` (`deriveCard()`), adapted to session scope:
```
currentCard = keccak256(abi.encodePacked(masterSecret, roundNum, 0)) % 13 + 1
nextCard    = keccak256(abi.encodePacked(masterSecret, roundNum, 1)) % 13 + 1
```
Both computed off-chain during play. Verified on-chain at cashout using the revealed `masterSecret`.

---

## Step 1 — New Contract: `contracts/src/SessionGame.sol`

### Data Structures
```solidity
struct Session {
    address player;
    uint256 depositAmount;     // ETH locked
    uint256 maxBetPerRound;    // per-round cap
    uint256 expiry;            // unix timestamp
    bytes32 commitment;        // keccak256(masterSecret)
    SessionStatus status;      // ACTIVE | CASHED_OUT | FLAGGED
}

struct RoundResult {
    uint256 roundNum;
    uint256 betAmount;
    bool guessHigher;
    // contract re-derives cards and result; player doesn't self-report outcome
}

enum SessionStatus { ACTIVE, CASHED_OUT, FLAGGED }
```

### EIP-712 Domain + Session Type
```
EIP712Domain(name="SessionGame", version="1", chainId=5042002, verifyingContract=<address>)
Session(uint256 sessionId, address player, uint256 depositAmount, uint256 maxBetPerRound, uint256 expiry, bytes32 commitment)
```

### Functions

**`deposit(bytes32 commitment, uint256 maxBetPerRound, uint256 expiry) payable → uint256 sessionId`**
- Validates: msg.value > 0, expiry > block.timestamp, house can cover potential payout
- Stores Session, emits `SessionOpened(sessionId, player, depositAmount, expiry)`

**`cashOut(uint256 sessionId, uint256 masterSecret, RoundResult[] calldata rounds, bytes calldata sessionSig) external`**
- Verify `keccak256(masterSecret) == session.commitment`
- Verify EIP-712 sessionSig was signed by `session.player`
- Verify session is ACTIVE and not expired
- For each round:
  - `betAmount <= session.maxBetPerRound`
  - Re-derive currentCard + nextCard from masterSecret + roundNum
  - Resolve win/loss/tie; update running balance
  - Running balance cannot go below 0
- If any check fails → set `status = FLAGGED`, emit `SessionFlagged`; revert (deposit frozen)
- If all valid → transfer `finalBalance` to player; `status = CASHED_OUT`; emit `SessionClosed`

**`_deriveCard(uint256 masterSecret, uint256 roundNum, uint8 nonce) internal pure → uint8`**
- `return uint8(uint256(keccak256(abi.encodePacked(masterSecret, roundNum, nonce))) % 13) + 1`

**Owner functions (carried over):** `depositHouse()`, `withdrawHouse()`, `houseBalance()`

**Abuse prevention:**
- `expiry`: sessions auto-reject cashout after expiry
- `maxBetPerRound`: enforced on every round during cashout
- `FLAGGED` status: invalid history freezes deposit
- Re-entrancy guard on `cashOut`

---

## Step 2 — Tests: `contracts/test/SessionGame.t.sol`

- Happy path: deposit → 3 rounds → cashout, correct balance transferred
- Win-only, loss-only, mixed sessions
- Tie rounds (balance unchanged)
- Bet exceeds maxBetPerRound → flagged
- Invalid masterSecret → reverts
- Expired session → reverts
- Invalid EIP-712 sig → reverts
- House insufficient funds → deposit reverts

---

## Step 3 — New Frontend Hook: `frontend/src/hooks/useSession.js`

Replaces `useGame.js`. Reuses `deriveCard()` helper verbatim.

**State:** `sessionId, offChainBalance, currentCard, currentSuit, roundHistory, roundNum, status, error, houseBalance`

**Refs (never serialized):** `masterSecretRef`, `sessionSigRef`, `contractRef`, `providerRef`, `signerRef`

**Functions:**

`deposit(amountEth, maxBetEth, expiryHours)`
1. Generate `masterSecret = ethers.randomBytes(32)`
2. Compute `commitment = ethers.solidityPackedKeccak256(["uint256"], [secret])`
3. Send `contract.deposit(commitment, maxBetWei, expiryTimestamp, { value: amountWei })`
4. Parse `SessionOpened` event → store `sessionId`
5. Sign EIP-712 session authorization via `provider.send("eth_signTypedData_v4", [address, typedData])`
6. Store sig in `sessionSigRef`; set `offChainBalance = amountEth`

`startRound(betAmount)`
1. Validate `betAmount <= maxBetPerRound` and `betAmount <= offChainBalance`
2. Derive `currentCard = deriveCard(masterSecret, roundNum, 0)`
3. Set currentCard + random suit; set status `AWAITING_GUESS`

`submitGuess(higher)`
1. Derive `nextCard = deriveCard(masterSecret, roundNum, 1)`
2. Resolve win/loss/tie; update `offChainBalance`
3. Append `{ roundNum, betAmount, guessHigher }` to `roundHistory`
4. Increment `roundNum`; set status `ROUND_COMPLETE`

`cashOut()`
1. Call `contract.cashOut(sessionId, masterSecret, roundHistory, sessionSig)`
2. Await receipt; parse `SessionClosed` event
3. Set status `CASHED_OUT`; clear refs

`reset()` — clear all state, return to IDLE

---

## Step 4 — Update `frontend/src/components/GameBoard.jsx`

**New screens:**
- **Deposit screen** (replaces simple bet input): ETH amount, max-bet-per-round slider, expiry selector (1h / 4h / 24h)
- **Per-round bet input**: shown before each round, pre-filled with last bet, capped at maxBetPerRound and remaining balance
- **Balance HUD**: persistent off-chain balance tracker during session
- **Cash Out button**: prominent, always visible during active session
- **FLAGGED screen**: explains session was invalid, deposit frozen

**Remove:** "Claim Winnings" button and `pendingWinnings` display

---

## Step 5 — Update `frontend/src/constants/contract.js`

- Add `SESSION_GAME_ABI` and `SESSION_GAME_ADDRESS` (after deployment)
- Keep existing `CONTRACT_ABI` / `CONTRACT_ADDRESS` for reference

---

## Step 6 — Update `frontend/src/App.jsx`

- Swap `useGame` import for `useSession`
- Pass new session props to `GameBoard`

---

## Files Modified / Created

| Action | File |
|--------|------|
| CREATE | `contracts/src/SessionGame.sol` |
| CREATE | `contracts/test/SessionGame.t.sol` |
| CREATE | `frontend/src/hooks/useSession.js` |
| MODIFY | `frontend/src/components/GameBoard.jsx` |
| MODIFY | `frontend/src/constants/contract.js` |
| MODIFY | `frontend/src/App.jsx` |
| KEEP   | `contracts/src/HigherOrLower.sol` (unchanged) |
| KEEP   | `frontend/src/hooks/useGame.js` (unchanged) |

---

## Verification

1. `cd contracts && forge build` — clean compile
2. `forge test -vvv` — all SessionGame tests pass
3. `forge script script/Deploy.s.sol --broadcast` — deploy to Arc testnet
4. `cd frontend && npm run dev` — test full flow:
   - Deposit 1 ETH, maxBet 0.2 ETH, 4h expiry
   - Play 3 rounds with varying bet amounts
   - Verify balance HUD updates each round
   - Cash out → single MetaMask tx, correct ETH received
   - Confirm total MetaMask interactions = 3 (deposit tx + sign + cashout tx) regardless of round count
