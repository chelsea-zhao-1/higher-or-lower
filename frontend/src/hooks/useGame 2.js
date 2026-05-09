import { useState, useCallback, useRef } from "react";
import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESS, CHAIN_ID, CHAIN_NAME, RPC_URL } from "../constants/contract.js";

export const GAME_STATUS = {
  IDLE: "idle",
  WAITING_CURRENT: "waiting_current",
  AWAITING_GUESS: "awaiting_guess",
  WAITING_NEXT: "waiting_next",
  COMPLETE: "complete",
};

const CARD_NAMES = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];

function randomSuit() {
  return SUITS[Math.floor(Math.random() * SUITS.length)];
}

export function cardLabel(value) {
  return CARD_NAMES[value] ?? "?";
}

export function useGame() {
  const [address, setAddress]         = useState(null);
  const [status, setStatus]           = useState(GAME_STATUS.IDLE);
  const [gameId, setGameId]           = useState(null);
  const [currentCard, setCurrentCard] = useState(null);
  const [currentSuit, setCurrentSuit] = useState("♠");
  const [result, setResult]           = useState(null); // { playerWon, isTie, currentCard, nextCard, nextSuit, payout }
  const [houseEth, setHouseEth]       = useState(null);
  const [error, setError]             = useState(null);

  const contractRef = useRef(null);

  // ─── Wallet ──────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("MetaMask not found. Please install it.");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      provider.pollingInterval = 2000;
      await provider.send("eth_requestAccounts", []);

      // Switch to Base Sepolia if needed
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x" + CHAIN_ID.toString(16) }],
          });
        } catch {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x" + CHAIN_ID.toString(16),
              chainName: CHAIN_NAME,
              rpcUrls: [RPC_URL],
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            }],
          });
        }
      }

      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);

      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      contractRef.current = contract;

      const bal = await contract.houseBalance();
      setHouseEth(ethers.formatEther(bal));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // ─── Start game ──────────────────────────────────────────────────────────

  const startGame = useCallback(async (betEth) => {
    const contract = contractRef.current;
    if (!contract) return;
    setError(null);
    setResult(null);
    setStatus(GAME_STATUS.WAITING_CURRENT);

    try {
      const betWei = ethers.parseEther(betEth.toString());
      const tx = await contract.startGame({ value: betWei });
      const receipt = await tx.wait();

      // Get gameId from GameStarted event
      const iface = contract.interface;
      let newGameId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed.name === "GameStarted") {
            newGameId = Number(parsed.args.gameId);
          }
        } catch {}
      }
      setGameId(newGameId);

      // Poll game state until VRF delivers the first card
      const poll = setInterval(async () => {
        try {
          const [,, status, card] = await contract.games(newGameId);
          if (Number(status) === 2) { // AWAITING_GUESS
            clearInterval(poll);
            setCurrentCard(Number(card));
            setCurrentSuit(randomSuit());
            setStatus(GAME_STATUS.AWAITING_GUESS);
          }
        } catch {}
      }, 2000);
    } catch (e) {
      setError(e.reason ?? e.message);
      setStatus(GAME_STATUS.IDLE);
    }
  }, []);

  // ─── Submit guess ─────────────────────────────────────────────────────────

  const submitGuess = useCallback(async (higher) => {
    const contract = contractRef.current;
    if (!contract || gameId === null) return;
    setError(null);
    setStatus(GAME_STATUS.WAITING_NEXT);

    try {
      const tx = await contract.submitGuess(gameId, higher);
      await tx.wait();

      // Poll game state until VRF delivers the next card
      const poll = setInterval(async () => {
        try {
          const [,, status, curr, next] = await contract.games(gameId);
          if (Number(status) === 4) { // COMPLETE
            clearInterval(poll);
            const [,betAmt,,,, guessHigher] = await contract.games(gameId);
            const nextIsHigher = Number(next) > Number(curr);
            const isTie = Number(next) === Number(curr);
            const playerWon = !isTie && (guessHigher === nextIsHigher);
            const payout = isTie ? betAmt : playerWon ? betAmt * 2n : 0n;
            setResult({
              playerWon,
              isTie,
              currentCard: Number(curr),
              nextCard: Number(next),
              nextSuit: randomSuit(),
              payout: ethers.formatEther(payout),
            });
            setStatus(GAME_STATUS.COMPLETE);
            contract.houseBalance().then((b) => setHouseEth(ethers.formatEther(b)));
          }
        } catch {}
      }, 2000);
    } catch (e) {
      setError(e.reason ?? e.message);
      setStatus(GAME_STATUS.AWAITING_GUESS);
    }
  }, [gameId]);

  // ─── Reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStatus(GAME_STATUS.IDLE);
    setGameId(null);
    setCurrentCard(null);
    setResult(null);
    setError(null);
  }, []);

  return {
    address,
    status,
    gameId,
    currentCard,
    currentSuit,
    result,
    houseEth,
    error,
    connect,
    startGame,
    submitGuess,
    reset,
  };
}
