import { AXPProtocol } from './index.js';

const axp = new AXPProtocol();

const alpha = axp.registerAgent({
  name: 'Agent Alpha',
  owner: 'alpha.lab',
  metadata: { role: 'requester' },
});

const beta = axp.registerAgent({
  name: 'Agent Beta',
  owner: 'beta.ops',
  metadata: { role: 'provider' },
});

axp.fundAgent(beta.id, 10_000);
axp.depositStake(beta.id, 1_000);

const contract = axp.createContract({
  requesterId: alpha.id,
  providerId: beta.id,
  value: 300,
  stakeRequired: 300,
  terms: 'Beta must deliver a verified research task for Alpha.',
});

axp.acceptContract(contract.id);
axp.failContract(contract.id, {
  reason: 'missed_deadline',
  slashingRate: 0.3,
});

const betaAfterFailure = axp.getAgent(beta.id);
const alphaAfterFailure = axp.getAgent(alpha.id);
const finalContract = axp.getContract(contract.id);
const tokenAccounts = axp.getTokenAccounts([
  alpha.id,
  beta.id,
  'insurance_pool',
  'arbitrators',
  'treasury',
]);

console.log('AXP v0.1 Tokenized Local Simulation');
console.log('------------------------------------');
console.log(`Registered: ${alpha.name} (${alpha.id})`);
console.log(`Registered: ${beta.name} (${beta.id})`);
console.log('');
console.log('Token Setup');
console.log(`Beta funded: 10000 AXP`);
console.log(`Beta reputation stake: 1000 AXP`);
console.log('');
console.log('Contract Result');
console.log(`Contract: ${finalContract.id}`);
console.log(`Status: ${finalContract.status}`);
console.log(`Reason: ${finalContract.result}`);
console.log(`Slashed: ${finalContract.slashedAmount} AXP`);
console.log('Slash Distribution');
for (const [account, amount] of Object.entries(finalContract.slashDistribution)) {
  console.log(`- ${account}: ${amount} AXP`);
}
console.log('');
console.log('Agent Beta After Failure');
console.log(`Stake: ${betaAfterFailure.stake} AXP`);
console.log(`Token Balance: ${betaAfterFailure.token.balance} AXP`);
console.log(`Token Locked: ${betaAfterFailure.token.locked} AXP`);
console.log(`Reputation: ${betaAfterFailure.reputation}`);
console.log(`Total Capacity: ${betaAfterFailure.capacity.totalCapacity}`);
console.log(`Available Capacity: ${betaAfterFailure.capacity.availableCapacity}`);
console.log('');
console.log('Agent Alpha Compensation');
console.log(`Alpha balance: ${alphaAfterFailure.token.balance} AXP`);
console.log('');
console.log('Token Accounts');
for (const account of tokenAccounts) {
  console.log(`- ${account.account}: balance=${account.balance}, locked=${account.locked}, available=${account.available}`);
}
console.log('');
console.log('Event Log');
for (const event of axp.listEvents()) {
  console.log(`- ${event.type}`);
}
