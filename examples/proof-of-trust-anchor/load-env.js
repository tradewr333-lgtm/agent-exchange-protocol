// Minimal, dependency-free loader for blockchain/.env so the anchor scripts can
// be run from the repo root. Only fills variables that are not already set in the
// process environment. The private key never leaves this machine.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadBlockchainEnv() {
  const path = fileURLToPath(new URL('../../blockchain/.env', import.meta.url));
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
