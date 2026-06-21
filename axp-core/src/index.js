import { AXPToken, roundToken } from './token.js';

export { AXPToken } from './token.js';

export class AXPProtocol {
  constructor(config = {}) {
    this.config = {
      baseCapacityMultiplier: config.baseCapacityMultiplier ?? 2.5,
      insuranceMultiplier: config.insuranceMultiplier ?? 1,
      minReputation: config.minReputation ?? 0.1,
      defaultSlashingRate: config.defaultSlashingRate ?? 0.3,
      slashDistribution: config.slashDistribution ?? {
        counterparty: 0.6,
        insurance_pool: 0.2,
        arbitrators: 0.1,
        treasury: 0.1,
      },
      treasuryAccount: config.treasuryAccount ?? 'treasury',
      insurancePoolAccount: config.insurancePoolAccount ?? 'insurance_pool',
      arbitratorsAccount: config.arbitratorsAccount ?? 'arbitrators',
    };

    this.token = config.token ?? new AXPToken();
    this.agents = new Map();
    this.contracts = new Map();
    this.events = [];
    this.nextAgentNumber = 1;
    this.nextContractNumber = 1;
  }

  registerAgent({ name, owner, metadata = {} }) {
    if (!name) throw new Error('Agent name is required.');

    const agentId = `agent_${String(this.nextAgentNumber++).padStart(4, '0')}`;
    const agent = {
      id: agentId,
      name,
      owner: owner ?? 'unknown',
      metadata,
      stake: 0,
      lockedStake: 0,
      reputation: 1,
      completedContracts: 0,
      failedContracts: 0,
      activeObligations: 0,
      pendingDisputeExposure: 0,
      status: 'active',
    };

    this.agents.set(agentId, agent);
    this.record('agent.registered', { agentId, name });
    return this.snapshotAgent(agentId);
  }

  fundAgent(agentId, amount, source = 'agent_incentives') {
    this.requireAgent(agentId);
    this.token.transfer(source, agentId, amount, 'agent.funded');
    this.record('agent.funded', { agentId, amount, source });
    return this.snapshotAgent(agentId);
  }

  depositStake(agentId, amount) {
    const agent = this.requireAgent(agentId);
    this.requirePositiveAmount(amount, 'Stake amount');
    this.token.lock(agentId, amount, 'reputation_stake.locked');
    agent.stake = roundToken(agent.stake + amount);
    this.record('stake.deposited', { agentId, amount, symbol: this.token.symbol });
    return this.snapshotAgent(agentId);
  }

  calculateCapacity(agentId) {
    const agent = this.requireAgent(agentId);
    const freeStake = Math.max(agent.stake - agent.lockedStake, 0);
    const reputationMultiplier = Math.max(agent.reputation, this.config.minReputation);
    const totalCapacity = roundMoney(
      agent.stake *
        this.config.baseCapacityMultiplier *
        reputationMultiplier *
        this.config.insuranceMultiplier,
    );
    const availableCapacity = roundMoney(
      totalCapacity - agent.activeObligations - agent.pendingDisputeExposure,
    );

    return {
      agentId,
      totalCapacity,
      availableCapacity: Math.max(availableCapacity, 0),
      activeObligations: agent.activeObligations,
      pendingDisputeExposure: agent.pendingDisputeExposure,
      freeStake: roundMoney(freeStake),
      reputation: roundScore(agent.reputation),
    };
  }

  createContract({ requesterId, providerId, value, stakeRequired, terms }) {
    this.requireAgent(requesterId);
    this.requireAgent(providerId);
    this.requirePositiveAmount(value, 'Contract value');

    const requiredStake = stakeRequired ?? Math.ceil(value * 0.25);
    const contractId = `contract_${String(this.nextContractNumber++).padStart(4, '0')}`;
    const contract = {
      id: contractId,
      requesterId,
      providerId,
      value,
      stakeRequired: requiredStake,
      terms: terms ?? 'No terms provided.',
      status: 'proposed',
      result: null,
      slashedAmount: 0,
      slashDistribution: null,
      createdAt: new Date().toISOString(),
    };

    this.contracts.set(contractId, contract);
    this.record('contract.created', { contractId, requesterId, providerId, value, requiredStake });
    return this.snapshotContract(contractId);
  }

