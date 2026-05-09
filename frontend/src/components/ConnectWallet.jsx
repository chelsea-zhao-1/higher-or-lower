import React from "react";

export default function ConnectWallet({ onConnect }) {
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Higher or Lower</h1>
      <p style={styles.sub}>Bet USDC against the house on a card game, settled on-chain.</p>
      <button style={styles.btn} onClick={onConnect}>
        Connect Wallet
      </button>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    gap: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: 800,
    letterSpacing: -1,
  },
  sub: {
    color: "#94a3b8",
    fontSize: 16,
  },
  btn: {
    padding: "14px 36px",
    fontSize: 18,
    fontWeight: 700,
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
  },
};
