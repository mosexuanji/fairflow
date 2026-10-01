pragma solidity ^0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface IAlgebraFactory { function poolByPair(address,address) external view returns(address); }
interface IAlgebraRouter {
    struct ExactInputSingleParams { address tokenIn; address tokenOut; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 limitSqrtPrice; }
    function factory() external view returns(address);
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns(uint256);
}
/// Prepared from read-only verified ABI. Public pool and swaps remain untested/unauthorized.
contract FixedAlgebraAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable project; address public immutable cash; address public immutable token;
    address public immutable router; address public immutable factory; address public immutable pool;
    uint160 public immutable limitSqrtPrice;
    constructor(address p,address c,address t,address r,address f,address pair,uint160 sqrtLimit) {
        require(block.chainid==31337 || block.chainid==421614,"chain");
        require(p.code.length>0 && c.code.length>0 && t.code.length>0 && r.code.length>0 && f.code.length>0 && pair.code.length>0,"code");
        require(IAlgebraRouter(r).factory()==f && IAlgebraFactory(f).poolByPair(c,t)==pair,"pair");
        project=p;cash=c;token=t;router=r;factory=f;pool=pair;limitSqrtPrice=sqrtLimit;
    }
    function buy(uint256 amount,uint256 minOut,uint256 deadline) external nonReentrant returns(uint256 received) {
        require(msg.sender==project && amount>0 && minOut>0 && deadline>=block.timestamp,"policy");
        require(IAlgebraRouter(router).factory()==factory && IAlgebraFactory(factory).poolByPair(cash,token)==pool,"pool");
        uint256 cashBefore=IERC20(cash).balanceOf(address(this));
        IERC20(cash).safeTransferFrom(project,address(this),amount);
        require(IERC20(cash).balanceOf(address(this))-cashBefore==amount,"deposit");
        uint256 beforeBalance=IERC20(token).balanceOf(project);
        IERC20(cash).forceApprove(router,amount);
        IAlgebraRouter(router).exactInputSingle(IAlgebraRouter.ExactInputSingleParams(cash,token,project,deadline,amount,minOut,limitSqrtPrice));
        IERC20(cash).forceApprove(router,0);
        require(IERC20(cash).balanceOf(address(this))==cashBefore,"spent");
        received=IERC20(token).balanceOf(project)-beforeBalance;require(received>=minOut,"output");
    }
}
