import hardhat from 'hardhat';
import 'dotenv/config';

const { run } = hardhat;

const contracts = {
  token: '0x88cF3943F6e250C4f15Bc6aFEd5192663b68Eda2',
  founderVesting: '0x7C6AB042076468e9e4B45B9caaBB3DD3da5bcD6e',
  registry: '0x5e91402c50EC9D7655617ec787dc8087f7AB4678',
  staking: '0xb3faFa1d03b852DFe9BfDe413efEF856788fd787',
  vault: '0xF70605341b4f73a5bFa89D363652a973007CC338',
};

const deployer = '0x4c182480c3559A15311FdeB075C1d7af9D4D8854';
const treasury = deployer;
const founderVestingConstructorStart = 1781826108;

const verificationTargets = [
  {
    name: 'AXPToken',
    address: contracts.token,
    constructorArguments: [deployer],
  },
  {
    name: 'AXPFounderVesting',
    address: contracts.founderVesting,
    constructorArguments: [deployer, founderVestingConstructorStart],
  },
  {
    name: 'AXPAgentRegistry',
    address: contracts.registry,
    constructorArguments: [deployer],
  },
  {
    name: 'AXPStaking',
    address: contracts.staking,
    constructorArguments: [contracts.token, deployer, treasury, treasury, treasury],
  },
  {
    name: 'AXPParticipationVault',
    address: contracts.vault,
    constructorArguments: [
      contracts.token,
      deployer,
      treasury,
      '0x0000000000000000000000000000000000000000',
      true,
      1_000_000n * 10n ** 18n,
      10n ** 16n,
      5n * 10n ** 17n,
    ],
  },
];

for (const target of verificationTargets) {
  console.log(`Verifying ${target.name}: ${target.address}`);
  try {
    await run('verify:verify', {
      address: target.address,
      constructorArguments: target.constructorArguments,
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    if (message.toLowerCase().includes('already verified')) {
      console.log(`${target.name} is already verified.`);
      continue;
    }
    console.error(`Verification failed for ${target.name}:`);
    console.error(message);
  }
}
