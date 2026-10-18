// Compiles the contract and writes the ABI, bytecode and the exact input
// Polygonscan needs to verify it.
//   node compile.js          -> contracts/FutureWall.sol (current version)
//   node compile.js v1       -> v1/FutureWall.sol (the first deployment)
const solc = require('solc'), fs = require('fs'), path = require('path');
const which = process.argv[2] === 'v1' ? 'v1' : 'current';
const srcFile = which === 'v1' ? 'v1/FutureWall.sol' : 'contracts/FutureWall.sol';
const outDir = which === 'v1' ? 'v1' : 'build';

const sources = { 'FutureWall.sol': { content: fs.readFileSync(srcFile, 'utf8') } };
const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun' };
function findImports(p) {
  try { const content = fs.readFileSync(path.join('node_modules', p), 'utf8'); sources[p] = { content }; return { contents: content }; }
  catch (e) { return { error: 'not found ' + p }; }
}
const input = { language: 'Solidity', sources, settings: { ...settings, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
let bad = false;
for (const e of out.errors || []) { console.log(e.formattedMessage); if (e.severity === 'error') bad = true; }
if (bad) process.exit(1);
const c = out.contracts['FutureWall.sol'].FutureWall;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'FutureWall.json'), JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 1));

// standard json input for "Solidity (Standard-Json-Input)" on Polygonscan
const ordered = Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k]]));
const std = { language: 'Solidity', sources: ordered, settings: { ...settings, outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata'] } } } };
fs.mkdirSync('verify', { recursive: true });
fs.writeFileSync(`verify/FutureWall-${which === 'v1' ? 'v1' : 'v2'}.standard.json`, JSON.stringify(std, null, 1));
console.log(which, 'runtime bytes', c.evm.deployedBytecode.object.length / 2, 'initcode', c.evm.bytecode.object.length / 2);
