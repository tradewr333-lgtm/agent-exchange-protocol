import '@nomicfoundation/hardhat-toolbox';
import 'dotenv/config';

const deployerPrivateKey = process.env.BSC_TESTNET_PRIVATE_KEY;
const accounts = deployerPrivateKey ? [deployerPrivateKey] : [];

export default {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL ?? 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
      chainId: 97,
      accounts,
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_RPC_URL ?? 'https://bsc-dataseed.bnbchain.org',
      chainId: 56,
      accounts,
    },
  },
};
