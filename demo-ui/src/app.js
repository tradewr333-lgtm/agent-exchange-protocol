import { AXPProtocol } from '../../axp-core/src/index.js';

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
axp.failContract(failureContract.id, { reason: 'missed_deadline', slashingRate: 0.3 });

const afterSuccess = axp.getAgent(successfulAgent.id);
const afterFailure = axp.getAgent(failedAgent.id);
const finalFailureContract = axp.getContract(failureContract.id);
const finalSuccessContract = axp.getContract(successContract.id);

const totalStake = afterSuccess.stake + afterFailure.stake;
const totalCapacity = afterSuccess.capacity.totalCapacity + afterFailure.capacity.totalCapacity;

document.querySelector('#totalStake').textContent = `${format(totalStake)} AXP`;
document.querySelector('#totalCapacity').textContent = format(totalCapacity);
document.querySelector('#totalSlashed').textContent = `${format(finalFailureContract.slashedAmount)} AXP`;
document.querySelector('#contractCount').textContent = '2';

renderAgent('#successAgent', {
  label: 'Success path',
  badge: 'Completed',
  tone: 'success',
  before: beforeSuccess,
  after: afterSuccess,
  contract: finalSuccessContract,
});

renderAgent('#failureAgent', {
  label: 'Failure path',
  badge: 'Slashed',
  tone: 'failure',
  before: beforeFailure,
  after: afterFailure,
  contract: finalFailureContract,
});

renderSlashFlow(finalFailureContract.slashDistribution);
renderAccounts(axp.getTokenAccounts([requester.id, afterSuccess.id, afterFailure.id, 'insurance_pool', 'arbitrators', 'treasury']));
renderEvents(axp.listEvents());

function renderAgent(selector, view) {
  const deltaCapacity = view.after.capacity.totalCapacity - view.before.capacity.totalCapacity;
  const deltaRep = view.after.reputation - view.before.reputation;
  const capacityPercent = Math.min((view.after.capacity.totalCapacity / 3000) * 100, 100);
  const stakePercent = Math.min((view.after.stake / 1000) * 100, 100);

  document.querySelector(selector).innerHTML = `
    <div class="agent-head">
      <div>
        <p class="eyebrow">${view.label}</p>
        <h2>${view.after.name}</h2>
        <span>${view.after.id}</span>
      </div>
      <strong class="badge ${view.tone}">${view.badge}</strong>
    </div>

    <div class="score-row">
      ${scoreCard('Reputation', view.before.reputation, view.after.reputation, deltaRep)}
      ${scoreCard('Capacity', view.before.capacity.totalCapacity, view.after.capacity.totalCapacity, deltaCapacity)}
    </div>

    <div class="bar-block">
      <div class="bar-label"><span>Stake</span><strong>${format(view.after.stake)} AXP</strong></div>
      <div class="bar"><span style="width:${stakePercent}%"></span></div>
    </div>
    <div class="bar-block">
      <div class="bar-label"><span>Capacity</span><strong>${format(view.after.capacity.totalCapacity)}</strong></div>
      <div class="bar capacity"><span style="width:${capacityPercent}%"></span></div>
    </div>

    <div class="contract-strip">
      <span>Contract ${view.contract.id}</span>
      <strong>${view.contract.status}</strong>
    </div>
  `;
}

function scoreCard(label, before, after, delta) {
  const sign = delta > 0 ? '+' : '';
  const tone = delta >= 0 ? 'up' : 'down';
  return `
    <div class="score-card">
      <span>${label}</span>
      <strong>${format(after)}</strong>
      <small class="${tone}">${format(before)} -> ${format(after)} (${sign}${format(delta)})</small>
    </div>
  `;
}

function renderSlashFlow(distribution) {
  const labels = {
    [requester.id]: 'Counterparty',
    insurance_pool: 'Insurance pool',
    arbitrators: 'Arbitrators',
    treasury: 'Treasury',
  };
  const total = Object.values(distribution).reduce((sum, amount) => sum + amount, 0);

  document.querySelector('#slashFlow').innerHTML = Object.entries(distribution)
    .map(([account, amount]) => {
      const percent = (amount / total) * 100;
      return `
        <div class="slash-item">
          <div class="bar-label"><span>${labels[account] ?? account}</span><strong>${format(amount)} AXP</strong></div>
          <div class="bar"><span style="width:${percent}%"></span></div>
        </div>
      `;
    })
    .join('');
}

function renderAccounts(accounts) {
  document.querySelector('#accounts').innerHTML = accounts
    .map((account) => `
      <div class="account-row">
        <span>${account.account}</span>
        <strong>${format(account.balance)} AXP</strong>
      </div>
    `)
    .join('');
}

function renderEvents(events) {
  document.querySelector('#events').innerHTML = events
    .map((event) => `<li><span>${event.type}</span><small>${new Date(event.at).toLocaleTimeString()}</small></li>`)
    .join('');
}

function format(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}