  acceptContract(contractId) {
    const contract = this.requireContract(contractId);
    if (contract.status !== 'proposed') throw new Error('Only proposed contracts can be accepted.');

    const provider = this.requireAgent(contract.providerId);
    const capacity = this.calculateCapacity(provider.id);
    if (capacity.availableCapacity < contract.value) {
      throw new Error(`Insufficient capacity. Required ${contract.value}, available ${capacity.availableCapacity}.`);
    }
    if (provider.stake - provider.lockedStake < contract.stakeRequired) {
      throw new Error(`Insufficient free stake. Required ${contract.stakeRequired}.`);
    }

    provider.lockedStake = roundToken(provider.lockedStake + contract.stakeRequired);
    provider.activeObligations = roundToken(provider.activeObligations + contract.value);
    contract.status = 'active';
    this.record('contract.accepted', { contractId, providerId: provider.id });
    return this.snapshotContract(contractId);
  }

  completeContract(contractId) {
    const contract = this.requireContract(contractId);
    if (contract.status !== 'active') throw new Error('Only active contracts can be completed.');

    const provider = this.requireAgent(contract.providerId);
    provider.lockedStake = roundToken(provider.lockedStake - contract.stakeRequired);
    provider.activeObligations = roundToken(provider.activeObligations - contract.value);
    provider.completedContracts += 1;
    provider.reputation = roundScore(Math.min(provider.reputation + 0.03, 2));

    contract.status = 'completed';
    contract.result = 'success';
    this.record('contract.completed', { contractId, providerId: provider.id });
    return this.snapshotContract(contractId);
  }

  failContract(contractId, options = {}) {
    const contract = this.requireContract(contractId);
    if (contract.status !== 'active') throw new Error('Only active contracts can fail.');

    const provider = this.requireAgent(contract.providerId);
    const slashingRate = options.slashingRate ?? this.config.defaultSlashingRate;
    const slashedAmount = roundToken(Math.min(contract.stakeRequired * slashingRate, provider.stake));
    const recipients = this.resolveSlashRecipients(contract.requesterId);
    const distribution = this.token.slash(provider.id, slashedAmount, recipients, 'reputation_stake.slashed');

    provider.stake = roundToken(provider.stake - slashedAmount);
    provider.lockedStake = roundToken(provider.lockedStake - contract.stakeRequired);
    provider.activeObligations = roundToken(provider.activeObligations - contract.value);
    provider.failedContracts += 1;
    provider.reputation = roundScore(Math.max(provider.reputation - 0.09 - slashingRate * 0.1, this.config.minReputation));

    contract.status = 'failed';
    contract.result = options.reason ?? 'failure';
    contract.slashedAmount = slashedAmount;
    contract.slashDistribution = distribution;
    this.record('contract.failed', { contractId, providerId: provider.id, slashedAmount, distribution });
    return this.snapshotContract(contractId);
  }

  getAgent(agentId) {
    return this.snapshotAgent(agentId);
  }

  getContract(contractId) {
    return this.snapshotContract(contractId);
  }

  getTokenAccounts(accounts = []) {
    return this.token.snapshot(accounts);
  }

  listEvents() {
    return this.events.map((event) => ({ ...event }));
  }

  resolveSlashRecipients(counterpartyAccount) {
    return {
      [counterpartyAccount]: this.config.slashDistribution.counterparty,
      [this.config.insurancePoolAccount]: this.config.slashDistribution.insurance_pool,
      [this.config.arbitratorsAccount]: this.config.slashDistribution.arbitrators,
      [this.config.treasuryAccount]: this.config.slashDistribution.treasury,
    };
  }

  requireAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return agent;
  }

  requireContract(contractId) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new Error(`Contract not found: ${contractId}`);
    return contract;
  }

  requirePositiveAmount(amount, label) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`${label} must be a positive number.`);
    }
  }

  snapshotAgent(agentId) {
    const agent = this.requireAgent(agentId);
    return {
      ...agent,
      token: {
        balance: this.token.balanceOf(agentId),
        locked: this.token.lockedOf(agentId),
        available: this.token.availableOf(agentId),
      },
      capacity: this.calculateCapacity(agentId),
    };
  }

  snapshotContract(contractId) {
    return { ...this.requireContract(contractId) };
  }

  record(type, data) {
    this.events.push({
      type,
      data,
      at: new Date().toISOString(),
    });
  }
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function roundScore(value) {
  return Math.round(value * 10000) / 10000;
}
