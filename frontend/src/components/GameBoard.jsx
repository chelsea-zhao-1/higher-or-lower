import React, { useState } from "react";
import { SESSION_STATUS, cardLabel } from "../hooks/useSession.js";
import { ethers } from "ethers";
import { NATIVE_CURRENCY } from "../constants/contract.js";

const RED_SUITS = new Set(["♥", "♦"]);

function fmt(wei) {
  if (wei === null || wei === undefined) return "…";
  return parseFloat(ethers.formatUnits(wei, NATIVE_CURRENCY.decimals)).toFixed(2);
}

function CardFace({ value, suit, label = "" }) {
  const isRed = RED_SUITS.has(suit);
  return (
    <div style={{ ...styles.card, color: isRed ? "#ef4444" : "#1e293b" }}>
      <div style={styles.cardCorner}>{cardLabel(value)}<br />{suit}</div>
      <div style={styles.cardCenter}>{suit}</div>
      <div style={{ ...styles.cardCorner, transform: "rotate(180deg)", alignSelf: "flex-end" }}>
        {cardLabel(value)}<br />{suit}
      </div>
      {label && <div style={styles.cardLabel}>{label}</div>}
    </div>
  );
}

function Spinner({ text }) {
  return (
    <div style={styles.spinnerWrap}>
      <div style={styles.spinner} />
      <p style={styles.spinnerText}>{text}</p>
    </div>
  );
}

function BalanceHUD({ offChainBalance, roundNum, onCashOut }) {
  return (
    <div style={styles.hud}>
      <div style={styles.hudLeft}>
        <span style={styles.hudLabel}>Balance</span>
        <span style={styles.hudValue}>{fmt(offChainBalance)} USDC</span>
      </div>
      <div style={styles.hudLeft}>
        <span style={styles.hudLabel}>Round</span>
        <span style={styles.hudValue}>#{roundNum + 1}</span>
      </div>
      <button style={styles.btnCashOut} onClick={onCashOut}>
        Cash Out
      </button>
    </div>
  );
}

