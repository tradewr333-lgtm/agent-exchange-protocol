import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import hardhat from 'hardhat';
import 'dotenv/config';

const { ethers } = hardhat;

const apiKey = process.env.ETHERSCAN_API_KEY ?? process.env.BSCSCAN_API_KEY;
if (!apiKey) {
  throw new Error('Missing ETHERSCAN_API_KEY or BSCSCAN_API_KEY in .env');
}

const deployer = '0x4c182480c3559A15311FdeB075C1d7af9D4D8854';
const treasury = deployer;
const contracts = [
  {
    name: 'AXPToken',
    source: 'contracts/AXPToken.sol',
    address: '0x88cF3943F6e250C4f15Bc6aFEd5192663b68Eda2',
    args: [deployer],
    argTypes: ['address'],
  },
  {
    name: 'AXPFounderVesting',
    source: 'contracts/AXPFounderVesting.sol',
    address: '0x7C6AB042076468e9e4B45B9caaBB3DD3da5bcD6e',
    args: [deployer, 1781826108],
    argTypes: ['address', 'uint64'],
  },
  {
    name: 'AXPAgentRegistry',
    source: 'contracts/AXPAgentRegistry.sol',
    address: '0x5e91402c50EC9D7655617ec787dc8087f7AB4678',
    args: [deployer],
    argTypes: ['address'],
  },
  {
    name: 'AXPStaking',
    source: 'contracts/AXPStaking.sol',
    address: '0xb3faFa1d03b852DFe9BfDe413efEF856788fd787',
    args: ['0x88cF3943F6e250C4f15Bc6aFEd5192663b68Eda2', deployer, treasury, treasury, treasury],
    argTypes: ['address', 'address', 'address', 'address', 'address'],
  },
  {
    name: 'AXPParticipationVault',
    source: 'contracts/AXPParticipationVault.sol',
    address: '0xF70605341b4f73a5bFa89D363652a973007CC338',
    args: [
      '0x88cF3943F6e250C4f15Bc6aFEd5192663b68Eda2',
      deployer,
      treasury,
      '0x0000000000000000000000000000000000000000',
      true,
      1_000_000n * 10n ** 18n,
      10n ** 16n,
      5n * 10n ** 17n,
    ],
    argTypes: ['address', 'address', 'address', 'address', 'bool', 'uint256', 'uint256', 'uint256'],
  },
];

const buildInfos = readdirSync('artifacts/build-info').map((file) => {
  const path = join('artifacts/build-info', file);
  return { path, data: JSON.parse(readFileSync(path, 'utf8')) };
});

for (const contract of contracts) {
  await sleep(1200);
  const buildInfo = findBuildInfo(contract);
  const compilerVersion = `v${buildInfo.data.solcVersion}`;
  const constructorArguments = ethers.AbiCoder.defaultAbiCoder()
    .encode(contract.argTypes, contract.args)
    .replace(/^0x/, '');

  console.log(`Submitting ${contract.name} at ${contract.address}`);
  const guid = await submitVerificationWithRetry({
    contract,
    buildInfo,
    compilerVersion,
    constructorArguments,
  });

  console.log(`${contract.name} GUID: ${guid}`);
  await waitForStatus(guid, contract.name);
}

async function submitVerificationWithRetry(params) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await submitVerification(params);
    } catch (error) {
      const message = error?.message ?? String(error);
      if (!message.toLowerCase().includes('rate limit') || attempt === 5) {
        throw error;
      }
      await sleep(2500 * attempt);
    }
  }
}

function findBuildInfo(contract) {
  const candidates = buildInfos.filter(({ data }) => data.output.contracts?.[contract.source]?.[contract.name]);
  if (candidates.length === 0) {
    throw new Error(`No build-info found for ${contract.source}:${contract.name}`);
  }

  candidates.sort((a, b) => JSON.stringify(b.data.input).length - JSON.stringify(a.data.input).length);
  return candidates[0];
}

async function submitVerification({ contract, buildInfo, compilerVersion, constructorArguments }) {
  const body = new URLSearchParams({
    module: 'contract',
    action: 'verifysourcecode',
    apikey: apiKey,
    contractaddress: contract.address,
    sourceCode: JSON.stringify(buildInfo.data.input),
    codeformat: 'solidity-standard-json-input',
    contractname: `${contract.source}:${contract.name}`,
    compilerversion: compilerVersion,
    constructorArguements: constructorArguments,
  });

  const response = await fetch('https://api.etherscan.io/v2/api?chainid=56', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = await response.json();
  if (result.status !== '1') {
    const message = `${result.message}: ${result.result}`;
    if (message.toLowerCase().includes('already verified')) {
      return 'already-verified';
    }
    throw new Error(`${contract.name} submit failed: ${message}`);
  }
  return result.result;
}

async function waitForStatus(guid, contractName) {
  if (guid === 'already-verified') {
    console.log(`${contractName} already verified.`);
    return;
  }

  for (let attempt = 1; attempt <= 18; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const url = new URL('https://api.etherscan.io/v2/api');
    url.searchParams.set('chainid', '56');
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'checkverifystatus');
    url.searchParams.set('guid', guid);
    url.searchParams.set('apikey', apiKey);

    const response = await fetch(url);
    const result = await response.json();
    console.log(`${contractName} status ${attempt}: ${result.message} - ${result.result}`);
    if (result.status === '1') return;
    if (!String(result.result).toLowerCase().includes('pending')) return;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
