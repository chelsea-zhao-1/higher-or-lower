import { useState, useCallback, useRef } from "react";
import { ethers } from "ethers";
import {
  SESSION_GAME_ABI,
  SESSION_GAME_ADDRESS,
  CHAIN_ID,
  CHAIN_NAME,
  RPC_URL,
  NATIVE_CURRENCY,
} from "../constants/contract.js";

export const SESSION_STATUS = {
  IDLE: "idle",
  DEPOSITING: "depositing",
  SIGNING: "signing",
  SESSION_ACTIVE: "session_active",
  AWAITING_GUESS: "awaiting_guess",
  CASHING_OUT: "cashing_out",
  CASHED_OUT: "cashed_out",
  FLAGGED: "flagged",
  SESSION_EXPIRED: "session_expired",
  REFUNDING: "refunding",
};

const CARD_NAMES = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];

function randomSuit() {
  return SUITS[Math.floor(Math.random() * SUITS.length)];
}

export function cardLabel(value) {
  return CARD_NAMES[value] ?? "?";
}

// Mirrors Solidity: keccak256(abi.encodePacked(masterSecret, roundNum, nonce)) % 13 + 1
function deriveCard(masterSecret, roundNum, nonce) {
  const packed = ethers.solidityPackedKeccak256(
    ["uint256", "uint256", "uint8"],
    [masterSecret, BigInt(roundNum), nonce]
  );
  return Number(BigInt(packed) % 13n) + 1;
}

function parseError(e) {
  if (e.code === "ACTION_REJECTED" || e.code === 4001) return "Transaction cancelled.";
  const name = e.revert?.name ?? e.reason ?? "";
  switch (name) {
    case "InvalidDeposit":        return "Deposit amount must be greater than 0.";
    case "SessionExpired":        return "Session has expired.";
    case "SessionNotActive":      return "Session is not active.";
    case "InvalidSecret":         return "Master secret doesn't match commitment. This is a bug — please report it.";
    case "InvalidSignature":      return "Session signature is invalid.";
    case "BetExceedsMax":         return "A bet exceeded the max-per-round limit. Session flagged.";
    case "InsufficientHouseFunds": return "House doesn't have enough funds to cover this deposit.";
    case "TransferFailed":        return "On-chain transfer failed.";
    case "SessionNotExpired":     return "Session hasn't expired yet — you can still cash out normally.";
    case "NotYourSession":        return "This session doesn't belong to your wallet.";
    default: return e.reason ?? e.message ?? "An unknown error occurred.";
  }
}

const LS_KEY = (addr) => `sg_session_${addr.toLowerCase()}`;

function saveSession(addr, data) {
  try {
    localStorage.setItem(LS_KEY(addr), JSON.stringify({
      sessionId:      data.sessionId,
      masterSecret:   data.masterSecret.toString(16).padStart(64, "0"),
      sessionSig:     data.sessionSig,
      depositAmount:  data.depositAmount.toString(),
      expiry:         data.expiry,
      commitment:     data.commitment,
      roundHistory:   data.roundHistory.map((r) => ({ ...r, betAmount: r.betAmount.toString() })),
      roundNum:       data.roundNum,
      offChainBalance: data.offChainBalance.toString(),
    }));
  } catch {}
}

function loadSession(addr) {
  try {
    const raw = localStorage.getItem(LS_KEY(addr));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return {
      sessionId:      d.sessionId,
      masterSecret:   BigInt("0x" + d.masterSecret),
      sessionSig:     d.sessionSig,
      depositAmount:  BigInt(d.depositAmount),
      expiry:         d.expiry,
      commitment:     d.commitment,
      roundHistory:   d.roundHistory.map((r) => ({ ...r, betAmount: BigInt(r.betAmount) })),
      roundNum:       d.roundNum,
      offChainBalance: BigInt(d.offChainBalance),
    };
  } catch { return null; }
}

function clearSession(addr) {
  try { localStorage.removeItem(LS_KEY(addr)); } catch {}
}

