import { ethers } from 'hardhat';
import 'dotenv/config';

const requiredEnv = [
  'AXP_COMMUNITY_WALLET',
  'AXP_TREASURY_WALLET',
  'AXP_FOUNDER_WALLET',
  'AXP_CONTRIBUTORS_WALLET',
  'AXP_INVESTORS_WALLET',
  'AXP_AGENT_INCENTIVES_WALLET',
  'AXP_LIQUIDITY_WALLET',
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

const [deployer] = await ethers.getSigners();
const now = Math.floor(Date.now() / 1000);

console.log(`Deploying AXP contracts from ${deployer.address}`);

const FounderVesting = await ethers.getContractFactory('AXPFounderVesting');
const founderVesting = await FounderVesting.deploy(process.env.AXP_FOUNDER_WALLET, now);
await founderVesting.waitForDeployment();

const Token = await ethers.getContractFactory('AXPToken');
const token = await Token.deploy(deployer.address);
await token.waitForDeployment();

const Registry = await ethers.getContractFactory('AXPAgentRegistry');
const registry = await Registry.deploy(deployer.address);
await registry.waitForDeployment();

const Staking = await ethers.getContractFactory('AXPStaking');
const staking = await Staking.deploy(
  await token.getAddress(),
  deployer.address,
  process.env.AXP_TREASURY_WALLET,
  process.env.AXP_TREASURY_WALLET,
  process.env.AXP_TREASURY_WALLET,
);
await staking.waitForDeployment();

const ParticipationVault = await ethers.getContractFactory('AXPParticipationVault');
const participationVault = await ParticipationVault.deploy(
  await token.getAddress(),
  deployer.address,
  process.env.AXP_TREASURY_WALLET,
  ethers.ZeroAddress,
  true,
  ethers.parseEther('1000000'),
  ethers.parseEther('0.5'),
);
await participationVault.waitForDeployment();

const transfers = [
  ['community', process.env.AXP_COMMUNITY_WALLET, '280000000'],
  ['treasury', process.env.AXP_TREASURY_WALLET, '200000000'],
  ['founderVesting', await founderVesting.getAddress(), '100000000'],
  ['contributors', process.env.AXP_CONTRIBUTORS_WALLET, '100000000'],
  ['investors', process.env.AXP_INVESTORS_WALLET, '150000000'],
  ['agentIncentives', process.env.AXP_AGENT_INCENTIVES_WALLET, '100000000'],
  ['liquidity', process.env.AXP_LIQUIDITY_WALLET, '50000000'],
  ['participationVault', await participationVault.getAddress(), '20000000'],
];

for (const [label, recipient, amount] of transfers) {
  const tx = await token.transfer(recipient, ethers.parseEther(amount));
  await tx.wait();
  console.log(`Transferred ${amount} AXP to ${label}: ${recipient}`);
}

console.log({
  network: 'bscTestnet',
  deployer: deployer.address,
  token: await token.getAddress(),
  founderVesting: await founderVesting.getAddress(),
  registry: await registry.getAddress(),
  staking: await staking.getAddress(),
  participationVault: await participationVault.getAddress(),
});
