// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IUniswapV2FactoryMinimal.sol";
import "./IUniswapV2PairMinimal.sol";
//import '@uniswap/v2-periphery/contracts/libraries/UniswapV2Library.sol';
//import '@uniswap/v3-periphery/contracts/libraries/UniswapV2Library.sol';

// Schnittstellen für ERC20-Token und Uniswap-Router
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

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

contract ArbV2 is Ownable {
    // Konstanten für Gasoptimierung
    uint256 private constant DEADLINE = 300;
    uint256 private constant MIN_PROFIT_THRESHOLD = 1; // Minimaler Gewinn in Basiseinheiten
    uint256 constant PERCENTAGE = 1e6; // 0.0001%

    constructor() Ownable() {}

    // Optimierte Swap-Funktion
    function swap(address router, address _tokenIn, address _tokenOut, uint256 _amount) public onlyOwner {
        IERC20(_tokenIn).approve(router, _amount);
        
        address[] memory path;
        path = new address[](2);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        
        uint256 minAmountOut = 1; // Minimaler Ausgabebetrag
        
        try IUniswapV2Router(router).swapExactTokensForTokens(
            _amount,
            minAmountOut,
            path,
            address(this),
            block.timestamp + DEADLINE
        ) returns (uint256[] memory amounts) {
            require(amounts[1] > 0, "Swap failed: Zero output amount");
        } catch Error(string memory reason) {
            revert(string(abi.encodePacked("Swap failed: ", reason)));
        } catch {
            revert("Swap failed: Unknown error");
        }
    }

    // Funktion zur Berechnung des minimalen Ausgabebetrags
    function getAmountOutMin(address router, address _tokenIn, address _tokenOut, uint256 _amount) public view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        
        try IUniswapV2Router(router).getAmountsOut(_amount, path) returns (uint256[] memory amountOutMins) {
            require(amountOutMins.length > 1, "Invalid output from getAmountsOut");
            // BINGO!
            return amountOutMins[1]; 
        } catch (bytes memory /*lowLevelData*/) {
            // Funktion existiert nicht oder Handelspaar ist unbekannt
            return 0;
        }
    }

    // Schätzung des Gewinns für Dual-DEX-Trade
    function estimateDualDexTrade(address _router1, address _router2, address _token1, address _token2, uint256 _amount) public view returns (uint256) {
        uint256 amtBack1 = getAmountOutMin(_router1, _token1, _token2, _amount);
        require(amtBack1 > 0, "Insufficient liquidity on DEX 1");

        uint256 amtBack2 = getAmountOutMin(_router2, _token2, _token1, amtBack1);
        require(amtBack2 > _amount, "Insufficient liquidity on DEX 2");

        return amtBack2 - _amount; // Berechne den tatsächlichen Gewinn
    }

    // getReserves Funktion zum ermitteln der Liqidität des Pairs
    function getReserves(address factory, address tokenA, address tokenB) public view returns (uint reserveA, uint reserveB) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        address pair = IUniswapV2FactoryMinimal(factory).getPair(token0, token1);
        require(pair != address(0), "Pair does not exist");
        (uint reserve0, uint reserve1,) = IUniswapV2PairMinimal(pair).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    // Erweiterte dualDexTrade-Funktion mit getReserves
    function dualDexTrade(address _router1, address _router2, address _token1, address _token2, uint256 _amount) public onlyOwner {
        uint256 startBalance = IERC20(_token1).balanceOf(address(this));
        
        // Überprüfe Liquidität vor dem Trade für DEX1
        (uint reserveA1,) = getReserves(_router1, _token1, _token2);
        require(reserveA1 >= _amount, "Insufficient liquidity on DEX 1");

        swap(_router1, _token1, _token2, _amount);
        uint256 token2Balance = IERC20(_token2).balanceOf(address(this));

        // Überprüfe Liquidität vor dem Trade für DEX2
        (, uint reserveB2) = getReserves(_router2, _token2, _token1);
        require(reserveB2 >= token2Balance, "Insufficient liquidity on DEX 2");

        swap(_router2, _token2, _token1, token2Balance);
        uint256 endBalance = IERC20(_token1).balanceOf(address(this));
        uint256 profit = endBalance - startBalance;
        require(profit > startBalance * PERCENTAGE / 1e16, "Unzureichender Gewinn");

        // Emittiere ein Ereignis für erfolgreichen Traderequire(profit > startBalance * 1e14 / 1e16, "Unzureichender Gewinn");
        emit SuccessfulTrade(_token1, _token2, profit);
    }

    // Schätzung des Gewinns für Tri-DEX-Trade
    function estimateTriDexTrade(address _router1, address _router2, address _router3, address _token1, address _token2, address _token3, uint256 _amount) public view returns (uint256) {
        uint256 amtBack1 = getAmountOutMin(_router1, _token1, _token2, _amount);
        uint256 amtBack2 = getAmountOutMin(_router2, _token2, _token3, amtBack1);
        uint256 amtBack3 = getAmountOutMin(_router3, _token3, _token1, amtBack2);
        return amtBack3 > _amount ? amtBack3 - _amount : 0;
    }

    // Hilfsfunktionen
    function getBalance(address _tokenContractAddress) public view returns (uint256) {
        return IERC20(_tokenContractAddress).balanceOf(address(this));
    }

    function recoverEth() external onlyOwner {
        payable(msg.sender).transfer(address(this).balance);
    }

    function recoverTokens(address tokenAddress) external onlyOwner {
        IERC20 token = IERC20(tokenAddress);
        token.transfer(msg.sender, token.balanceOf(address(this)));
    }

    // Ereignis für erfolgreichen Trade
    event SuccessfulTrade(address indexed token1, address indexed token2, uint256 profit);
    //event LogEvent(string message, uint256 timestamp);
    //emit LogEvent("Funktion wurde aufgerufen", block.timestamp);

    receive() external payable {}
}