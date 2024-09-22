// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Router {
    function getAmountsOut(uint256 amountIn, address[] memory path) external view returns (uint256[] memory amounts);
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

contract ArbV2 is Ownable, ReentrancyGuard {
    uint256 private constant DEADLINE = 300;
    uint256 private constant MIN_PROFIT_THRESHOLD = 1e15; // 0.001 ETH in wei
    uint256 private constant SLIPPAGE_TOLERANCE = 50; // 0.5%

    event SuccessfulTrade(address indexed token1, address indexed token2, uint256 profit);
    event FailedTrade(address indexed token1, address indexed token2, string reason);

    constructor() Ownable() {}

    function swap(address router, address _tokenIn, address _tokenOut, uint256 _amount) private {
        IERC20(_tokenIn).approve(router, _amount);
        address[] memory path = new address[](2);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        IUniswapV2Router(router).swapExactTokensForTokens(_amount, 0, path, address(this), block.timestamp + DEADLINE);
    }

    function getAmountOutMin(address router, address _tokenIn, address _tokenOut, uint256 _amount) public view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        uint256[] memory amountOutMins = IUniswapV2Router(router).getAmountsOut(_amount, path);
        return amountOutMins[1] * (10000 - SLIPPAGE_TOLERANCE) / 10000;
    }

    function estimateDualDexTrade(address _router1, address _router2, address _token1, address _token2, uint256 _amount) external view returns (uint256) {
        uint256 amtBack1 = getAmountOutMin(_router1, _token1, _token2, _amount);
        uint256 amtBack2 = getAmountOutMin(_router2, _token2, _token1, amtBack1);
        return amtBack2 > _amount ? amtBack2 - _amount : 0;
    }

    function dualDexTrade(address _router1, address _router2, address _token1, address _token2, uint256 _amount) external onlyOwner nonReentrant {
        require(_amount > 0, "Amount must be greater than 0");
        uint256 startBalance = IERC20(_token1).balanceOf(address(this));
        require(startBalance >= _amount, "Insufficient balance");

        // Check liquidity
        (uint112 reserve0, uint112 reserve1,) = IUniswapV2Pair(_router1).getReserves();
        require(reserve0 > 0 && reserve1 > 0, "Insufficient liquidity");

        // Perform trades
        swap(_router1, _token1, _token2, _amount);
        uint256 token2Balance = IERC20(_token2).balanceOf(address(this));
        swap(_router2, _token2, _token1, token2Balance);

        // Check profit
        uint256 endBalance = IERC20(_token1).balanceOf(address(this));
        uint256 profit = endBalance > startBalance ? endBalance - startBalance : 0;
        
        if (profit > MIN_PROFIT_THRESHOLD) {
            emit SuccessfulTrade(_token1, _token2, profit);
        } else {
            emit FailedTrade(_token1, _token2, "Insufficient profit");
            revert("Insufficient profit");
        }
    }

    function estimateTriDexTrade(address _router1, address _router2, address _router3, address _token1, address _token2, address _token3, uint256 _amount) external view returns (uint256) {
        uint256 amtBack1 = getAmountOutMin(_router1, _token1, _token2, _amount);
        uint256 amtBack2 = getAmountOutMin(_router2, _token2, _token3, amtBack1);
        uint256 amtBack3 = getAmountOutMin(_router3, _token3, _token1, amtBack2);
        return amtBack3 > _amount ? amtBack3 - _amount : 0;
    }

    function getBalance(address _tokenContractAddress) external view returns (uint256) {
        return IERC20(_tokenContractAddress).balanceOf(address(this));
    }

    function recoverEth() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function recoverTokens(address tokenAddress) external onlyOwner {
        IERC20 token = IERC20(tokenAddress);
        token.transfer(owner(), token.balanceOf(address(this)));
    }

    receive() external payable {}
}