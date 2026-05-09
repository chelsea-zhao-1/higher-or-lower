import React, { useState } from "react";
import { GAME_STATUS, cardLabel } from "../hooks/useGame.js";

const RED_SUITS = new Set(["♥", "♦"]);

function CardFace({ value, suit, label = "" }) {
  const isRed = RED_SUITS.has(suit);
  return (
    <div style={{ ...styles.card, color: isRed ? "#ef4444" : "#1e293b" }}>
      <div style={styles.cardCorner}>{cardLabel(value)}<br />{suit}</div>
      <div style={styles.cardCenter}>{suit}</div>
      <div style={{ ...styles.cardCorner, transform: "rotate(180deg)", alignSelf: "flex-end" }}>{cardLabel(value)}<br />{suit}</div>
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

export default function GameBoard({ state }) {
  const { status, currentCard, currentSuit, result, houseEth, pendingWinnings, error, startGame, submitGuess, claimWinnings, reset } = state;
  const [betInput, setBetInput] = useState("1");

  if (status === GAME_STATUS.IDLE) {
    const hasPending = pendingWinnings !== null && parseFloat(pendingWinnings) > 0;
    return (
      <div style={styles.center}>
        <h2 style={styles.heading}>Place Your Bet</h2>
        <p style={styles.sub}>House balance: {houseEth ? `${parseFloat(houseEth).toFixed(2)} USDC` : "…"}</p>
        {hasPending && (
          <div style={styles.winningsBox}>
            <p style={styles.winningsText}>
              Unclaimed winnings: <strong>{parseFloat(pendingWinnings).toFixed(2)} USDC</strong>
            </p>
            <button style={styles.btnClaim} onClick={claimWinnings}>
              Claim Winnings
            </button>
          </div>
        )}
        <div style={styles.betRow}>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={betInput}
            onChange={(e) => setBetInput(e.target.value)}
            style={styles.input}
          />
          <span style={styles.eth}>USDC</span>
        </div>
        <button style={styles.btnPrimary} onClick={() => startGame(betInput)}>
          Draw My Card
        </button>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    );
  }

  if (status === GAME_STATUS.WAITING_CURRENT) {
    return <Spinner text="Drawing your card… (waiting for block confirmation)" />;
  }

  if (status === GAME_STATUS.AWAITING_GUESS) {
    return (
      <div style={styles.center}>
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

  if (status === GAME_STATUS.WAITING_NEXT) {
    return <Spinner text="Resolving game… (waiting for block confirmation)" />;
  }

  if (status === GAME_STATUS.COMPLETE && result) {
    const { playerWon, isTie, nextCard, nextSuit, payout } = result;
    const outcome      = isTie ? "Tie" : playerWon ? "You Win! 🎉" : "You Lose";
    const outcomeColor = isTie ? "#f59e0b" : playerWon ? "#22c55e" : "#ef4444";

    return (
      <div style={styles.center}>
        <div style={styles.cardsRow}>
          <CardFace value={currentCard} suit={currentSuit} label="Your card" />
          <div style={styles.vs}>→</div>
          <CardFace value={nextCard} suit={nextSuit} label="Next card" />
        </div>
        <h2 style={{ ...styles.heading, color: outcomeColor }}>{outcome}</h2>
        {!isTie && playerWon && <p style={styles.sub}>+{parseFloat(payout).toFixed(2)} USDC added to your winnings</p>}
        {isTie && <p style={styles.sub}>{parseFloat(payout).toFixed(2)} USDC returned to your winnings</p>}
        <button style={styles.btnPrimary} onClick={reset}>
          Play Again
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
    padding: 24,
  },
  heading: { fontSize: 28, fontWeight: 700 },
  sub:     { color: "#94a3b8", fontSize: 15 },
  betRow:  { display: "flex", alignItems: "center", gap: 8 },
  input: {
    padding: "10px 16px",
    fontSize: 20,
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#f1f5f9",
    width: 120,
    textAlign: "right",
  },
  eth: { fontSize: 18, color: "#94a3b8" },
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
  cardsRow:   { display: "flex", alignItems: "center", gap: 32, marginBottom: 16 },
  vs:         { fontSize: 32, color: "#64748b" },
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
  error:       { color: "#ef4444", fontSize: 14, maxWidth: 360, textAlign: "center" },
  winningsBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "16px 24px",
    background: "#14532d",
    border: "1px solid #22c55e",
    borderRadius: 12,
  },
  winningsText: { color: "#86efac", fontSize: 15, margin: 0 },
  btnClaim: {
    padding: "10px 28px",
    fontSize: 15,
    fontWeight: 700,
    background: "#22c55e",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
  },
};
