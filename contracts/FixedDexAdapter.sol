pragma solidity ^0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IV2Factory { function getPair(address a, address b) external view returns (address); }
interface IV2Router {
    function factory() external view returns (address);
    function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts);
}
/// Only valid after ABI and deployment verification. Local demo uses an explicit mock.
contract FixedDexAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable project;
    address public immutable cash;
    address public immutable token;
    address public immutable router;
    address public immutable factory;
    address public immutable pool;
    constructor(address p, address c, address t, address r, address f, address pair) {
        require(block.chainid == 31337 || block.chainid == 421614, "chain");
        require(p.code.length > 0 && c.code.length > 0 && t.code.length > 0 && r.code.length > 0 && f.code.length > 0 && pair.code.length > 0, "code");
        require(IV2Router(r).factory() == f && IV2Factory(f).getPair(c,t) == pair, "pair");
        project=p; cash=c; token=t; router=r; factory=f; pool=pair;
    }
    function buy(uint256 amount, uint256 minOut, uint256 deadline) external nonReentrant returns (uint256 received) {
        require(msg.sender == project && minOut > 0 && amount > 0 && deadline >= block.timestamp, "policy");
        require(IV2Router(router).factory() == factory && IV2Factory(factory).getPair(cash, token) == pool, "pool");
        uint256 cashBefore = IERC20(cash).balanceOf(address(this));
        IERC20(cash).safeTransferFrom(project, address(this), amount);
        require(IERC20(cash).balanceOf(address(this)) - cashBefore == amount, "deposit");
        IERC20(cash).forceApprove(router, amount);
        address[] memory path = new address[](2); path[0]=cash; path[1]=token;
        uint256 beforeBalance = IERC20(token).balanceOf(project);
        IV2Router(router).swapExactTokensForTokens(amount, minOut, path, project, deadline);
        IERC20(cash).forceApprove(router, 0);
        received = IERC20(token).balanceOf(project)-beforeBalance;
        require(received >= minOut, "output");
        require(IERC20(cash).balanceOf(address(this)) == cashBefore, "spent");
    }
}
