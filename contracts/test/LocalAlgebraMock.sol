pragma solidity ^0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAlgebraRouter} from "../FixedAlgebraAdapter.sol";
/// ABI-shaped local fixture. Not an AMM or official pool.
contract LocalAlgebraMock {
    using SafeERC20 for IERC20;
    address public immutable cash;address public immutable token;address public immutable controller;
    address public pool;bool public failure;
    constructor(address c,address t){require(block.chainid==31337);cash=c;token=t;controller=msg.sender;pool=address(this);}
    function factory() external view returns(address){return address(this);}
    function poolByPair(address a,address b) external view returns(address){return ((a==cash&&b==token)||(a==token&&b==cash))?pool:address(0);}
    function setMode(bool fail,bool missing) external{require(msg.sender==controller);failure=fail;pool=missing?address(0):address(this);}
    function exactInputSingle(IAlgebraRouter.ExactInputSingleParams calldata p) external payable returns(uint256 amountOut){
        require(!failure&&pool!=address(0)&&p.tokenIn==cash&&p.tokenOut==token&&p.deadline>=block.timestamp&&msg.value==0,"mock");
        amountOut=p.amountIn*1e13;require(amountOut>=p.amountOutMinimum,"slippage");
        IERC20(cash).safeTransferFrom(msg.sender,address(this),p.amountIn);IERC20(token).safeTransfer(p.recipient,amountOut);
    }
}
