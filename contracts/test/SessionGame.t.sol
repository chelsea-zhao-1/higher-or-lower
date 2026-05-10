// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test, console} from "forge-std/Test.sol";
import {SessionGame} from "../src/SessionGame.sol";

contract SessionGameTest is Test {
    SessionGame game;

    address owner    = makeAddr("owner");
    uint256 playerKey = 0xA11CE;
    address player;

    function setUp() public {
        player = vm.addr(playerKey);
        vm.prank(owner);
        game = new SessionGame();
        vm.deal(address(game), 10 ether);
        vm.deal(player, 5 ether);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _commitment(uint256 secret) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret));
    }

    function _deriveCard(uint256 masterSecret, uint256 roundNum, uint8 nonce) internal pure returns (uint8) {
        return uint8(uint256(keccak256(abi.encodePacked(masterSecret, roundNum, nonce))) % 13) + 1;
    }

    function _makeSig(
        uint256 signerKey,
        uint256 sessionId,
        address _player,
        uint256 depositAmount,
        uint256 maxBetPerRound,
        uint256 expiry,
        bytes32 commitment
    ) internal view returns (bytes memory) {
        bytes32 SESSION_TYPEHASH = keccak256(
            "Session(uint256 sessionId,address player,uint256 depositAmount,uint256 maxBetPerRound,uint256 expiry,bytes32 commitment)"
        );
        bytes32 structHash = keccak256(abi.encode(
            SESSION_TYPEHASH, sessionId, _player, depositAmount, maxBetPerRound, expiry, commitment
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", game.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _deposit(
        uint256 secret,
        uint256 amount,
        uint256 maxBet,
        uint256 expiry
    ) internal returns (uint256 sessionId) {
        vm.prank(player);
        sessionId = game.deposit{value: amount}(_commitment(secret), maxBet, expiry);
    }

    function _playerSig(
        uint256 sessionId,
        uint256 amount,
        uint256 maxBet,
        uint256 expiry,
        uint256 secret
    ) internal view returns (bytes memory) {
        return _makeSig(playerKey, sessionId, player, amount, maxBet, expiry, _commitment(secret));
    }

    // ─── deposit ──────────────────────────────────────────────────────────────

    function test_deposit_emitsSessionOpened() public {
        uint256 expiry = block.timestamp + 1 hours;
        vm.prank(player);
        vm.expectEmit(true, true, false, true);
        emit SessionGame.SessionOpened(0, player, 1 ether, expiry);
        game.deposit{value: 1 ether}(_commitment(12345), 0.2 ether, expiry);
    }

    function test_deposit_storesSessionData() public {
        uint256 expiry = block.timestamp + 1 hours;
        bytes32 commitment = _commitment(12345);
        vm.prank(player);
        uint256 sessionId = game.deposit{value: 1 ether}(commitment, 0.2 ether, expiry);

        (address p, uint256 dep, uint256 maxBet, uint256 exp, bytes32 comm, SessionGame.SessionStatus status) =
            game.sessions(sessionId);

        assertEq(p, player);
        assertEq(dep, 1 ether);
        assertEq(maxBet, 0.2 ether);
        assertEq(exp, expiry);
        assertEq(comm, commitment);
        assertEq(uint8(status), uint8(SessionGame.SessionStatus.ACTIVE));
    }

    function test_deposit_reverts_zeroValue() public {
        vm.prank(player);
        vm.expectRevert(SessionGame.InvalidDeposit.selector);
        game.deposit{value: 0}(_commitment(1), 0.1 ether, block.timestamp + 1 hours);
    }

    function test_deposit_reverts_expiredExpiry() public {
        vm.prank(player);
        vm.expectRevert(SessionGame.SessionExpired.selector);
        game.deposit{value: 1 ether}(_commitment(1), 0.1 ether, block.timestamp - 1);
    }

    function test_deposit_reverts_insufficientHouse() public {
        vm.deal(address(game), 0);
        vm.prank(player);
        vm.expectRevert(SessionGame.InsufficientHouseFunds.selector);
        game.deposit{value: 1 ether}(_commitment(1), 0.1 ether, block.timestamp + 1 hours);
    }

    function test_deposit_incrementsSessionId() public {
        uint256 expiry = block.timestamp + 1 hours;
        vm.startPrank(player);
        uint256 id0 = game.deposit{value: 0.1 ether}(_commitment(1), 0.05 ether, expiry);
        uint256 id1 = game.deposit{value: 0.1 ether}(_commitment(2), 0.05 ether, expiry);
        vm.stopPrank();
        assertEq(id0, 0);
        assertEq(id1, 1);
    }

    // ─── cashOut — happy paths ─────────────────────────────────────────────────

    function test_cashOut_noRounds_returnsDeposit() public {
        uint256 secret = 12345;
        uint256 amount = 1 ether;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, amount, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, amount, 0.2 ether, expiry, secret);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](0);
        uint256 balBefore = player.balance;

        vm.prank(player);
        game.cashOut(sessionId, secret, rounds, sig);

        assertEq(player.balance, balBefore + amount);
    }

    function test_cashOut_threeRounds_correctBalance() public {
        uint256 secret = 99999;
        uint256 amount = 1 ether;
        uint256 maxBet = 0.2 ether;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, amount, maxBet, expiry);
        bytes memory sig = _playerSig(sessionId, amount, maxBet, expiry, secret);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](3);
        int256 expected = int256(amount);

        for (uint256 i = 0; i < 3; i++) {
            uint8 curr = _deriveCard(secret, i, 0);
            uint8 next = _deriveCard(secret, i, 1);
            bool guessHigher = next >= curr; // win or tie
            rounds[i] = SessionGame.RoundResult({roundNum: i, betAmount: 0.1 ether, guessHigher: guessHigher});

            if (next > curr) expected += int256(uint256(0.1 ether));
        }

        uint256 balBefore = player.balance;
        vm.prank(player);
        game.cashOut(sessionId, secret, rounds, sig);

        assertEq(player.balance, balBefore + uint256(expected));
    }

    function test_cashOut_lossClampedAtZero() public {
        uint256 secret = 12345;
        uint256 amount = 0.1 ether;
        uint256 maxBet = 0.2 ether;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, amount, maxBet, expiry);
        bytes memory sig = _playerSig(sessionId, amount, maxBet, expiry, secret);

        uint8 curr = _deriveCard(secret, 0, 0);
        uint8 next = _deriveCard(secret, 0, 1);

        // Only run this test if there's a non-tie (so we can guarantee a loss)
        vm.assume(curr != next);

        bool losingGuess = next > curr ? false : true;
        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](1);
        rounds[0] = SessionGame.RoundResult({roundNum: 0, betAmount: 0.2 ether, guessHigher: losingGuess});

        uint256 balBefore = player.balance;
        vm.prank(player);
        game.cashOut(sessionId, secret, rounds, sig);

        // Balance can't go below 0, payout = 0 (lost 0.1 ether, clamped)
        assertEq(player.balance, balBefore);
    }

    function test_cashOut_tieRound_balanceUnchanged() public {
        // Find a secret/round that produces a tie
        uint256 secret;
        uint256 roundNum;
        bool foundTie;
        for (uint256 s = 1; s < 100; s++) {
            uint8 curr = _deriveCard(s, 0, 0);
            uint8 next = _deriveCard(s, 0, 1);
            if (curr == next) {
                secret = s;
                roundNum = 0;
                foundTie = true;
                break;
            }
        }
        if (!foundTie) return; // skip if no tie found in range

        uint256 amount = 1 ether;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, amount, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, amount, 0.2 ether, expiry, secret);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](1);
        rounds[0] = SessionGame.RoundResult({roundNum: roundNum, betAmount: 0.2 ether, guessHigher: true});

        uint256 balBefore = player.balance;
        vm.prank(player);
        game.cashOut(sessionId, secret, rounds, sig);

        assertEq(player.balance, balBefore + amount); // tie = no change
    }

    function test_cashOut_emitsSessionClosed() public {
        uint256 secret = 12345;
        uint256 amount = 1 ether;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, amount, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, amount, 0.2 ether, expiry, secret);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](0);
        vm.prank(player);
        vm.expectEmit(true, true, false, false);
        emit SessionGame.SessionClosed(sessionId, player, 0);
        game.cashOut(sessionId, secret, rounds, sig);
    }

    // ─── cashOut — reverts ────────────────────────────────────────────────────

    function test_cashOut_reverts_badSecret() public {
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(12345, 1 ether, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, 1 ether, 0.2 ether, expiry, 12345);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](0);
        vm.prank(player);
        vm.expectRevert(SessionGame.InvalidSecret.selector);
        game.cashOut(sessionId, 99999, rounds, sig); // wrong secret
    }

    function test_cashOut_reverts_invalidSig() public {
        uint256 secret = 12345;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, 1 ether, 0.2 ether, expiry);

        uint256 strangerKey = 0xBEEF;
        bytes memory badSig = _makeSig(strangerKey, sessionId, player, 1 ether, 0.2 ether, expiry, _commitment(secret));

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](0);
        vm.prank(player);
        vm.expectRevert(SessionGame.InvalidSignature.selector);
        game.cashOut(sessionId, secret, rounds, badSig);
    }

    function test_cashOut_reverts_expired() public {
        uint256 secret = 12345;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, 1 ether, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, 1 ether, 0.2 ether, expiry, secret);

        vm.warp(expiry + 1);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](0);
        vm.prank(player);
        vm.expectRevert(SessionGame.SessionExpired.selector);
        game.cashOut(sessionId, secret, rounds, sig);
    }

    function test_cashOut_reverts_alreadyCashedOut() public {
        uint256 secret = 12345;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, 1 ether, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, 1 ether, 0.2 ether, expiry, secret);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](0);
        vm.prank(player);
        game.cashOut(sessionId, secret, rounds, sig);

        vm.prank(player);
        vm.expectRevert(SessionGame.SessionNotActive.selector);
        game.cashOut(sessionId, secret, rounds, sig);
    }

    // ─── cashOut — flagging ───────────────────────────────────────────────────

    function test_cashOut_flagged_betExceedsMax() public {
        uint256 secret = 12345;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, 1 ether, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, 1 ether, 0.2 ether, expiry, secret);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](1);
        rounds[0] = SessionGame.RoundResult({roundNum: 0, betAmount: 0.5 ether, guessHigher: true});

        vm.prank(player);
        game.cashOut(sessionId, secret, rounds, sig); // no revert — deposit is frozen

        (,,,,,SessionGame.SessionStatus status) = game.sessions(sessionId);
        assertEq(uint8(status), uint8(SessionGame.SessionStatus.FLAGGED));
    }

    function test_cashOut_flagged_depositFrozen() public {
        uint256 secret = 12345;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, 1 ether, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, 1 ether, 0.2 ether, expiry, secret);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](1);
        rounds[0] = SessionGame.RoundResult({roundNum: 0, betAmount: 0.5 ether, guessHigher: true});

        uint256 balBefore = player.balance;
        vm.prank(player);
        game.cashOut(sessionId, secret, rounds, sig);

        assertEq(player.balance, balBefore); // no ETH transferred
    }

    function test_cashOut_flagged_emitsEvent() public {
        uint256 secret = 12345;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, 1 ether, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, 1 ether, 0.2 ether, expiry, secret);

        SessionGame.RoundResult[] memory rounds = new SessionGame.RoundResult[](1);
        rounds[0] = SessionGame.RoundResult({roundNum: 0, betAmount: 0.5 ether, guessHigher: true});

        vm.prank(player);
        vm.expectEmit(true, true, false, false);
        emit SessionGame.SessionFlagged(sessionId, player, "");
        game.cashOut(sessionId, secret, rounds, sig);
    }

    function test_cashOut_flagged_cannotRetry() public {
        uint256 secret = 12345;
        uint256 expiry = block.timestamp + 1 hours;
        uint256 sessionId = _deposit(secret, 1 ether, 0.2 ether, expiry);
        bytes memory sig = _playerSig(sessionId, 1 ether, 0.2 ether, expiry, secret);

        SessionGame.RoundResult[] memory badRounds = new SessionGame.RoundResult[](1);
        badRounds[0] = SessionGame.RoundResult({roundNum: 0, betAmount: 0.5 ether, guessHigher: true});

        vm.prank(player);
        game.cashOut(sessionId, secret, badRounds, sig);

        // Try again with valid rounds — should revert because status is FLAGGED
        SessionGame.RoundResult[] memory goodRounds = new SessionGame.RoundResult[](0);
        vm.prank(player);
        vm.expectRevert(SessionGame.SessionNotActive.selector);
        game.cashOut(sessionId, secret, goodRounds, sig);
    }

    // ─── Owner functions ──────────────────────────────────────────────────────

    function test_ownerCanDepositAndWithdraw() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        game.depositHouse{value: 0.5 ether}();

        uint256 balBefore = owner.balance;
        vm.prank(owner);
        game.withdrawHouse(0.5 ether);
        assertEq(owner.balance, balBefore + 0.5 ether);
    }

    function test_withdrawHouse_reverts_insufficientFunds() public {
        vm.prank(owner);
        vm.expectRevert(SessionGame.InsufficientHouseFunds.selector);
        game.withdrawHouse(100 ether);
    }

    function test_nonOwnerCannotWithdraw() public {
        vm.prank(player);
        vm.expectRevert();
        game.withdrawHouse(0.1 ether);
    }

    function test_houseBalance_reflectsDeposit() public {
        uint256 bal = game.houseBalance();
        assertEq(bal, 10 ether);
    }
}
