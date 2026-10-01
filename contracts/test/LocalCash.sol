pragma solidity ^0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// Explicit local-only fake test cash, NOT official USDG or a public faucet.
contract LocalCash is ERC20 {
    bool public transfersFail;
    address public immutable controller;
    constructor() ERC20("LOCAL MOCK cash", "LOCAL") { require(block.chainid == 31337); controller=msg.sender; }
    function decimals() public pure override returns(uint8) { return 6; }
    function faucet(address to, uint256 value) external { require(msg.sender==controller); _mint(to,value); }
    function setFail(bool fail) external { require(msg.sender==controller); transfersFail=fail; }
    function _update(address from,address to,uint256 value) internal override {
        require(!transfersFail || from==address(0), "mock transfer failure"); super._update(from,to,value);
    }
}
