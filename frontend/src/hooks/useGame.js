import { useState, useCallback, useRef } from "react";
import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESS, CHAIN_ID, CHAIN_NAME, RPC_URL, NATIVE_CURRENCY } from "../constants/contract.js";

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

// Mirrors the Solidity: keccak256(abi.encodePacked(secret, blockHash, nonce)) % 13 + 1
function deriveCard(secret, blockHash, nonce) {
  const packed = ethers.solidityPackedKeccak256(
    ["uint256", "bytes32", "uint8"],
    [secret, blockHash, nonce]
  );
  return Number(BigInt(packed) % 13n) + 1;
}

export function useGame() {
  const [address,         setAddress]         = useState(null);
  const [status,          setStatus]           = useState(GAME_STATUS.IDLE);
  const [gameId,          setGameId]           = useState(null);
  const [currentCard,     setCurrentCard]      = useState(null);
  const [currentSuit,     setCurrentSuit]      = useState("♠");
  const [result,          setResult]           = useState(null);
  const [houseBalance,    setHouseBalance]     = useState(null);
  const [pendingWinnings, setPendingWinnings]  = useState(null);
  const [error,           setError]            = useState(null);

  const contractRef = useRef(null);
  const providerRef = useRef(null);
  const secretRef   = useRef(null); // persists between startGame and revealAndGuess

  // ─── Wallet ──────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("MetaMask not found. Please install it.");
      return;
    }
    try {
      let provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

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
              nativeCurrency: NATIVE_CURRENCY,
            }],
          });
        }
        // Re-create provider after network switch so ethers picks up the new chain
        provider = new ethers.BrowserProvider(window.ethereum);
      }

      providerRef.current = provider;
      const signer = await provider.getSigner();
      const addr   = await signer.getAddress();
      setAddress(addr);

      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      contractRef.current = contract;

      const [bal, pending] = await Promise.all([
        contract.houseBalance(),
        contract.pendingWithdrawals(addr),
      ]);
      setHouseBalance(ethers.formatUnits(bal, NATIVE_CURRENCY.decimals));
      setPendingWinnings(ethers.formatUnits(pending, NATIVE_CURRENCY.decimals));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // ─── Start game ──────────────────────────────────────────────────────────

  const startGame = useCallback(async (betUsdc) => {
    const contract = contractRef.current;
    const provider = providerRef.current;
    if (!contract || !provider) return;
    setError(null);
    setResult(null);
    setStatus(GAME_STATUS.WAITING_CURRENT);

    try {
      const secretBytes  = ethers.randomBytes(32);
      const secret       = BigInt(ethers.hexlify(secretBytes));
      const commitment   = ethers.solidityPackedKeccak256(["uint256"], [secret]);
      secretRef.current  = secret;

      const betWei  = ethers.parseUnits(betUsdc.toString(), NATIVE_CURRENCY.decimals);
      const tx      = await contract.startGame(commitment, { value: betWei });
      const receipt = await tx.wait();

      let newGameId = null;
      const iface = contract.interface;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed.name === "GameStarted") newGameId = Number(parsed.args.gameId);
        } catch {}
      }
      setGameId(newGameId);

      const block = await provider.getBlock(receipt.blockNumber);
      const card  = deriveCard(secret, block.hash, 0);
      setCurrentCard(card);
      setCurrentSuit(randomSuit());
      setStatus(GAME_STATUS.AWAITING_GUESS);
    } catch (e) {
      setError(e.reason ?? e.message);
      setStatus(GAME_STATUS.IDLE);
    }
  }, []);

  // ─── Submit guess ─────────────────────────────────────────────────────────

  const submitGuess = useCallback(async (higher) => {
    const contract = contractRef.current;
    const secret   = secretRef.current;
    if (!contract || gameId === null || secret === null) return;
    setError(null);
    setStatus(GAME_STATUS.WAITING_NEXT);

    try {
      const tx      = await contract.revealAndGuess(gameId, secret, higher);
      const receipt = await tx.wait();

      const iface = contract.interface;
      let resolved = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed.name === "GameResolved") resolved = parsed.args;
        } catch {}
      }

      if (resolved) {
        const { playerWon, isTie, currentCard: curr, nextCard: next, payout } = resolved;
        setResult({
          playerWon,
          isTie,
          currentCard: Number(curr),
          nextCard:    Number(next),
          nextSuit:    randomSuit(),
          payout:      ethers.formatUnits(payout, NATIVE_CURRENCY.decimals),
        });

        const addr = await contract.runner.getAddress();
        contract.houseBalance().then(b =>
          setHouseBalance(ethers.formatUnits(b, NATIVE_CURRENCY.decimals))
        );
        contract.pendingWithdrawals(addr).then(p =>
          setPendingWinnings(ethers.formatUnits(p, NATIVE_CURRENCY.decimals))
        );
      }
      setStatus(GAME_STATUS.COMPLETE);
    } catch (e) {
      setError(e.reason ?? e.message);
      setStatus(GAME_STATUS.AWAITING_GUESS);
    }
  }, [gameId]);

  // ─── Claim winnings ──────────────────────────────────────────────────────

  const claimWinnings = useCallback(async () => {
    const contract = contractRef.current;
    if (!contract) return;
    setError(null);
    try {
      const tx   = await contract.claimWinnings();
      await tx.wait();
      const addr    = await contract.runner.getAddress();
      const pending = await contract.pendingWithdrawals(addr);
      setPendingWinnings(ethers.formatUnits(pending, NATIVE_CURRENCY.decimals));
    } catch (e) {
      setError(e.reason ?? e.message);
    }
  }, []);

  // ─── Reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStatus(GAME_STATUS.IDLE);
    setGameId(null);
    setCurrentCard(null);
    setResult(null);
    setError(null);
    secretRef.current = null;
  }, []);

  return {
    address,
    status,
    gameId,
    currentCard,
    currentSuit,
    result,
    houseEth: houseBalance,
    pendingWinnings,
    error,
    connect,
    startGame,
    submitGuess,
    claimWinnings,
    reset,
  };
}
