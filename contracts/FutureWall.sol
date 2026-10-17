// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Future Wall
/// @notice Letters to the future. Each letter is timelock-encrypted to a drand
///         quicknet round in the writer's browser, so nobody (not even the
///         people who run this contract) can read it before that moment.
///         Every letter is an NFT envelope that renders itself on-chain and
///         turns into the letter once it has been opened.
contract FutureWall is ERC721, Ownable {
    using Strings for uint256;

    // drand quicknet (bls-unchained-g1-rfc9380), the mainnet network tlock uses.
    uint256 public constant DRAND_GENESIS = 1692803367;
    uint256 public constant DRAND_PERIOD = 3;

    uint256 public constant GENESIS_SUPPLY = 1000;
    uint256 public constant MIN_LOCK = 1 hours;
    uint256 public constant MAX_LOCK = 100 * 365 days;
    uint256 public constant MAX_CIPHERTEXT = 6000;
    uint256 public constant MAX_TEXT = 1200;

    struct Letter {
        uint64 round;
        uint64 unlockTime;
        uint64 sealedAt;
        bool revealed;
        bytes32 commitment; // keccak256(abi.encodePacked(salt, text))
    }

    uint256 public fee;
    uint256 public totalSealed;
    mapping(uint256 => Letter) private _letters;
    mapping(uint256 => string) private _texts;
    mapping(uint256 => bytes) private _ciphertexts;
    /// @notice how many letters are waiting for (or opened in) each UTC year
    mapping(uint256 => uint256) public lettersForYear;

    event Sealed(
        uint256 indexed id,
        address indexed writer,
        uint64 round,
        uint64 unlockTime
    );
    event Opened(uint256 indexed id, address indexed opener, string text);
    event FeeChanged(uint256 fee);

    error FeeTooLow();
    error BadRound();
    error TooLong();
    error NotYet();
    error AlreadyOpen();
    error WrongText();
    error NoLetter();

    constructor(address owner_, uint256 fee_) ERC721("Future Wall", "FWALL") Ownable(owner_) {
        fee = fee_;
        emit FeeChanged(fee_);
    }

    // ---------------------------------------------------------------- writing

    function seal(uint64 round, bytes32 commitment, bytes calldata ciphertext)
        external
        payable
        returns (uint256 id)
    {
        if (msg.value < fee) revert FeeTooLow();
        if (ciphertext.length == 0 || ciphertext.length > MAX_CIPHERTEXT) revert TooLong();
        if (round == 0) revert BadRound();

        uint256 unlock = roundTime(round);
        if (unlock < block.timestamp + MIN_LOCK || unlock > block.timestamp + MAX_LOCK) revert BadRound();

        id = ++totalSealed;
        _letters[id] = Letter({
            round: round,
            unlockTime: uint64(unlock),
            sealedAt: uint64(block.timestamp),
            revealed: false,
            commitment: commitment
        });
        _ciphertexts[id] = ciphertext;
        (uint256 y,,) = _date(unlock);
        lettersForYear[y]++;
        _safeMint(msg.sender, id);
        emit Sealed(id, msg.sender, round, uint64(unlock));
    }

    /// @notice After the unlock time anyone holding the drand beacon can decrypt
    ///         the letter. Publishing it here turns the envelope into the letter.
    function open(uint256 id, bytes32 salt, string calldata text) external {
        Letter storage l = _letters[id];
        if (l.round == 0) revert NoLetter();
        if (block.timestamp < l.unlockTime) revert NotYet();
        if (l.revealed) revert AlreadyOpen();
        if (bytes(text).length > MAX_TEXT) revert TooLong();
        if (keccak256(abi.encodePacked(salt, text)) != l.commitment) revert WrongText();
        l.revealed = true;
        _texts[id] = text;
        emit Opened(id, msg.sender, text);
    }

    // ---------------------------------------------------------------- views

    function roundTime(uint256 round) public pure returns (uint256) {
        return DRAND_GENESIS + (round - 1) * DRAND_PERIOD;
    }

    function letter(uint256 id) external view returns (Letter memory l, string memory text) {
        l = _letters[id];
        if (l.round == 0) revert NoLetter();
        text = _texts[id];
    }

    function ciphertextOf(uint256 id) external view returns (bytes memory) {
        if (_letters[id].round == 0) revert NoLetter();
        return _ciphertexts[id];
    }

    // ---------------------------------------------------------------- owner

    function setFee(uint256 fee_) external onlyOwner {
        fee = fee_;
        emit FeeChanged(fee_);
    }

    function withdraw() external onlyOwner {
        (bool ok,) = owner().call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    // ---------------------------------------------------------------- art

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        Letter memory l = _letters[id];
        (uint256 y, uint256 m, uint256 d) = _date(l.unlockTime);
        string memory dateStr = string.concat(y.toString(), "-", _two(m), "-", _two(d));
        bool genesis = id <= GENESIS_SUPPLY;
        bool newYear = m == 1 && d == 1;
        string memory status = l.revealed ? "Opened" : (block.timestamp >= l.unlockTime ? "Ready" : "Sealed");
        string memory sealKind = genesis ? "Genesis" : (newYear ? "New Year" : "Classic");

        string memory svg = l.revealed ? _openSvg(id, dateStr, _texts[id]) : _sealedSvg(id, dateStr, genesis, newYear, status);

        string memory json = string.concat(
            '{"name":"Future Letter #', id.toString(),
            '","description":"A letter locked until ', dateStr,
            ' UTC with drand timelock encryption. Nobody could read it before then.",',
            '"attributes":[{"trait_type":"Opens","value":"', dateStr,
            '"},{"trait_type":"Status","value":"', status,
            '"},{"trait_type":"Seal","value":"', sealKind,
            '"},{"trait_type":"Opens Year","display_type":"number","value":', y.toString(),
            '}],"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _sealedSvg(uint256 id, string memory dateStr, bool genesis, bool newYear, string memory status)
        internal
        pure
        returns (string memory)
    {
        string memory wax = genesis ? "#c9a24a" : (newYear ? "#3f6fb5" : "#9b2c2c");
        string memory waxDark = genesis ? "#8a6a22" : (newYear ? "#244a80" : "#651a1a");
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">',
            '<defs><radialGradient id="w" cx="40%" cy="35%"><stop offset="0" stop-color="', wax,
            '"/><stop offset="1" stop-color="', waxDark, '"/></radialGradient>',
            '<linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3e9d6"/><stop offset="1" stop-color="#e2d3b6"/></linearGradient></defs>',
            '<rect width="600" height="600" fill="#0e1320"/>',
            _stars(id),
            '<rect x="90" y="170" width="420" height="270" rx="10" fill="url(#p)"/>',
            '<path d="M90 180 L300 330 L510 180" fill="none" stroke="#c8b590" stroke-width="3"/>',
            '<path d="M90 440 L250 300 M510 440 L350 300" stroke="#d3c3a1" stroke-width="2"/>',
            '<circle cx="300" cy="330" r="46" fill="url(#w)"/>',
            '<circle cx="300" cy="330" r="34" fill="none" stroke="', waxDark, '" stroke-width="3"/>',
            '<text x="300" y="342" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#f3e9d6">',
            genesis ? unicode"✦" : (newYear ? unicode"✷" : unicode"❦"),
            '</text>',
            '<text x="300" y="110" text-anchor="middle" font-family="Georgia,serif" font-size="22" fill="#e9dfc9" letter-spacing="6">FUTURE WALL</text>',
            '<text x="300" y="500" text-anchor="middle" font-family="Georgia,serif" font-size="18" fill="#9fa8bf">', keccak256(bytes(status)) == keccak256("Ready") ? "Ready to open since" : "Sealed until", '</text>',
            '<text x="300" y="535" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#f3e9d6">', dateStr, '</text>',
            '<text x="500" y="420" text-anchor="end" font-family="Georgia,serif" font-size="16" fill="#8f7d5c">No. ', id.toString(), '</text>',
            '</svg>'
        );
    }

    function _openSvg(uint256 id, string memory dateStr, string memory text) internal pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">',
            '<rect width="600" height="600" fill="#0e1320"/>',
            _stars(id),
            '<rect x="60" y="50" width="480" height="500" rx="8" fill="#f3e9d6"/>',
            '<foreignObject x="90" y="80" width="420" height="400"><div xmlns="http://www.w3.org/1999/xhtml" dir="auto" ',
            'style="font-family:Georgia,serif;font-size:19px;line-height:1.55;color:#2b2418;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;height:400px">',
            _escape(text),
            '</div></foreignObject>',
            '<text x="510" y="525" text-anchor="end" font-family="Georgia,serif" font-size="15" fill="#8f7d5c">Opened ', dateStr, unicode" · No. ", id.toString(), '</text>',
            '</svg>'
        );
    }

    function _stars(uint256 id) internal pure returns (string memory out) {
        uint256 h = uint256(keccak256(abi.encodePacked("stars", id)));
        for (uint256 i = 0; i < 14; i++) {
            uint256 x = 15 + (h & 0x3ff) % 570;
            uint256 yy = 15 + ((h >> 10) & 0x3ff) % 140;
            uint256 r = 1 + ((h >> 20) & 1);
            out = string.concat(out, '<circle cx="', x.toString(), '" cy="', yy.toString(), '" r="', r.toString(), '" fill="#cfd6ea" opacity="0.7"/>');
            h = uint256(keccak256(abi.encodePacked(h)));
        }
    }

    /// @dev Escapes XML special characters and replaces control characters that
    ///      XML forbids, so a letter can never break out of the SVG.
    function _escape(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 extra;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") extra += 4;
            else if (c == "<" || c == ">") extra += 3;
            else if (c == '"' || c == "'") extra += 4;
        }
        bytes memory o = new bytes(b.length + extra);
        uint256 j;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") { o[j++] = "&"; o[j++] = "a"; o[j++] = "m"; o[j++] = "p"; o[j++] = ";"; }
            else if (c == "<") { o[j++] = "&"; o[j++] = "l"; o[j++] = "t"; o[j++] = ";"; }
            else if (c == ">") { o[j++] = "&"; o[j++] = "g"; o[j++] = "t"; o[j++] = ";"; }
            else if (c == '"') { o[j++] = "&"; o[j++] = "#"; o[j++] = "3"; o[j++] = "4"; o[j++] = ";"; }
            else if (c == "'") { o[j++] = "&"; o[j++] = "#"; o[j++] = "3"; o[j++] = "9"; o[j++] = ";"; }
            else if (uint8(c) < 0x20 && c != 0x0a && c != 0x09) { o[j++] = " "; }
            else { o[j++] = c; }
        }
        return string(o);
    }

    function _two(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", v.toString()) : v.toString();
    }

    /// @dev Unix timestamp -> civil date (Howard Hinnant's algorithm).
    function _date(uint256 ts) internal pure returns (uint256 y, uint256 m, uint256 d) {
        int256 z = int256(ts / 86400) + 719468;
        int256 era = z / 146097;
        int256 doe = z - era * 146097;
        int256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        int256 yy = yoe + era * 400;
        int256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        int256 mp = (5 * doy + 2) / 153;
        d = uint256(doy - (153 * mp + 2) / 5 + 1);
        m = uint256(mp < 10 ? mp + 3 : mp - 9);
        y = uint256(m <= 2 ? yy + 1 : yy);
    }
}
