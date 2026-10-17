const solc = require('solc'), fs = require('fs'), path = require('path');
const src = fs.readFileSync('contracts/FutureWall.sol', 'utf8');
const input = { language: 'Solidity', sources: { 'FutureWall.sol': { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
function findImports(p) { try { return { contents: fs.readFileSync(path.join('node_modules', p), 'utf8') }; } catch (e) { return { error: 'not found ' + p }; } }
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
let bad = false;
for (const e of out.errors || []) { console.log(e.formattedMessage); if (e.severity === 'error') bad = true; }
if (bad) process.exit(1);
const c = out.contracts['FutureWall.sol'].FutureWall;
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/FutureWall.json', JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 1));
console.log('runtime bytes', c.evm.deployedBytecode.object.length / 2, 'initcode', c.evm.bytecode.object.length / 2);
