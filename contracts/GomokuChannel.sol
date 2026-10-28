// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Teaching-only points ledger; one freely created address can mint 1000 points once.
contract GomokuChannel is EIP712 {
    enum State { None, Invited, Active, Dispute, Settled, Cancelled }
    struct Channel {
        address black;
        address white;
        uint256 stake;
        State status;
        uint256 deadline;
        bytes moves;
        uint8 winner;
        uint8 reason;
    }
    uint256 public immutable challengePeriod;
    uint256 public immutable invitePeriod;
    mapping(address => uint256) public points;
    mapping(address => bool) public registered;
    mapping(bytes32 => Channel) internal _channels;
    uint256 public totalIssued;
    uint256 public totalLocked;
    bytes32 private constant STATE_TYPEHASH = keccak256("State(bytes32 channelId,bytes32 movesHash)");

    event Registered(address indexed player, uint256 points);
    event ChannelOpened(bytes32 indexed id, address indexed black, address indexed white, uint256 stake);
    event ChannelJoined(bytes32 indexed id);
    event CheckpointChallenged(bytes32 indexed id, uint256 movesCount, uint256 deadline);
    event ForcedMove(bytes32 indexed id, uint8 position);
    event ChannelSettled(bytes32 indexed id, uint8 winner, uint8 reason, uint256 blackPoints, uint256 whitePoints);
    event ChannelCancelled(bytes32 indexed id);

    constructor(uint256 challengePeriod_, uint256 invitePeriod_) EIP712("GomokuChannel", "1") {
        require(challengePeriod_ > 0 && invitePeriod_ > 0, "zero period");
        challengePeriod = challengePeriod_;
        invitePeriod = invitePeriod_;
    }

    function register() external {
        require(!registered[msg.sender], "already registered");
        registered[msg.sender] = true;
        points[msg.sender] = 1000;
        totalIssued += 1000;
        emit Registered(msg.sender, 1000);
    }

    function openChannel(address white, uint256 stake, bytes32 salt) external returns (bytes32 id) {
        require(white != address(0) && white != msg.sender, "invalid white");
        require(registered[msg.sender] && stake > 0 && points[msg.sender] >= stake, "invalid stake");
        id = keccak256(abi.encode(msg.sender, white, salt));
        require(_channels[id].status == State.None, "duplicate channel");
        Channel storage c = _channels[id];
        c.black = msg.sender;
        c.white = white;
        c.stake = stake;
        c.status = State.Invited;
        c.deadline = block.timestamp + invitePeriod;
        points[msg.sender] -= stake;
        totalLocked += stake;
        emit ChannelOpened(id, msg.sender, white, stake);
    }

    function joinChannel(bytes32 id) external {
        Channel storage c = _channels[id];
        require(c.status == State.Invited && msg.sender == c.white, "not invited white");
        require(block.timestamp < c.deadline, "invitation expired");
        require(registered[msg.sender] && points[msg.sender] >= c.stake, "insufficient points");
        points[msg.sender] -= c.stake;
        totalLocked += c.stake;
        c.status = State.Active;
        c.deadline = 0;
        emit ChannelJoined(id);
    }

    function cancelUnjoined(bytes32 id) external {
        Channel storage c = _channels[id];
        require(c.status == State.Invited && msg.sender == c.black, "not invited black");
        require(block.timestamp >= c.deadline, "invitation pending");
        c.status = State.Cancelled;
        points[c.black] += c.stake;
        totalLocked -= c.stake;
        emit ChannelCancelled(id);
    }

    function getChannel(bytes32 id) external view returns (Channel memory) { return _channels[id]; }

    function stateDigest(bytes32 id, bytes calldata moves) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(STATE_TYPEHASH, id, keccak256(moves))));
    }

    function _verify(bytes32 id, bytes calldata moves, bytes calldata sigBlack, bytes calldata sigWhite) internal view {
        bytes32 digest = stateDigest(id, moves);
        Channel storage c = _channels[id];
        require(ECDSA.recover(digest, sigBlack) == c.black, "invalid black signature");
        require(ECDSA.recover(digest, sigWhite) == c.white, "invalid white signature");
    }

    function _member(Channel storage c) internal view {
        require(msg.sender == c.black || msg.sender == c.white, "not a player");
    }

    function _prefix(bytes storage previous, bytes calldata next) internal view {
        require(next.length >= previous.length, "older checkpoint");
        for (uint256 i; i < previous.length; ++i) require(previous[i] == next[i], "incompatible checkpoint");
    }

    function settle(bytes32 id, bytes calldata moves, bytes calldata sigBlack, bytes calldata sigWhite) external {
        Channel storage c = _channels[id];
        require(c.status == State.Active || c.status == State.Dispute, "not live");
        if (c.status == State.Dispute) _prefix(c.moves, moves);
        _verify(id, moves, sigBlack, sigWhite);
        (uint8 winner, bool terminal) = evaluate(moves);
        require(terminal, "not terminal");
        c.moves = moves;
        _finish(id, winner, winner == 0 ? 2 : 1);
    }

    function challenge(bytes32 id, bytes calldata moves, bytes calldata sigBlack, bytes calldata sigWhite) external {
        Channel storage c = _channels[id];
        _member(c);
        require(c.status == State.Active || c.status == State.Dispute, "not live");
        if (c.status == State.Dispute) {
            require(block.timestamp < c.deadline, "challenge expired");
            require(moves.length > c.moves.length, "not newer");
            _prefix(c.moves, moves);
        }
        if (moves.length != 0 || sigBlack.length != 0 || sigWhite.length != 0) _verify(id, moves, sigBlack, sigWhite);
        (uint8 winner, bool terminal) = evaluate(moves);
        c.moves = moves;
        if (terminal) { _finish(id, winner, winner == 0 ? 2 : 1); return; }
        c.status = State.Dispute;
        c.deadline = block.timestamp + challengePeriod;
        emit CheckpointChallenged(id, moves.length, c.deadline);
    }

    function forceMove(bytes32 id, uint8 position) external {
        Channel storage c = _channels[id];
        require(c.status == State.Dispute, "not disputed");
        require(block.timestamp < c.deadline, "challenge expired");
        _applyMove(id, position);
    }

    function _applyMove(bytes32 id, uint8 position) internal {
        Channel storage c = _channels[id];
        require(msg.sender == (c.moves.length % 2 == 0 ? c.black : c.white), "wrong turn");
        bytes memory next = bytes.concat(c.moves, bytes1(position));
        (uint8 winner, bool terminal) = evaluate(next);
        c.moves = next;
        emit ForcedMove(id, position);
        if (terminal) _finish(id, winner, winner == 0 ? 2 : 1);
        else c.deadline = block.timestamp + challengePeriod;
    }

    function claimTimeout(bytes32 id) external {
        Channel storage c = _channels[id];
        _member(c);
        require(c.status == State.Dispute && block.timestamp >= c.deadline, "timeout unavailable");
        _finish(id, c.moves.length % 2 == 0 ? 2 : 1, 3);
    }

    function _finish(bytes32 id, uint8 winner, uint8 reason) internal {
        Channel storage c = _channels[id];
        c.status = State.Settled;
        c.winner = winner;
        c.reason = reason;
        totalLocked -= c.stake * 2;
        if (winner == 0) { points[c.black] += c.stake; points[c.white] += c.stake; }
        else points[winner == 1 ? c.black : c.white] += c.stake * 2;
        emit ChannelSettled(id, winner, reason, points[c.black], points[c.white]);
    }

    /// @notice Replay every move, rejecting occupied cells and all play after the first terminal move.
    function evaluate(bytes memory moves) public pure returns (uint8 winner, bool terminal) {
        require(moves.length <= 225, "too many moves");
        uint8[225] memory board;
        for (uint256 i; i < moves.length; ++i) {
            require(!terminal, "move after terminal");
            uint256 p = uint8(moves[i]);
            require(p < 225, "position out of range");
            require(board[p] == 0, "occupied position");
            uint8 player = uint8(i % 2 + 1);
            board[p] = player;
            if (_wins(board, int256(p / 15), int256(p % 15), player)) { winner = player; terminal = true; }
            else if (i == 224) terminal = true;
        }
    }

    function _wins(uint8[225] memory board, int256 row, int256 col, uint8 player) private pure returns (bool) {
        for (uint256 d; d < 4; ++d) {
            int256 dr = d == 0 ? int256(0) : int256(1);
            int256 dc = d == 1 ? int256(0) : (d == 3 ? int256(-1) : int256(1));
            uint256 count = 1;
            for (int256 sign = -1; sign <= 1; sign += 2) {
                for (int256 step = 1; step <= 4; ++step) {
                    int256 r = row + dr * sign * step;
                    int256 c = col + dc * sign * step;
                    if (r < 0 || r >= 15 || c < 0 || c >= 15 || board[uint256(r * 15 + c)] != player) break;
                    ++count;
                }
            }
            if (count >= 5) return true;
        }
        return false;
    }
}

/// @notice Measurement baseline: identical escrow, rules and automatic final-move payout; every move is a transaction.
contract GomokuOnchainBaseline is GomokuChannel {
    constructor(uint256 challengePeriod_, uint256 invitePeriod_) GomokuChannel(challengePeriod_, invitePeriod_) {}
    function playMove(bytes32 id, uint8 position) external {
        Channel storage c = _channels[id];
        require(c.status == State.Active || c.status == State.Dispute, "not live");
        if (c.status == State.Active) c.status = State.Dispute;
        else require(block.timestamp < c.deadline, "challenge expired");
        _applyMove(id, position);
    }
}
