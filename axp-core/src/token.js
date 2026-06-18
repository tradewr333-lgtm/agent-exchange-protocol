export class AXPToken {
  constructor({ totalSupply = 1_000_000_000, allocations } = {}) {
    this.symbol = 'AXP';
    this.name = 'Agent Exchange Protocol';
    this.totalSupply = totalSupply;
    this.balances = new Map();
    this.lockedBalances = new Map();
    this.ledger = [];

    const initialAllocations = allocations ?? {
      ecosystem: totalSupply * 0.35,
      treasury: totalSupply * 0.20,
      contributors: totalSupply * 0.15,
      investors: totalSupply * 0.15,
      agent_incentives: totalSupply * 0.10,
      liquidity: totalSupply * 0.05,
    };

    const allocated = Object.values(initialAllocations).reduce((sum, value) => sum + value, 0);
    if (roundToken(allocated) !== roundToken(totalSupply)) {
      throw new Error('Initial allocations must equal total supply.');
    }

    for (const [account, amount] of Object.entries(initialAllocations)) {
      this.mint(account, amount, 'genesis.allocation');
    }
  }

  balanceOf(account) {
    return roundToken(this.balances.get(account) ?? 0);
  }

  lockedOf(account) {
    return roundToken(this.lockedBalances.get(account) ?? 0);
  }

  availableOf(account) {
    return roundToken(this.balanceOf(account) - this.lockedOf(account));
  }

  transfer(from, to, amount, reason = 'transfer') {
    this.requireAccount(from, 'from');
    this.requireAccount(to, 'to');
    this.requirePositiveAmount(amount, 'Transfer amount');
    if (this.availableOf(from) < amount) {
      throw new Error(`Insufficient available AXP. Required ${amount}, available ${this.availableOf(from)}.`);
    }

    this.balances.set(from, roundToken(this.balanceOf(from) - amount));
    this.balances.set(to, roundToken(this.balanceOf(to) + amount));
    this.record(reason, { from, to, amount });
  }

  lock(account, amount, reason = 'stake.locked') {
    this.requireAccount(account, 'account');
    this.requirePositiveAmount(amount, 'Lock amount');
    if (this.availableOf(account) < amount) {
      throw new Error(`Insufficient available AXP to lock. Required ${amount}, available ${this.availableOf(account)}.`);
    }

    this.lockedBalances.set(account, roundToken(this.lockedOf(account) + amount));
    this.record(reason, { account, amount });
  }

  unlock(account, amount, reason = 'stake.unlocked') {
    this.requireAccount(account, 'account');
    this.requirePositiveAmount(amount, 'Unlock amount');
    if (this.lockedOf(account) < amount) {
      throw new Error(`Insufficient locked AXP. Required ${amount}, locked ${this.lockedOf(account)}.`);
    }

    this.lockedBalances.set(account, roundToken(this.lockedOf(account) - amount));
    this.record(reason, { account, amount });
  }

  slash(account, amount, recipients, reason = 'stake.slashed') {
    this.requireAccount(account, 'account');
    this.requirePositiveAmount(amount, 'Slash amount');
    if (this.lockedOf(account) < amount) {
      throw new Error(`Insufficient locked AXP to slash. Required ${amount}, locked ${this.lockedOf(account)}.`);
    }

    const totalShare = Object.values(recipients).reduce((sum, share) => sum + share, 0);
    if (roundToken(totalShare) !== 1) {
      throw new Error('Slash recipients must sum to 1.');
    }

    this.lockedBalances.set(account, roundToken(this.lockedOf(account) - amount));
    this.balances.set(account, roundToken(this.balanceOf(account) - amount));

    const distribution = {};
    for (const [recipient, share] of Object.entries(recipients)) {
      const distributedAmount = roundToken(amount * share);
      this.balances.set(recipient, roundToken(this.balanceOf(recipient) + distributedAmount));
      distribution[recipient] = distributedAmount;
    }

    this.record(reason, { account, amount, distribution });
    return distribution;
  }

  snapshot(accounts = []) {
    const selectedAccounts = accounts.length > 0 ? accounts : [...this.balances.keys()];
    return selectedAccounts.map((account) => ({
      account,
      balance: this.balanceOf(account),
      locked: this.lockedOf(account),
      available: this.availableOf(account),
    }));
  }

  mint(account, amount, reason = 'mint') {
    this.requireAccount(account, 'account');
    this.requirePositiveAmount(amount, 'Mint amount');
    this.balances.set(account, roundToken(this.balanceOf(account) + amount));
    this.record(reason, { to: account, amount });
  }

  record(type, data) {
    this.ledger.push({ type, data, at: new Date().toISOString() });
  }

  requireAccount(account, label) {
    if (!account || typeof account !== 'string') {
      throw new Error(`${label} account is required.`);
    }
  }

  requirePositiveAmount(amount, label) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`${label} must be a positive number.`);
    }
  }
}

export function roundToken(value) {
  return Math.round(value * 100) / 100;
}
