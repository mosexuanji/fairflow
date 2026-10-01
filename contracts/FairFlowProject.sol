pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IssuanceMath} from "./IssuanceMath.sol";
import {ProjectToken} from "./ProjectToken.sol";
import {Receipt} from "./Receipt.sol";

interface IFixedBuyback {
    function buy(uint256 amount, uint256 minOut, uint256 deadline) external returns (uint256);
    function cash() external view returns (address);
    function token() external view returns (address);
    function project() external view returns (address);
}

/// Private local candidate implementation, not finalized public issuance terms.
contract FairFlowProject is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Role { Initiator, Builder, Promoter, User }
    enum ActorType { Human, Agent, Organization }
    enum TaskStatus { Open, Accepted, Submitted, Completed, Canceled }
    enum ContributionStatus { Submitted, Validated, Finalized, Rejected, Expired }
    enum OrderStatus { Funded, Delivered, Settled, Refunded }

    struct Rule { uint128 credits; bytes32 evidenceSchema; string uri; }
    struct Task {
        bytes32 behaviorId; uint32 version; Role role; uint128 credits;
        uint256 reward; uint64 expiresAt; address sponsor; address assignee;
        TaskStatus status; bytes32 evidenceSchema; string uri; uint256 contributionId;
    }
    struct Contribution {
        uint256 taskId; address actor; address operator; address beneficiary;
        ActorType actorType; Role role; ContributionStatus status;
        uint64 submittedAt; uint64 validatedAt; uint64 finalizedAt;
        uint128 credits; uint256 minted; uint256 progressBefore; bytes32 digest; string uri;
    }
    struct Order {
        address buyer; uint256 price; uint64 deadline; OrderStatus status;
        bytes32 formatDigest; bytes32 resultDigest; string uri;
    }

    address public immutable owner;
    address public immutable reviewer;
    address public immutable serviceProvider;
    address public immutable operationsRecipient;
    IERC20 public immutable cash;
    ProjectToken public immutable token;
    Receipt public immutable receipt;
    string public name;
    string public templateURI;
    bytes32 public immutable templateDigest;
    uint256 public immutable band;
    uint256 public immutable qFirst;
    uint64 public immutable reviewDelay;
    uint16 public immutable buybackBps;
    uint256 public immutable maxTaskCredits;
    uint256 public cumulativeRecognizedUnits;
    uint256 public grossIssued;
    uint32 public policyVersion;
    uint256 public taskCount;
    uint256 public contributionCount;
    uint256 public orderCount;
    uint256 public bountyReserved;
    uint256 public bountyClaimable;
    uint256 public refundableServices;
    uint256 public operationsBudget;
    uint256 public buybackBudget;
    uint256 public settledRevenue;
    address public adapter;
    address public keeper;
    uint256 public maxCashPerBuy;
    uint256 public maxCashAtomsPerToken; // cash atoms for one 1e18-token unit

    mapping(uint32 => mapping(Role => Rule)) public rules;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => Contribution) public contributions;
    mapping(uint256 => Order) public orders;
    mapping(bytes32 => bool) public recognizedBehavior;
    mapping(uint256 => uint256) public claimable;
    mapping(uint256 => bool) public taskRefunded;
    mapping(bytes32 => bool) public orderKeys;
    event PolicyPublished(uint32 indexed version, bytes32 digest, string uri);
    event TaskCreated(uint256 indexed id, bytes32 indexed behaviorId, uint32 version);
    event TaskAccepted(uint256 indexed id, address indexed actor);
    event ContributionSubmitted(uint256 indexed id, uint256 indexed taskId, bytes32 digest);
    event ContributionChanged(uint256 indexed id, ContributionStatus status);
    event Finalized(uint256 indexed id, uint256 beforeCredits, uint256 addedCredits, uint256 minted);
    event BountyClaimed(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event TaskRefunded(uint256 indexed id, uint256 amount);
    event OrderChanged(uint256 indexed id, OrderStatus status);
    event SwapBurn(uint256 spent, uint256 received, uint256 credits, uint256 gross);
    error Invalid(); error Unauthorized(); error BadState(); error Duplicate(); error Expired();
    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier onlyReviewer(uint256 id) {
        Contribution storage c = contributions[id];
        if (id == 0 || id > contributionCount || msg.sender != reviewer || msg.sender == c.actor || msg.sender == c.operator || msg.sender == c.beneficiary) revert Unauthorized(); _;
    }

    constructor(string memory projectName, address cashToken, address reviewAddress,
        address provider, address opsRecipient, uint256 h, uint256 q, uint64 delaySeconds,
        uint16 splitBps, uint256 taskLimit, string memory template, bytes32 templateHash) {
        if (block.chainid != 31337 && block.chainid != 421614) revert Invalid();
        if (cashToken.code.length == 0 || reviewAddress == address(0) || provider == address(0)
            || opsRecipient == address(0) || splitBps > 10000 || delaySeconds == 0
            || taskLimit == 0 || taskLimit > type(uint64).max || templateHash == bytes32(0)) revert Invalid();
        IssuanceMath.cumulative(0, h, q);
        owner = msg.sender; reviewer = reviewAddress; serviceProvider = provider;
        operationsRecipient = opsRecipient; cash = IERC20(cashToken);
        band = h; qFirst = q; reviewDelay = delaySeconds; buybackBps = splitBps;
        maxTaskCredits = taskLimit; name = projectName; templateURI = template; templateDigest = templateHash;
        token = new ProjectToken(projectName, "FFT", address(this));
        receipt = new Receipt(address(this));
    }

    function publishPolicy(uint128[4] calldata credits, bytes32[4] calldata schemas, string[4] calldata uris,
        bytes32 policyDigest, string calldata policyURI) external onlyOwner {
        if (policyDigest == bytes32(0) || bytes(policyURI).length == 0) revert Invalid();
        ++policyVersion;
        for (uint8 i; i < 4; ++i) {
            if (credits[i] == 0 || credits[i] > maxTaskCredits || schemas[i] == bytes32(0) || bytes(uris[i]).length == 0) revert Invalid();
            rules[policyVersion][Role(i)] = Rule(credits[i], schemas[i], uris[i]);
        }
        emit PolicyPublished(policyVersion, policyDigest, policyURI);
    }

    // Only project owner defines canonical work identities; contributor cannot invent a nonce.
    function createTask(bytes32 behaviorId, Role role, uint256 reward, uint64 expiresAt, string calldata uri)
        external onlyOwner nonReentrant returns (uint256 id) {
        if (policyVersion == 0 || behaviorId == bytes32(0) || expiresAt <= block.timestamp + reviewDelay || bytes(uri).length == 0) revert Invalid();
        Rule storage rule = rules[policyVersion][role];
        if (reward != 0) _deposit(msg.sender, reward);
        bountyReserved += reward;
        id = ++taskCount;
        tasks[id] = Task(behaviorId, policyVersion, role, rule.credits, reward, expiresAt, msg.sender,
            address(0), TaskStatus.Open, rule.evidenceSchema, uri, 0);
        emit TaskCreated(id, behaviorId, policyVersion);
    }
    function acceptTask(uint256 id) external {
        Task storage t = _task(id);
        if (t.status != TaskStatus.Open) revert BadState();
        if (block.timestamp >= t.expiresAt) revert Expired();
        t.assignee = msg.sender; t.status = TaskStatus.Accepted;
        emit TaskAccepted(id, msg.sender);
    }
    function submit(uint256 taskId, ActorType kind, address operator, address beneficiary, bytes32 digest, string calldata uri)
        external returns (uint256 id) {
        Task storage t = _task(taskId);
        if (t.status != TaskStatus.Accepted || t.assignee != msg.sender) revert Unauthorized();
        if (block.timestamp >= t.expiresAt) revert Expired();
        if (operator == address(0) || beneficiary == address(0) || digest == bytes32(0) || bytes(uri).length == 0) revert Invalid();
        id = ++contributionCount; t.status = TaskStatus.Submitted; t.contributionId = id;
        contributions[id] = Contribution(taskId, msg.sender, operator, beneficiary, kind, t.role,
            ContributionStatus.Submitted, uint64(block.timestamp), 0, 0, t.credits, 0, 0, digest, uri);
        emit ContributionSubmitted(id, taskId, digest);
    }
    function validate(uint256 id) external onlyReviewer(id) {
        Contribution storage c = contributions[id];
        if (c.status != ContributionStatus.Submitted) revert BadState();
        if (block.timestamp + reviewDelay >= tasks[c.taskId].expiresAt) revert Expired();
        c.status = ContributionStatus.Validated; c.validatedAt = uint64(block.timestamp);
        emit ContributionChanged(id, c.status);
    }
    function reject(uint256 id) external onlyReviewer(id) {
        Contribution storage c = contributions[id];
        if (c.status != ContributionStatus.Submitted && c.status != ContributionStatus.Validated) revert BadState();
        c.status = ContributionStatus.Rejected; tasks[c.taskId].status = TaskStatus.Canceled;
        emit ContributionChanged(id, c.status);
    }
    function finalize(uint256 id) external nonReentrant {
        if (id == 0 || id > contributionCount) revert Invalid();
        Contribution storage c = contributions[id]; Task storage t = tasks[c.taskId];
        if (c.status != ContributionStatus.Validated || block.timestamp < c.validatedAt + reviewDelay) revert BadState();
        if (block.timestamp >= t.expiresAt) revert Expired();
        if (recognizedBehavior[t.behaviorId]) revert Duplicate();
        uint256 beforeCredits = cumulativeRecognizedUnits;
        uint256 afterCredits = beforeCredits + c.credits;
        uint256 nextGross = IssuanceMath.cumulative(afterCredits, band, qFirst);
        uint256 minted = nextGross - grossIssued;
        recognizedBehavior[t.behaviorId] = true;
        cumulativeRecognizedUnits = afterCredits; grossIssued = nextGross;
        c.status = ContributionStatus.Finalized; c.finalizedAt = uint64(block.timestamp);
        c.progressBefore = beforeCredits; c.minted = minted; t.status = TaskStatus.Completed;
        bountyReserved -= t.reward; bountyClaimable += t.reward; claimable[id] = t.reward;
        token.mint(c.beneficiary, minted); receipt.mint(c.beneficiary, id, c.uri);
        emit Finalized(id, beforeCredits, c.credits, minted); emit ContributionChanged(id, c.status);
    }
    function expire(uint256 taskId) external {
        Task storage t = _task(taskId);
        if (block.timestamp < t.expiresAt) revert BadState();
        if (t.status == TaskStatus.Completed || t.status == TaskStatus.Canceled) revert BadState();
        t.status = TaskStatus.Canceled;
        if (t.contributionId != 0) {
            contributions[t.contributionId].status = ContributionStatus.Expired;
            emit ContributionChanged(t.contributionId, ContributionStatus.Expired);
        }
    }
    function cancelTask(uint256 id) external {
        Task storage t = _task(id);
        if (msg.sender != t.sponsor) revert Unauthorized();
        if (t.status != TaskStatus.Open) revert BadState(); t.status = TaskStatus.Canceled;
    }
    function refundTask(uint256 id) external nonReentrant {
        Task storage t = _task(id);
        if (msg.sender != t.sponsor) revert Unauthorized();
        if (t.status != TaskStatus.Canceled || t.reward == 0 || taskRefunded[id]) revert BadState();
        uint256 amount = t.reward; taskRefunded[id] = true; bountyReserved -= amount;
        cash.safeTransfer(t.sponsor, amount); emit TaskRefunded(id, amount);
    }
    function claimBounty(uint256 id) external nonReentrant {
        Contribution storage c = contributions[id]; uint256 amount = claimable[id];
        if (msg.sender != c.beneficiary) revert Unauthorized(); if (amount == 0) revert BadState();
        claimable[id] = 0; bountyClaimable -= amount;
        cash.safeTransfer(c.beneficiary, amount); emit BountyClaimed(id, c.beneficiary, amount);
    }
    function quote(uint256 credits) external view returns (uint256) {
        return IssuanceMath.cumulative(cumulativeRecognizedUnits + credits, band, qFirst) - grossIssued;
    }

    function placeOrder(bytes32 clientKey, uint256 price, uint64 deadline, bytes32 formatDigest) external nonReentrant returns (uint256 id) {
        bytes32 key = keccak256(abi.encode(msg.sender, clientKey));
        if (clientKey == bytes32(0) || orderKeys[key]) revert Duplicate();
        if (price == 0 || deadline <= block.timestamp || formatDigest == bytes32(0)) revert Invalid();
        _deposit(msg.sender, price); orderKeys[key] = true; refundableServices += price;
        id = ++orderCount; orders[id] = Order(msg.sender, price, deadline, OrderStatus.Funded, formatDigest, bytes32(0), "");
        emit OrderChanged(id, OrderStatus.Funded);
    }
    function deliver(uint256 id, bytes32 resultDigest, string calldata uri) external {
        Order storage o = _order(id);
        if (msg.sender != serviceProvider) revert Unauthorized();
        if (o.status != OrderStatus.Funded) revert BadState();
        if (block.timestamp >= o.deadline) revert Expired();
        if (resultDigest == bytes32(0) || bytes(uri).length == 0) revert Invalid();
        o.resultDigest = resultDigest; o.uri = uri; o.status = OrderStatus.Delivered;
        emit OrderChanged(id, o.status);
    }
    function acceptOrder(uint256 id, bytes32 expectedDigest) external {
        Order storage o = _order(id);
        if (msg.sender != o.buyer) revert Unauthorized();
        if (o.status != OrderStatus.Delivered || expectedDigest != o.resultDigest) revert BadState();
        if (block.timestamp >= o.deadline) revert Expired();
        o.status = OrderStatus.Settled; refundableServices -= o.price; settledRevenue += o.price;
        uint256 buyback = Math.mulDiv(o.price, buybackBps, 10000);
        buybackBudget += buyback; operationsBudget += o.price - buyback;
        emit OrderChanged(id, o.status);
    }
    function refundOrder(uint256 id) external nonReentrant {
        Order storage o = _order(id);
        if (msg.sender != o.buyer) revert Unauthorized();
        if (block.timestamp < o.deadline || (o.status != OrderStatus.Funded && o.status != OrderStatus.Delivered)) revert BadState();
        o.status = OrderStatus.Refunded; refundableServices -= o.price;
        cash.safeTransfer(o.buyer, o.price); emit OrderChanged(id, o.status);
    }
    function withdrawOperations(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > operationsBudget) revert Invalid();
        operationsBudget -= amount; cash.safeTransfer(operationsRecipient, amount);
    }
    // One-time fixed adapter policy. No arbitrary calldata or approval target.
    function configureBuyback(address fixedAdapter, address fixedKeeper, uint256 perBuy, uint256 maxPrice) external onlyOwner {
        if (adapter != address(0) || fixedAdapter.code.length == 0 || fixedKeeper == address(0) || perBuy == 0 || maxPrice == 0) revert Invalid();
        IFixedBuyback a = IFixedBuyback(fixedAdapter);
        if (a.cash() != address(cash) || a.token() != address(token) || a.project() != address(this)) revert Invalid();
        adapter = fixedAdapter; keeper = fixedKeeper; maxCashPerBuy = perBuy; maxCashAtomsPerToken = maxPrice;
    }
    function buyback(uint256 amount, uint256 minOut, uint256 deadline) external nonReentrant returns (uint256 received) {
        if (msg.sender != keeper) revert Unauthorized();
        if (adapter == address(0) || amount == 0 || amount > buybackBudget || amount > maxCashPerBuy
            || minOut == 0 || deadline < block.timestamp || deadline > block.timestamp + 300) revert Invalid();
        // Ceiling protects sub-atom/dust orders. A quote must meet the frozen maximum price.
        if (minOut < Math.mulDiv(amount, 1e18, maxCashAtomsPerToken, Math.Rounding.Ceil)) revert Invalid();
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 cashBefore = cash.balanceOf(address(this));
        buybackBudget -= amount;
        cash.forceApprove(adapter, amount);
        IFixedBuyback(adapter).buy(amount, minOut, deadline);
        cash.forceApprove(adapter, 0);
        if (cashBefore - cash.balanceOf(address(this)) != amount) revert Invalid();
        received = token.balanceOf(address(this)) - beforeBalance;
        if (received < minOut) revert Invalid(); token.burn(received);
        emit SwapBurn(amount, received, cumulativeRecognizedUnits, grossIssued);
    }
    function accountedCash() public view returns (uint256) {
        return bountyReserved + bountyClaimable + refundableServices + operationsBudget + buybackBudget;
    }
    function _deposit(address payer, uint256 amount) private {
        uint256 beforeBalance = cash.balanceOf(address(this)); cash.safeTransferFrom(payer, address(this), amount);
        if (cash.balanceOf(address(this)) - beforeBalance != amount) revert Invalid();
    }
    function _task(uint256 id) private view returns (Task storage t) {
        if (id == 0 || id > taskCount) revert Invalid(); return tasks[id];
    }
    function _order(uint256 id) private view returns (Order storage o) {
        if (id == 0 || id > orderCount) revert Invalid(); return orders[id];
    }
}
