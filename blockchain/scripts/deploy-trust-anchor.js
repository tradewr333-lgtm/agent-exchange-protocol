import hardhat from 'hardhat';
import 'dotenv/config';

const { ethers } = hardhat;

const [deployer] = await ethers.getSigners();
const network = await ethers.provider.getNetwork();

if (network.chainId === 56n && process.env.AXP_CONFIRM_MAINNET_DEPLOY !== 'YES_I_UNDERSTAND') {
  throw new Error('Mainnet deploy blocked. Set AXP_CONFIRM_MAINNET_DEPLOY=YES_I_UNDERSTAND only after final review.');
}

console.log(`Deploying AXPTrustAnchor from ${deployer.address} on chain ${network.chainId}`);

const TrustAnchor = await ethers.getContractFactory('AXPTrustAnchor');
const trustAnchor = await TrustAnchor.deploy(deployer.address);
await trustAnchor.waitForDeployment();

console.log(JSON.stringify({
  network: network.chainId === 56n ? 'bscMainnet' : 'bscTestnet',
  chainId: network.chainId.toString(),
  deployer: deployer.address,
  trustAnchor: await trustAnchor.getAddress(),
}, null, 2));