export function useSession() {
  const [address,         setAddress]         = useState(null);
  const [status,          setStatus]           = useState(SESSION_STATUS.IDLE);
  const [sessionId,       setSessionId]        = useState(null);
  const [offChainBalance, setOffChainBalance]  = useState(null); // in wei as BigInt
  const [currentCard,     setCurrentCard]      = useState(null);
  const [currentSuit,     setCurrentSuit]      = useState("♠");
  const [roundNum,        setRoundNum]         = useState(0);
  const [roundHistory,    setRoundHistory]     = useState([]);
  const [lastResult,      setLastResult]       = useState(null); // { playerWon, isTie, nextCard, nextSuit }
  const [finalPayout,     setFinalPayout]      = useState(null);
  const [houseEth,        setHouseEth]         = useState(null);
  const [error,           setError]            = useState(null);
  const [stuckSessions,  setStuckSessions]  = useState([]); // [{sessionId, depositAmount, expiry}]
  const [scanning,       setScanning]       = useState(false);

  const contractRef     = useRef(null);
  const providerRef     = useRef(null);
  const masterSecretRef = useRef(null); // BigInt
  const sessionSigRef   = useRef(null); // bytes string
  const depositParamsRef = useRef(null); // { amount, expiry, commitment }
  const roundNumRef     = useRef(0);
  const roundHistoryRef = useRef([]);
  const offChainBalanceRef = useRef(null);
  const currentBetRef   = useRef(null); // wei BigInt for the current round
  const addressRef      = useRef(null);
  const sessionIdRef    = useRef(null);

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
        provider = new ethers.BrowserProvider(window.ethereum);
      }

      providerRef.current = provider;
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);

      const contract = new ethers.Contract(SESSION_GAME_ADDRESS, SESSION_GAME_ABI, signer);
      contractRef.current = contract;
      addressRef.current = addr;

      // Restore saved session if one exists
      const saved = loadSession(addr);
      if (saved) {
        masterSecretRef.current     = saved.masterSecret;
        sessionSigRef.current       = saved.sessionSig;
        depositParamsRef.current    = { amount: saved.depositAmount, expiry: saved.expiry, commitment: saved.commitment };
        roundNumRef.current         = saved.roundNum;
        roundHistoryRef.current     = saved.roundHistory;
        offChainBalanceRef.current  = saved.offChainBalance;
        sessionIdRef.current        = saved.sessionId;
        setSessionId(saved.sessionId);
        setOffChainBalance(saved.offChainBalance);
        setRoundNum(saved.roundNum);
        setRoundHistory(saved.roundHistory);
        try {
          const onChain = await contract.sessions(saved.sessionId);
          const isActive  = Number(onChain.status) === 0;
          const isExpired = Math.floor(Date.now() / 1000) > saved.expiry;
          if (!isActive) {
            clearSession(addr);
          } else if (isExpired) {
            setStatus(SESSION_STATUS.SESSION_EXPIRED);
          } else {
            setStatus(SESSION_STATUS.SESSION_ACTIVE);
          }
        } catch {
          setStatus(SESSION_STATUS.SESSION_ACTIVE);
        }
      }

      const bal = await contract.houseBalance();
      setHouseEth(ethers.formatUnits(bal, NATIVE_CURRENCY.decimals));
    } catch (e) {
      setError(parseError(e));
    }
  }, []);

  // ─── Deposit + sign ───────────────────────────────────────────────────────

  const deposit = useCallback(async (amountEth, expiryHours) => {
    const contract = contractRef.current;
    const provider = providerRef.current;
    if (!contract || !provider) return;
    setError(null);
    setStatus(SESSION_STATUS.DEPOSITING);

    try {
      const amountWei  = ethers.parseUnits(String(amountEth), NATIVE_CURRENCY.decimals);
      const expiry     = Math.floor(Date.now() / 1000) + expiryHours * 3600;

      const secretBytes  = ethers.randomBytes(32);
      const masterSecret = BigInt(ethers.hexlify(secretBytes));
      const commitment   = ethers.solidityPackedKeccak256(["uint256"], [masterSecret]);

      const houseBal = await contract.houseBalance();
      if (amountWei > houseBal) {
        const fmt = parseFloat(ethers.formatUnits(houseBal, NATIVE_CURRENCY.decimals)).toFixed(2);
        setError(`Deposit (${amountEth} USDC) exceeds house pot (${fmt} USDC).`);
        setStatus(SESSION_STATUS.IDLE);
        return;
      }

      const tx      = await contract.deposit(commitment, expiry, { value: amountWei });
      const receipt = await tx.wait();

      let newSessionId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed.name === "SessionOpened") newSessionId = Number(parsed.args.sessionId);
        } catch {}
      }

      masterSecretRef.current = masterSecret;
      depositParamsRef.current = { amount: amountWei, expiry, commitment };

      // Immediately request EIP-712 session signature.
      // Use the same signer that sent the deposit so the recovered address matches session.player.
      setStatus(SESSION_STATUS.SIGNING);
      const signer = contract.runner;
      const addr   = await signer.getAddress();

      const sig = await signer.signTypedData(
        {
          name: "SessionGame",
          version: "1",
          chainId: CHAIN_ID,
          verifyingContract: SESSION_GAME_ADDRESS,
        },
        {
          Session: [
            { name: "sessionId",     type: "uint256" },
            { name: "player",        type: "address" },
            { name: "depositAmount", type: "uint256" },
            { name: "expiry",        type: "uint256" },
            { name: "commitment",    type: "bytes32" },
          ],
        },
        {
          sessionId:     newSessionId,
          player:        addr,
          depositAmount: amountWei,
          expiry:        BigInt(expiry),
          commitment:    commitment,
        },
      );

      sessionSigRef.current = sig;
      setSessionId(newSessionId);
      sessionIdRef.current = newSessionId;
      saveSession(addr, {
        sessionId:      newSessionId,
        masterSecret:   masterSecret,
        sessionSig:     sig,
        depositAmount:  amountWei,
        expiry:         expiry,
        commitment:     commitment,
        roundHistory:   [],
        roundNum:       0,
        offChainBalance: amountWei,
      });
      setOffChainBalance(amountWei);
      offChainBalanceRef.current = amountWei;

      roundNumRef.current = 0;
      roundHistoryRef.current = [];
      setRoundNum(0);
      setRoundHistory([]);
      setLastResult(null);
      setStatus(SESSION_STATUS.SESSION_ACTIVE);
    } catch (e) {
      setError(parseError(e));
      setStatus(SESSION_STATUS.IDLE);
    }
  }, []);

  // ─── Round: start ─────────────────────────────────────────────────────────

  const startRound = useCallback((betEth) => {
    const masterSecret = masterSecretRef.current;
    if (!masterSecret) return;
    setError(null);

    const betWei = ethers.parseUnits(String(betEth), NATIVE_CURRENCY.decimals);
    const balance = offChainBalanceRef.current ?? 0n;

    if (betWei > balance) {
      setError("Bet exceeds your current balance.");
      return;
    }

    currentBetRef.current = betWei;
    const rn   = roundNumRef.current;
    const card = deriveCard(masterSecret, rn, 0);
    setCurrentCard(card);
    setCurrentSuit(randomSuit());
    setLastResult(null);
    setStatus(SESSION_STATUS.AWAITING_GUESS);
  }, []);

  // ─── Round: submit guess ──────────────────────────────────────────────────

  const submitGuess = useCallback((higher) => {
    const masterSecret = masterSecretRef.current;
    if (!masterSecret) return;
    setError(null);

    const rn      = roundNumRef.current;
    const betWei  = currentBetRef.current;
    const curr    = deriveCard(masterSecret, rn, 0);
    const next    = deriveCard(masterSecret, rn, 1);

    const isTie    = next === curr;
    const nextHigher = next > curr;
    const playerWon = !isTie && (higher === nextHigher);

    let newBalance = offChainBalanceRef.current;
    if (!isTie) {
      newBalance = playerWon
        ? newBalance + betWei
        : (newBalance > betWei ? newBalance - betWei : 0n);
    }

    const entry = { roundNum: rn, betAmount: betWei, guessHigher: higher };
    roundHistoryRef.current = [...roundHistoryRef.current, entry];
    roundNumRef.current = rn + 1;
    offChainBalanceRef.current = newBalance;

    setRoundHistory([...roundHistoryRef.current]);
    setRoundNum(rn + 1);
    setOffChainBalance(newBalance);
    setLastResult({ playerWon, isTie, nextCard: next, nextSuit: randomSuit() });
    setStatus(SESSION_STATUS.SESSION_ACTIVE);

    if (addressRef.current && sessionIdRef.current !== null) {
      saveSession(addressRef.current, {
        sessionId:       sessionIdRef.current,
        masterSecret:    masterSecretRef.current,
        sessionSig:      sessionSigRef.current,
        depositAmount:   depositParamsRef.current.amount,
        expiry:          depositParamsRef.current.expiry,
        commitment:      depositParamsRef.current.commitment,
        roundHistory:    roundHistoryRef.current,
        roundNum:        roundNumRef.current,
        offChainBalance: offChainBalanceRef.current,
      });
    }
  }, []);

  // ─── Cash out ─────────────────────────────────────────────────────────────

  const cashOut = useCallback(async () => {
    const contract     = contractRef.current;
    const masterSecret = masterSecretRef.current;
    const sig          = sessionSigRef.current;
    if (!contract || masterSecret === null || !sig) return;
    setError(null);
    setStatus(SESSION_STATUS.CASHING_OUT);

    try {
      const history = roundHistoryRef.current.map((r) => ({
        roundNum:    r.roundNum,
        betAmount:   r.betAmount,
        guessHigher: r.guessHigher,
      }));

      const tx      = await contract.cashOut(sessionId, masterSecret, history, sig);
      const receipt = await tx.wait();

      let payout = null;
      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed.name === "SessionClosed") {
            payout = ethers.formatUnits(parsed.args.payout, NATIVE_CURRENCY.decimals);
          }
          if (parsed.name === "SessionFlagged") {
            setStatus(SESSION_STATUS.FLAGGED);
            return;
          }
        } catch {}
      }

      setFinalPayout(payout);
      setStatus(SESSION_STATUS.CASHED_OUT);
      clearSession(addressRef.current);
    } catch (e) {
      setError(parseError(e));
      setStatus(SESSION_STATUS.SESSION_ACTIVE);
    }
  }, [sessionId]);

  // ─── Refund expired ──────────────────────────────────────────────────────

  const refundExpired = useCallback(async (sessionIdToRefund) => {
    const contract = contractRef.current;
    if (!contract) return;
    setError(null);
    setStatus(SESSION_STATUS.REFUNDING);
    try {
      const tx = await contract.refundExpired(sessionIdToRefund);
      await tx.wait();
      clearSession(addressRef.current);
      sessionIdRef.current = null;
      setSessionId(null);
      setFinalPayout(null);
      setStatus(SESSION_STATUS.CASHED_OUT);
      setStuckSessions((prev) => prev.filter((s) => s.sessionId !== sessionIdToRefund));
    } catch (e) {
      setError(parseError(e));
      setStatus(SESSION_STATUS.SESSION_EXPIRED);
    }
  }, []);

  // ─── Scan stuck sessions ──────────────────────────────────────────────────

  const scanStuckSessions = useCallback(async () => {
    const contract = contractRef.current;
    const addr     = addressRef.current;
    if (!contract || !addr) return;
    setScanning(true);
    setStuckSessions([]);
    try {
      const filter = contract.filters.SessionOpened(null, addr);
      const events = await contract.queryFilter(filter, 0, "latest");
      const nowSec = Math.floor(Date.now() / 1000);
      const results = [];
      for (const ev of events) {
        const sid = Number(ev.args.sessionId);
        try {
          const s = await contract.sessions(sid);
          if (Number(s.status) === 0 && Number(s.expiry) < nowSec) {
            results.push({ sessionId: sid, depositAmount: s.depositAmount, expiry: Number(s.expiry) });
          }
        } catch {}
      }
      setStuckSessions(results);
    } catch (e) {
      setError("Scan failed: " + (e.message ?? "unknown error"));
    } finally {
      setScanning(false);
    }
  }, []);

  // ─── Reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    clearSession(addressRef.current);
    sessionIdRef.current = null;
    setStatus(SESSION_STATUS.IDLE);
    setSessionId(null);
    setOffChainBalance(null);
    setCurrentCard(null);
    setRoundNum(0);
    setRoundHistory([]);
    setLastResult(null);
    setFinalPayout(null);
    setError(null);
    masterSecretRef.current    = null;
    sessionSigRef.current      = null;
    depositParamsRef.current   = null;
    roundNumRef.current        = 0;
    roundHistoryRef.current    = [];
    offChainBalanceRef.current = null;
    currentBetRef.current      = null;
  }, []);

  return {
    address,
    status,
    sessionId,
    offChainBalance,
    currentCard,
    currentSuit,
    roundNum,
    roundHistory,
    lastResult,
    finalPayout,
    houseEth,
    error,
    connect,
    deposit,
    startRound,
    submitGuess,
    cashOut,
    reset,
    stuckSessions,
    scanning,
    refundExpired,
    scanStuckSessions,
  };
}
