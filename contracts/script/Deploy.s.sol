// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console} from "forge-std/Script.sol";
import {HigherOrLower} from "../src/HigherOrLower.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        HigherOrLower game = new HigherOrLower();
        console.log("HigherOrLower deployed at:", address(game));

        vm.stopBroadcast();
    }
}
