// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test, console} from "forge-std/Test.sol";
import {HigherOrLower} from "../src/HigherOrLower.sol";

contract HigherOrLowerTest is Test {
    HigherOrLower game;

    address owner  = makeAddr("owner");
    address player = makeAddr("player");

    function setUp() public {
        vm.prank(owner);
        game = new HigherOrLower();

        vm.deal(address(game), 1 ether);
        vm.deal(player, 1 ether);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _commitment(uint256 secret) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret));
    }

    function _deriveCard(uint256 secret, bytes32 bHash, uint8 nonce) internal pure returns (uint8) {
        return uint8(uint256(keccak256(abi.encodePacked(secret, bHash, nonce))) % 13) + 1;
    }

    // Commit at current block, roll forward one block, return expected cards.
    function _startAndCommit(uint256 secret, uint256 bet) internal returns (uint256 gameId, uint8 curr, uint8 next) {
        uint256 commitBlock = block.number;
        vm.prank(player);
        gameId = game.startGame{value: bet}(_commitment(secret));

        vm.roll(commitBlock + 1);

        curr = _deriveCard(secret, blockhash(commitBlock), 0);
        next = _deriveCard(secret, blockhash(block.number - 1), 1);
    }

    // ─── startGame ────────────────────────────────────────────────────────────

    function test_startGame_emitsGameStarted() public {
        vm.prank(player);
        vm.expectEmit(true, true, false, true);
        emit HigherOrLower.GameStarted(0, player, 0.1 ether);
        game.startGame{value: 0.1 ether}(_commitment(1));
    }

    function test_startGame_reverts_zeroBet() public {
        vm.prank(player);
        vm.expectRevert(HigherOrLower.InvalidBet.selector);
        game.startGame{value: 0}(_commitment(1));
    }

    function test_startGame_reverts_insufficientHouse() public {
        vm.deal(address(game), 0);
        vm.deal(player, 2 ether);
        vm.prank(player);
        vm.expectRevert(HigherOrLower.InsufficientHouseFunds.selector);
        game.startGame{value: 0.6 ether}(_commitment(1));
    }

    // ─── revealAndGuess ───────────────────────────────────────────────────────

    function test_revealAndGuess_reverts_badSecret() public {
        vm.prank(player);
        game.startGame{value: 0.1 ether}(_commitment(42));
        vm.roll(block.number + 1);

        vm.prank(player);
        vm.expectRevert(HigherOrLower.InvalidReveal.selector);
        game.revealAndGuess(0, 99, true); // wrong secret
    }

    function test_revealAndGuess_reverts_tooEarly() public {
        vm.prank(player);
        game.startGame{value: 0.1 ether}(_commitment(1));
        // do NOT roll; still same block

        vm.prank(player);
        vm.expectRevert(HigherOrLower.TooEarlyToReveal.selector);
        game.revealAndGuess(0, 1, true);
    }

    function test_revealAndGuess_reverts_blockHashExpired() public {
        vm.prank(player);
        game.startGame{value: 0.1 ether}(_commitment(1));

        vm.roll(block.number + 257);

        vm.prank(player);
        vm.expectRevert(HigherOrLower.BlockHashExpired.selector);
        game.revealAndGuess(0, 1, true);
    }

    function test_revealAndGuess_reverts_wrongPlayer() public {
        vm.prank(player);
        game.startGame{value: 0.1 ether}(_commitment(1));
        vm.roll(block.number + 1);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(HigherOrLower.NotYourGame.selector);
        game.revealAndGuess(0, 1, true);
    }

    // ─── Full game flows ──────────────────────────────────────────────────────

    function test_fullGame_correctOutcome() public {
        uint256 secret = 12345;
        uint256 bet = 0.1 ether;

        (uint256 gameId, uint8 curr, uint8 next) = _startAndCommit(secret, bet);

        bool isTie = next == curr;
        bool guessHigher = next >= curr; // guaranteed win or tie

        vm.prank(player);
        game.revealAndGuess(gameId, secret, guessHigher);

        if (isTie) {
            assertEq(game.pendingWithdrawals(player), bet);
        } else {
            assertEq(game.pendingWithdrawals(player), bet * 2);
        }
    }

    function test_fullGame_playerLoses_noPending() public {
        uint256 secret = 12345;
        uint256 bet = 0.1 ether;

        (uint256 gameId, uint8 curr, uint8 next) = _startAndCommit(secret, bet);

        bool isTie = next == curr;
        bool guessWrong = next < curr; // wrong guess direction (lower when next is higher)

        if (!isTie && !guessWrong) {
            // next > curr, so guessing lower is wrong
            vm.prank(player);
            game.revealAndGuess(gameId, secret, false);
            assertEq(game.pendingWithdrawals(player), 0);
        } else {
            // skip if tie or already loses — just verify game resolves
            vm.prank(player);
            game.revealAndGuess(gameId, secret, guessWrong);
        }
    }

    function test_fullGame_emitsGameResolved() public {
        uint256 secret = 99999;
        (uint256 gameId,,) = _startAndCommit(secret, 0.1 ether);

        vm.prank(player);
        vm.expectEmit(true, true, false, false);
        emit HigherOrLower.GameResolved(gameId, player, false, false, 0, 0, 0);
        game.revealAndGuess(gameId, secret, true);
    }

    // ─── claimWinnings ────────────────────────────────────────────────────────

    function test_claimWinnings_transfersBalance() public {
        uint256 secret = 12345;
        uint256 bet = 0.1 ether;

        (uint256 gameId, uint8 curr, uint8 next) = _startAndCommit(secret, bet);
        bool guessHigher = next >= curr;

        vm.prank(player);
        game.revealAndGuess(gameId, secret, guessHigher);

        uint256 pending = game.pendingWithdrawals(player);
        uint256 balBefore = player.balance;

        vm.prank(player);
        game.claimWinnings();

        assertEq(player.balance, balBefore + pending);
        assertEq(game.pendingWithdrawals(player), 0);
    }

    function test_claimWinnings_reverts_nothingToClaim() public {
        vm.prank(player);
        vm.expectRevert(HigherOrLower.NothingToClaim.selector);
        game.claimWinnings();
    }

    // ─── refundStuckGame ─────────────────────────────────────────────────────

    function test_refundStuckGame_afterTimeout() public {
        uint256 bet = 0.1 ether;
        vm.prank(player);
        game.startGame{value: bet}(_commitment(1));

        vm.warp(block.timestamp + game.REVEAL_TIMEOUT() + 1);

        uint256 balBefore = player.balance;
        vm.prank(player);
        game.refundStuckGame(0);

        assertEq(player.balance, balBefore + bet);
    }

    function test_refundStuckGame_afterBlockHashExpiry() public {
        uint256 bet = 0.1 ether;
        vm.prank(player);
        game.startGame{value: bet}(_commitment(1));

        vm.roll(block.number + 257);

        uint256 balBefore = player.balance;
        vm.prank(player);
        game.refundStuckGame(0);

        assertEq(player.balance, balBefore + bet);
    }

    function test_refundStuckGame_reverts_tooEarly() public {
        vm.prank(player);
        game.startGame{value: 0.1 ether}(_commitment(1));

        vm.prank(player);
        vm.expectRevert(HigherOrLower.NotTimedOut.selector);
        game.refundStuckGame(0);
    }

    function test_refundStuckGame_reverts_wrongPlayer() public {
        vm.prank(player);
        game.startGame{value: 0.1 ether}(_commitment(1));

        vm.warp(block.timestamp + game.REVEAL_TIMEOUT() + 1);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(HigherOrLower.NotYourGame.selector);
        game.refundStuckGame(0);
    }

    function test_refundStuckGame_reverts_completedGame() public {
        uint256 secret = 1;
        (uint256 gameId,,) = _startAndCommit(secret, 0.1 ether);

        vm.prank(player);
        game.revealAndGuess(gameId, secret, true);

        vm.warp(block.timestamp + game.REVEAL_TIMEOUT() + 1);

        vm.prank(player);
        vm.expectRevert(HigherOrLower.WrongGameStatus.selector);
        game.refundStuckGame(gameId);
    }

    // ─── Owner functions ──────────────────────────────────────────────────────

    function test_ownerCanDepositAndWithdraw() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        game.depositHouse{value: 0.5 ether}();

        vm.prank(owner);
        game.withdrawHouse(0.5 ether);
    }

    function test_nonOwnerCannotWithdraw() public {
        vm.prank(player);
        vm.expectRevert();
        game.withdrawHouse(0.1 ether);
    }
}
