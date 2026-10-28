import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
let compiled;

export function compile(contractName = 'GomokuChannel') {
  if (!compiled) {
    const input = { language: 'Solidity', sources: { 'contracts/GomokuChannel.sol': { content: fs.readFileSync(path.join(root, 'contracts/GomokuChannel.sol'), 'utf8') } }, settings };
    const output = JSON.parse(solc.compile(JSON.stringify(input), { import(importPath) {
      const resolved = path.resolve(root, 'node_modules', importPath);
      if (!resolved.startsWith(path.join(root, 'node_modules') + path.sep)) return { error: 'Import outside local node_modules' };
      try { return { contents: fs.readFileSync(resolved, 'utf8') }; }
      catch { return { error: `Local import not found: ${importPath}` }; }
    } }));
    const errors = (output.errors ?? []).filter(error => error.severity === 'error');
    if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
    compiled = output.contracts['contracts/GomokuChannel.sol'];
  }
  const result = compiled[contractName];
  if (!result) throw new Error(`Unknown contract: ${contractName}`);
  return { contractName, sourceName: 'contracts/GomokuChannel.sol', compiler: solc.version(), settings, abi: result.abi, bytecode: `0x${result.evm.bytecode.object}`, deployedBytecode: `0x${result.evm.deployedBytecode.object}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.join(root, 'artifacts/contracts');
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['GomokuChannel', 'GomokuOnchainBaseline']) {
    const artifact = compile(name);
    fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(artifact, null, 2) + '\n');
    console.log(`${name}: ${artifact.bytecode.length / 2 - 1} bytes; solc ${artifact.compiler}; Shanghai; optimizer 200`);
  }
}
