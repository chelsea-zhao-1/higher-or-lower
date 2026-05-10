import React from "react";
import { useSession } from "./hooks/useSession.js";
import ConnectWallet from "./components/ConnectWallet.jsx";
import GameBoard from "./components/GameBoard.jsx";

export default function App() {
  const game = useSession();

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {game.address ? (
        <>
          <header style={styles.header}>
            <span style={styles.logo}>♠ Higher or Lower</span>
            <span style={styles.addr}>{game.address.slice(0, 6)}…{game.address.slice(-4)}</span>
          </header>
          <GameBoard state={game} />
        </>
      ) : (
        <ConnectWallet onConnect={game.connect} />
      )}
    </>
  );
}

const styles = {
  header: {
    position: "fixed",
    top: 0, left: 0, right: 0,
    padding: "12px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#0f172a",
    borderBottom: "1px solid #1e293b",
    zIndex: 10,
  },
  logo: {
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: -0.5,
  },
  addr: {
    fontSize: 13,
    color: "#94a3b8",
    fontFamily: "monospace",
  },
};
