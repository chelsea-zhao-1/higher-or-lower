// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console} from "forge-std/Script.sol";
import {SessionGame} from "../src/SessionGame.sol";

contract DeploySessionGame is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        SessionGame game = new SessionGame();
        console.log("SessionGame deployed at:", address(game));

        vm.stopBroadcast();
    }
}
