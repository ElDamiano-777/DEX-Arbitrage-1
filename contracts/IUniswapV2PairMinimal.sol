// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IUniswapV2PairMinimal {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}