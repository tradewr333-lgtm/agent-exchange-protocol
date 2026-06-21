import '@nomicfoundation/hardhat-toolbox';
import 'dotenv/config';

const testnetPrivateKey = process.env.BSC_TESTNET_PRIVATE_KEY;
// Same wallet for both networks: fall back to the testnet key for mainnet if a
// dedicated mainnet key is not set (the address is identical).
const mainnetPrivateKey = process.env.BSC_MAINNET_PRIVATE_KEY || process.env.BSC_TESTNET_PRIVATE_KEY;
const testnetAccounts = testnetPrivateKey ? [testnetPrivateKey] : [];
const mainnetAccounts = mainnetPrivateKey ? [mainnetPrivateKey] : [];

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
      accounts: testnetAccounts,
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_RPC_URL ?? 'https://bsc-dataseed.bnbchain.org',
      chainId: 56,
      accounts: mainnetAccounts,
    },
  },
  etherscan: {
    apiKey: {
      bscMainnet: process.env.ETHERSCAN_API_KEY ?? process.env.BSCSCAN_API_KEY ?? '',
      bscTestnet: process.env.ETHERSCAN_API_KEY ?? process.env.BSCSCAN_API_KEY ?? '',
    },
    customChains: [
      {
        network: 'bscMainnet',
        chainId: 56,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api?chainid=56',
          browserURL: 'https://bscscan.com',
        },
      },
      {
        network: 'bscTestnet',
        chainId: 97,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api?chainid=97',
          browserURL: 'https://testnet.bscscan.com',
        },
      },
    ],
  },
};
