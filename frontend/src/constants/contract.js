// Fill in after deploying with: forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
export const CONTRACT_ADDRESS = "0xF525Ed0a987A1aBD5FE9DBC22269C44Db66e1B8B";

// SessionGame — deployed to Arc Testnet
export const SESSION_GAME_ADDRESS = "0xfcb67FaB4E703dA58FcD774cf26BBD3C7e1E84BD";

export const ABI = [
  // View
  "function houseBalance() external view returns (uint256)",
  "function games(uint256) external view returns (address player, uint256 betAmt, uint8 status, bytes32 commitment, uint256 commitBlock, uint256 requestedAt, uint8 currentCard, uint8 nextCard, bool guessHigher)",
  "function nextGameId() external view returns (uint256)",
  "function pendingWithdrawals(address) external view returns (uint256)",
  "function REVEAL_TIMEOUT() external view returns (uint256)",

  // Player actions
  "function startGame(bytes32 commitment) external payable returns (uint256 gameId)",
  "function revealAndGuess(uint256 gameId, uint256 secret, bool higher) external",
  "function claimWinnings() external",
  "function refundStuckGame(uint256 gameId) external",

  // Owner
  "function depositHouse() external payable",
  "function withdrawHouse(uint256 amount) external",

  // Custom errors
  "error InsufficientHouseFunds()",
  "error InvalidBet()",
  "error NotYourGame()",
  "error WrongGameStatus()",
  "error TransferFailed()",
  "error NothingToClaim()",
  "error NotTimedOut()",
  "error InvalidReveal()",
  "error TooEarlyToReveal()",
  "error BlockHashExpired()",

  // Events
  "event GameStarted(uint256 indexed gameId, address indexed player, uint256 betAmt)",
  "event GameResolved(uint256 indexed gameId, address indexed player, bool playerWon, bool isTie, uint8 currentCard, uint8 nextCard, uint256 payout)",
  "event WinningsClaimed(address indexed player, uint256 amount)",
  "event GameRefunded(uint256 indexed gameId, address indexed player, uint256 amount)",
];

export const SESSION_GAME_ABI = [
  // View
  "function houseBalance() external view returns (uint256)",
  "function domainSeparator() external view returns (bytes32)",
  "function nextSessionId() external view returns (uint256)",
  "function sessions(uint256) external view returns (address player, uint256 depositAmount, uint256 maxBetPerRound, uint256 expiry, bytes32 commitment, uint8 status)",

  // Player actions
  "function deposit(bytes32 commitment, uint256 maxBetPerRound, uint256 expiry) external payable returns (uint256 sessionId)",
  "function cashOut(uint256 sessionId, uint256 masterSecret, (uint256 roundNum, uint256 betAmount, bool guessHigher)[] rounds, bytes sessionSig) external",

  // Owner
  "function depositHouse() external payable",
  "function withdrawHouse(uint256 amount) external",

  // Custom errors
  "error InvalidDeposit()",
  "error SessionExpired()",
  "error SessionNotActive()",
  "error InvalidSecret()",
  "error InvalidSignature()",
  "error BetExceedsMax()",
  "error InsufficientHouseFunds()",
  "error TransferFailed()",

  // Events
  "event SessionOpened(uint256 indexed sessionId, address indexed player, uint256 depositAmount, uint256 expiry)",
  "event SessionClosed(uint256 indexed sessionId, address indexed player, uint256 payout)",
  "event SessionFlagged(uint256 indexed sessionId, address indexed player, string reason)",
];

// Circle Arc Testnet
export const CHAIN_ID = 5042002;
export const CHAIN_NAME = "Arc Testnet";
export const RPC_URL = "https://rpc.testnet.arc.network";
export const NATIVE_CURRENCY = { name: "USDC", symbol: "USDC", decimals: 18 };
