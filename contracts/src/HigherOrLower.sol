// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract HigherOrLower is Ownable {

    enum GameStatus { INACTIVE, WAITING_REVEAL, COMPLETE }

    struct Game {
        address player;
        uint256 betAmt;
        GameStatus status;
        bytes32 commitment;
        uint256 commitBlock;
        uint256 requestedAt;
        uint8 currentCard;
        uint8 nextCard;
        bool guessHigher;
    }

    mapping(uint256 => Game) public games;
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public nextGameId;
    uint256 public constant REVEAL_TIMEOUT = 2 hours;

    event GameStarted(uint256 indexed gameId, address indexed player, uint256 betAmt);
    event GameResolved(
        uint256 indexed gameId,
        address indexed player,
        bool playerWon,
        bool isTie,
        uint8 currentCard,
        uint8 nextCard,
        uint256 payout
    );
    event WinningsClaimed(address indexed player, uint256 amount);
    event GameRefunded(uint256 indexed gameId, address indexed player, uint256 amount);
    event HouseDeposit(uint256 amount);
    event HouseWithdraw(uint256 amount);

    error InsufficientHouseFunds();
    error InvalidBet();
    error NotYourGame();
    error WrongGameStatus();
    error TransferFailed();
    error NothingToClaim();
    error NotTimedOut();
    error InvalidReveal();
    error TooEarlyToReveal();
    error BlockHashExpired();

    constructor() {}

    // ─── Player actions ───────────────────────────────────────────────────────

    function startGame(bytes32 commitment) external payable returns (uint256 gameId) {
        if (msg.value == 0) revert InvalidBet();
        if (address(this).balance - msg.value < msg.value) revert InsufficientHouseFunds();

        gameId = nextGameId++;
        games[gameId] = Game({
            player: msg.sender,
            betAmt: msg.value,
            status: GameStatus.WAITING_REVEAL,
            commitment: commitment,
            commitBlock: block.number,
            requestedAt: block.timestamp,
            currentCard: 0,
            nextCard: 0,
            guessHigher: false
        });

        emit GameStarted(gameId, msg.sender, msg.value);
    }

    // Must be called at least 1 block after startGame, within 256 blocks.
    // Cards are derived from player secret mixed with block hashes.
    // Note: a player who knows their secret can predict both cards before guessing —
    // acceptable for a testnet demo; use an oracle for production.
    function revealAndGuess(uint256 gameId, uint256 secret, bool higher) external {
        Game storage game = games[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.status != GameStatus.WAITING_REVEAL) revert WrongGameStatus();
        if (keccak256(abi.encodePacked(secret)) != game.commitment) revert InvalidReveal();
        if (block.number <= game.commitBlock) revert TooEarlyToReveal();
        if (block.number > game.commitBlock + 256) revert BlockHashExpired();

        uint8 curr = uint8(uint256(keccak256(abi.encodePacked(secret, blockhash(game.commitBlock), uint8(0)))) % 13) + 1;
        uint8 next = uint8(uint256(keccak256(abi.encodePacked(secret, blockhash(block.number - 1), uint8(1)))) % 13) + 1;

        game.currentCard = curr;
        game.nextCard = next;
        game.guessHigher = higher;
        game.status = GameStatus.COMPLETE;

        _resolve(gameId, curr, next);
    }

    function claimWinnings() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit WinningsClaimed(msg.sender, amount);
    }

    // Refund if player never reveals within REVEAL_TIMEOUT or blockhash expires (>256 blocks).
    function refundStuckGame(uint256 gameId) external {
        Game storage game = games[gameId];
        if (game.player != msg.sender) revert NotYourGame();
        if (game.status != GameStatus.WAITING_REVEAL) revert WrongGameStatus();

        bool timedOut = block.timestamp >= game.requestedAt + REVEAL_TIMEOUT;
        bool hashExpired = block.number > game.commitBlock + 256;
        if (!timedOut && !hashExpired) revert NotTimedOut();

        uint256 refund = game.betAmt;
        game.status = GameStatus.COMPLETE;
        game.betAmt = 0;

        (bool ok,) = msg.sender.call{value: refund}("");
        if (!ok) revert TransferFailed();
        emit GameRefunded(gameId, msg.sender, refund);
    }

    // ─── Resolution ───────────────────────────────────────────────────────────

    function _resolve(uint256 gameId, uint8 curr, uint8 next) internal {
        Game storage game = games[gameId];
        uint256 bet = game.betAmt;

        bool isTie = (next == curr);
        bool playerWon;
        uint256 payout;

        if (isTie) {
            payout = bet;
            playerWon = false;
        } else {
            bool nextIsHigher = next > curr;
            playerWon = (game.guessHigher == nextIsHigher);
            payout = playerWon ? bet * 2 : 0;
        }

        if (payout > 0) {
            pendingWithdrawals[game.player] += payout;
        }

        emit GameResolved(gameId, game.player, playerWon, isTie, curr, next, payout);
    }

    // ─── House management ─────────────────────────────────────────────────────

    function depositHouse() external payable onlyOwner {
        emit HouseDeposit(msg.value);
    }

    function withdrawHouse(uint256 amount) external onlyOwner {
        if (amount > address(this).balance) revert InsufficientHouseFunds();
        (bool ok,) = owner().call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit HouseWithdraw(amount);
    }

    function houseBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
