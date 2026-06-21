import { AXPProtocol } from './index.js';

const axp = new AXPProtocol();

const requester = axp.registerAgent({
  name: 'Agent Alpha',
  owner: 'alpha.lab',
  metadata: { role: 'requester' },
});

const successfulAgent = axp.registerAgent({
  name: 'Agent Beta',
  owner: 'beta.ops',
  metadata: { role: 'provider', scenario: 'success' },
});

const failedAgent = axp.registerAgent({
  name: 'Agent Gamma',
  owner: 'gamma.ops',
  metadata: { role: 'provider', scenario: 'failure' },
});

for (const agent of [successfulAgent, failedAgent]) {
  axp.fundAgent(agent.id, 10_000);
  axp.depositStake(agent.id, 1_000);
}

const beforeSuccess = axp.getAgent(successfulAgent.id);
const beforeFailure = axp.getAgent(failedAgent.id);

const successContract = axp.createContract({
  requesterId: requester.id,
  providerId: successfulAgent.id,
  value: 300,
  stakeRequired: 300,
  terms: 'Deliver a verified market research task.',
});

const failureContract = axp.createContract({
  requesterId: requester.id,
  providerId: failedAgent.id,
  value: 300,
  stakeRequired: 300,
  terms: 'Deliver a verified market research task.',
});

axp.acceptContract(successContract.id);
axp.completeContract(successContract.id);

axp.acceptContract(failureContract.id);
axp.failContract(failureContract.id, {
  reason: 'missed_deadline',
  slashingRate: 0.3,
});

const afterSuccess = axp.getAgent(successfulAgent.id);
const afterFailure = axp.getAgent(failedAgent.id);
const finalFailureContract = axp.getContract(failureContract.id);

console.log('AXP v0.1 Success vs Failure Simulation');
console.log('---------------------------------------');
console.log('Both provider agents start with 10000 AXP balance and 1000 AXP reputation stake.');
console.log('Each agent accepts a 300 AXP-equivalent obligation with 300 AXP at risk.');
console.log('');
printAgentComparison('Success Path', beforeSuccess, afterSuccess);
console.log('');
printAgentComparison('Failure Path', beforeFailure, afterFailure);
console.log('');
console.log('Failure Slashing Distribution');
console.log(`Total slashed: ${finalFailureContract.slashedAmount} AXP`);
for (const [account, amount] of Object.entries(finalFailureContract.slashDistribution)) {
  console.log(`- ${account}: ${amount} AXP`);
}
console.log('');
console.log('Protocol Accounts After Failure');
for (const account of axp.getTokenAccounts([requester.id, 'insurance_pool', 'arbitrators', 'treasury'])) {
  console.log(`- ${account.account}: balance=${account.balance}, locked=${account.locked}, available=${account.available}`);
}
console.log('');
console.log('Interpretation');
console.log('- A successful agent keeps stake, gains reputation, and increases total capacity.');
console.log('- A failed agent loses AXP, loses reputation, and has lower future capacity.');

function printAgentComparison(title, before, after) {
  console.log(title);
  console.log(`Agent: ${after.name} (${after.id})`);
  console.log(`Stake: ${before.stake} -> ${after.stake} AXP`);
  console.log(`Token balance: ${before.token.balance} -> ${after.token.balance} AXP`);
  console.log(`Reputation: ${before.reputation} -> ${after.reputation}`);
  console.log(`Total capacity: ${before.capacity.totalCapacity} -> ${after.capacity.totalCapacity}`);
  console.log(`Available capacity: ${before.capacity.availableCapacity} -> ${after.capacity.availableCapacity}`);
  console.log(`Completed contracts: ${before.completedContracts} -> ${after.completedContracts}`);
  console.log(`Failed contracts: ${before.failedContracts} -> ${after.failedContracts}`);
}
