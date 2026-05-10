// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract SessionGame is Ownable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    enum SessionStatus { ACTIVE, CASHED_OUT }

    struct Session {
        address player;
        uint256 depositAmount;
        uint256 expiry;
        bytes32 commitment;
        SessionStatus status;
    }

    struct RoundResult {
        uint256 roundNum;
        uint256 betAmount;
        bool guessHigher;
    }

    bytes32 private constant SESSION_TYPEHASH = keccak256(
        "Session(uint256 sessionId,address player,uint256 depositAmount,uint256 expiry,bytes32 commitment)"
    );

    mapping(uint256 => Session) public sessions;
    uint256 public nextSessionId;

    event SessionOpened(uint256 indexed sessionId, address indexed player, uint256 depositAmount, uint256 expiry);
    event SessionClosed(uint256 indexed sessionId, address indexed player, uint256 payout);
    event HouseDeposit(uint256 amount);
    event HouseWithdraw(uint256 amount);

    error InvalidDeposit();
    error SessionExpired();
    error SessionNotActive();
    error InvalidSecret();
    error InvalidSignature();
    error InsufficientHouseFunds();
    error TransferFailed();

    constructor() Ownable() EIP712("SessionGame", "1") {}

    // ─── Player actions ───────────────────────────────────────────────────────

    function deposit(
        bytes32 commitment,
        uint256 expiry
    ) external payable returns (uint256 sessionId) {
        if (msg.value == 0) revert InvalidDeposit();
        if (expiry <= block.timestamp) revert SessionExpired();
        // House must be able to cover a full win (worst case: double the deposit)
        if (address(this).balance - msg.value < msg.value) revert InsufficientHouseFunds();

        sessionId = nextSessionId++;
        sessions[sessionId] = Session({
            player: msg.sender,
            depositAmount: msg.value,
            expiry: expiry,
            commitment: commitment,
            status: SessionStatus.ACTIVE
        });

        emit SessionOpened(sessionId, msg.sender, msg.value, expiry);
    }

    function cashOut(
        uint256 sessionId,
        uint256 masterSecret,
        RoundResult[] calldata rounds,
        bytes calldata sessionSig
    ) external nonReentrant {
        Session storage session = sessions[sessionId];

        if (session.status != SessionStatus.ACTIVE) revert SessionNotActive();
        if (block.timestamp > session.expiry) revert SessionExpired();
        if (keccak256(abi.encodePacked(masterSecret)) != session.commitment) revert InvalidSecret();

        bytes32 structHash = keccak256(abi.encode(
            SESSION_TYPEHASH,
            sessionId,
            session.player,
            session.depositAmount,
            session.expiry,
            session.commitment
        ));
        address recovered = _hashTypedDataV4(structHash).recover(sessionSig);
        if (recovered != session.player) revert InvalidSignature();

        // Replay all rounds
        int256 runningBalance = int256(session.depositAmount);
        for (uint256 i = 0; i < rounds.length; i++) {
            RoundResult calldata r = rounds[i];

            uint8 curr = _deriveCard(masterSecret, r.roundNum, 0);
            uint8 next = _deriveCard(masterSecret, r.roundNum, 1);

            if (next != curr) {
                bool nextHigher = next > curr;
                bool playerWon = (r.guessHigher == nextHigher);
                if (playerWon) {
                    runningBalance += int256(r.betAmount);
                } else {
                    runningBalance -= int256(r.betAmount);
                    if (runningBalance < 0) runningBalance = 0;
                }
            }
        }

        uint256 payout = uint256(runningBalance);
        session.status = SessionStatus.CASHED_OUT;

        (bool ok,) = session.player.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit SessionClosed(sessionId, session.player, payout);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _deriveCard(uint256 masterSecret, uint256 roundNum, uint8 nonce) internal pure returns (uint8) {
        return uint8(uint256(keccak256(abi.encodePacked(masterSecret, roundNum, nonce))) % 13) + 1;
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function houseBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─── Owner ────────────────────────────────────────────────────────────────

    function depositHouse() external payable onlyOwner {
        emit HouseDeposit(msg.value);
    }

    function withdrawHouse(uint256 amount) external onlyOwner {
        if (amount > address(this).balance) revert InsufficientHouseFunds();
        (bool ok,) = owner().call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit HouseWithdraw(amount);
    }
}