export default function GameBoard({ state }) {
  const {
    status, offChainBalance, currentCard, currentSuit,
    roundNum, lastResult, finalPayout, houseEth, error,
    sessionId,
    deposit, startRound, submitGuess, cashOut, reset,
    stuckSessions, scanning, scanStuckSessions, refundExpired,
  } = state;

  const [amountInput, setAmountInput] = useState("1");
  const [expiryHours, setExpiryHours] = useState(4);
  const [betInput,    setBetInput]    = useState("0.1");
  const [hasScanned,  setHasScanned]  = useState(false);

  // ─── Deposit screen ───────────────────────────────────────────────────────

  if (status === SESSION_STATUS.IDLE) {
    return (
      <div style={styles.center}>
        <h2 style={styles.heading}>Start Session</h2>
        <p style={styles.sub}>House balance: {houseEth ? `${parseFloat(houseEth).toFixed(2)} USDC` : "…"}</p>

        <div style={styles.formCard}>
          <label style={styles.fieldLabel}>Deposit amount (USDC)</label>
          <div style={styles.inputRow}>
            <input
              type="number" min="0.01" step="0.01"
              value={amountInput} onChange={(e) => setAmountInput(e.target.value)}
              style={styles.input}
            />
            <span style={styles.unit}>USDC</span>
          </div>

          <label style={styles.fieldLabel}>Session length</label>
          <div style={styles.expiryRow}>
            {[1, 4, 24].map((h) => (
              <button
                key={h}
                style={{ ...styles.btnExpiry, ...(expiryHours === h ? styles.btnExpiryActive : {}) }}
                onClick={() => setExpiryHours(h)}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>

        <button style={styles.btnPrimary} onClick={() => deposit(amountInput, expiryHours)}>
          Deposit & Start Session
        </button>
        <p style={styles.sub}>2 MetaMask interactions: deposit tx + session signature</p>
        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.recoverSection}>
          <button style={styles.btnScan} onClick={() => { scanStuckSessions(); setHasScanned(true); }} disabled={scanning}>
            {scanning ? "Scanning…" : "Find Stuck Sessions"}
          </button>
          {stuckSessions.length > 0 && (
            <div style={styles.stuckList}>
              {stuckSessions.map((s) => (
                <div key={s.sessionId} style={styles.stuckItem}>
                  <span style={styles.stuckInfo}>
                    Session #{s.sessionId} — {fmt(s.depositAmount)} USDC
                  </span>
                  <button style={styles.btnRefund} onClick={() => refundExpired(s.sessionId)}>
                    Refund
                  </button>
                </div>
              ))}
            </div>
          )}
          {hasScanned && !scanning && stuckSessions.length === 0 && (
            <p style={styles.sub}>No expired sessions found.</p>
          )}
        </div>
      </div>
    );
  }

  if (status === SESSION_STATUS.DEPOSITING) {
    return <Spinner text="Processing deposit… (waiting for confirmation)" />;
  }

  if (status === SESSION_STATUS.SIGNING) {
    return <Spinner text="Sign the session authorization in MetaMask…" />;
  }

  if (status === SESSION_STATUS.SESSION_EXPIRED) {
    return (
      <div style={styles.center}>
        <h2 style={{ ...styles.heading, color: "#f59e0b" }}>Session Expired</h2>
        <p style={styles.sub}>
          Your session #{sessionId} expired. You can refund your original deposit.
        </p>
        <button style={styles.btnPrimary} onClick={() => refundExpired(sessionId)}>
          Refund Deposit
        </button>
        <button style={{ ...styles.btnPrimary, background: "#475569", marginTop: -8 }} onClick={reset}>
          Dismiss
        </button>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    );
  }

  if (status === SESSION_STATUS.REFUNDING) {
    return <Spinner text="Refunding deposit… (waiting for confirmation)" />;
  }

  // ─── Session active: between rounds ──────────────────────────────────────

  if (status === SESSION_STATUS.SESSION_ACTIVE) {
    const { playerWon, isTie, nextCard, nextSuit } = lastResult ?? {};

    return (
      <div style={styles.center}>
        <BalanceHUD offChainBalance={offChainBalance} roundNum={roundNum} onCashOut={cashOut} />

        {lastResult && (
          <div style={styles.resultBanner}>
            <div style={styles.cardsRow}>
              <CardFace value={currentCard} suit={currentSuit} label="Your card" />
              <div style={styles.vs}>→</div>
              <CardFace value={nextCard} suit={nextSuit} label="Next card" />
            </div>
            <h3 style={{
              ...styles.resultText,
              color: isTie ? "#f59e0b" : playerWon ? "#22c55e" : "#ef4444",
            }}>
              {isTie ? "Tie" : playerWon ? "Win! 🎉" : "Loss"}
            </h3>
          </div>
        )}

        <h2 style={styles.heading}>Next Round</h2>
        <div style={styles.inputRow}>
          <input
            type="number" min="0.01" step="0.01"
            value={betInput} onChange={(e) => setBetInput(e.target.value)}
            style={styles.input}
          />
          <span style={styles.unit}>USDC</span>
        </div>

        <button style={styles.btnPrimary} onClick={() => startRound(betInput)}>
          Draw Card
        </button>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    );
  }

  // ─── Awaiting guess ───────────────────────────────────────────────────────

  if (status === SESSION_STATUS.AWAITING_GUESS) {
    return (
      <div style={styles.center}>
        <BalanceHUD offChainBalance={offChainBalance} roundNum={roundNum} onCashOut={cashOut} />
        <p style={styles.sub}>Your card:</p>
        <CardFace value={currentCard} suit={currentSuit} />
        <p style={styles.heading}>Will the next card be…</p>
        <div style={styles.guessRow}>
          <button style={{ ...styles.btnGuess, background: "#22c55e" }} onClick={() => submitGuess(true)}>
            ▲ Higher
          </button>
          <button style={{ ...styles.btnGuess, background: "#ef4444" }} onClick={() => submitGuess(false)}>
            ▼ Lower
          </button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    );
  }

  if (status === SESSION_STATUS.CASHING_OUT) {
    return <Spinner text="Cashing out… (waiting for confirmation)" />;
  }

  // ─── Cashed out ───────────────────────────────────────────────────────────

  if (status === SESSION_STATUS.CASHED_OUT) {
    return (
      <div style={styles.center}>
        <h2 style={{ ...styles.heading, color: "#22c55e" }}>Session Closed</h2>
        <p style={styles.sub}>
          {finalPayout !== null
            ? `${parseFloat(finalPayout).toFixed(2)} USDC sent to your wallet`
            : "Funds returned to your wallet"}
        </p>
        <button style={styles.btnPrimary} onClick={reset}>
          Play Again
        </button>
      </div>
    );
  }

  // ─── Flagged ──────────────────────────────────────────────────────────────

  if (status === SESSION_STATUS.FLAGGED) {
    return (
      <div style={styles.center}>
        <h2 style={{ ...styles.heading, color: "#ef4444" }}>Session Flagged</h2>
        <p style={styles.sub}>
          Invalid round history detected. Your deposit has been frozen by the contract.
        </p>
        <button style={styles.btnPrimary} onClick={reset}>
          Back to Home
        </button>
      </div>
    );
  }

  return null;
}

const styles = {
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    gap: 20,
    padding: "80px 24px 24px",
  },
  heading: { fontSize: 28, fontWeight: 700 },
  sub: { color: "#94a3b8", fontSize: 15 },
  formCard: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 16,
    padding: "24px 32px",
    width: 320,
  },
  fieldLabel: { color: "#94a3b8", fontSize: 13, marginBottom: 2 },
  inputRow: { display: "flex", alignItems: "center", gap: 8 },
  input: {
    padding: "10px 16px",
    fontSize: 18,
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#f1f5f9",
    width: 120,
    textAlign: "right",
  },
  unit: { fontSize: 15, color: "#94a3b8" },
  expiryRow: { display: "flex", gap: 8 },
  btnExpiry: {
    padding: "8px 20px",
    fontSize: 14,
    fontWeight: 600,
    background: "#334155",
    color: "#94a3b8",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnExpiryActive: {
    background: "#6366f1",
    color: "#fff",
  },
  btnPrimary: {
    padding: "14px 36px",
    fontSize: 18,
    fontWeight: 700,
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
  },
  hud: {
    position: "fixed",
    top: 56,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 24px",
    background: "#0f172a",
    borderBottom: "1px solid #1e293b",
    zIndex: 9,
  },
  hudLeft: { display: "flex", flexDirection: "column", gap: 2 },
  hudLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 },
  hudValue: { fontSize: 16, fontWeight: 700, color: "#f1f5f9" },
  btnCashOut: {
    padding: "10px 24px",
    fontSize: 15,
    fontWeight: 700,
    background: "#b45309",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
  },
  resultBanner: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    padding: "20px 32px",
    background: "#1e293b",
    borderRadius: 16,
    border: "1px solid #334155",
  },
  resultText: { fontSize: 22, fontWeight: 700, margin: 0 },
  cardsRow: { display: "flex", alignItems: "center", gap: 32, marginBottom: 8 },
  vs: { fontSize: 32, color: "#64748b" },
  guessRow: { display: "flex", gap: 16 },
  btnGuess: {
    padding: "16px 40px",
    fontSize: 20,
    fontWeight: 800,
    color: "#fff",
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
  },
  card: {
    width: 120,
    height: 170,
    background: "#fff",
    borderRadius: 12,
    border: "2px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    position: "relative",
    boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
    userSelect: "none",
  },
  cardCorner: { fontSize: 16, fontWeight: 700, textAlign: "center", lineHeight: 1.2, alignSelf: "flex-start" },
  cardCenter: { fontSize: 40 },
  cardLabel:  { position: "absolute", bottom: -28, fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" },
  spinnerWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    gap: 20,
  },
  spinner: {
    width: 48,
    height: 48,
    border: "4px solid #334155",
    borderTop: "4px solid #6366f1",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  spinnerText: { color: "#94a3b8", fontSize: 16 },
  error: { color: "#ef4444", fontSize: 14, maxWidth: 360, textAlign: "center" },
  recoverSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    paddingTop: 20,
    borderTop: "1px solid #1e293b",
    width: "100%",
    maxWidth: 400,
  },
  btnScan: {
    padding: "10px 24px",
    fontSize: 14,
    fontWeight: 600,
    background: "#1e293b",
    color: "#94a3b8",
    border: "1px solid #334155",
    borderRadius: 10,
    cursor: "pointer",
  },
  stuckList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: "100%",
  },
  stuckItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 10,
  },
  stuckInfo: { fontSize: 14, color: "#f1f5f9" },
  btnRefund: {
    padding: "8px 18px",
    fontSize: 13,
    fontWeight: 700,
    background: "#b45309",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
};
