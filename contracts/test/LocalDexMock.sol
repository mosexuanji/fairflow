pragma solidity ^0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
/// Fixed-quote negative-test fixture, NOT a DEX, LP or official integration.
contract LocalDexMock {
    using SafeERC20 for IERC20;
    address public immutable controller; address public immutable cash; address public immutable token;
    address public pair; uint256 public atomsPerCash; bool public fail; bool public reenter;
    constructor(address c,address t,uint256 rate) { require(block.chainid==31337); controller=msg.sender; cash=c; token=t; atomsPerCash=rate; pair=address(this); }
    function factory() external view returns(address) { return address(this); }
    function getPair(address a,address b) external view returns(address) { return ((a==cash && b==token)||(a==token && b==cash)) ? pair : address(0); }
    function setMode(bool failure, bool missing, bool attack) external { require(msg.sender==controller); fail=failure; pair=missing?address(0):address(this); reenter=attack; }
    function swapExactTokensForTokens(uint amount,uint minOut,address[] calldata path,address to,uint deadline) external returns(uint[] memory out) {
        require(!fail && deadline>=block.timestamp && path.length==2 && path[0]==cash && path[1]==token && pair!=address(0), "mock swap failure");
        uint256 received=amount*atomsPerCash; require(received>=minOut, "slippage");
        if(reenter) { (bool success,)=to.call(abi.encodeWithSignature("buyback(uint256,uint256,uint256)",amount,minOut,deadline)); require(success,"reentrancy refused"); }
        IERC20(cash).safeTransferFrom(msg.sender,address(this),amount); IERC20(token).safeTransfer(to,received);
        out=new uint[](2); out[0]=amount; out[1]=received;
    }
}
