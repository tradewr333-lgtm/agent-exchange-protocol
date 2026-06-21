@echo off
rem ---------------------------------------------------------------------------
rem AXP periodic anchor: commits a Merkle root of NEW trust events to BSC.
rem Safe to run on a schedule — if there are no new events since the last
rem anchor, it exits without sending a transaction.
rem
rem Schedule it (every 6 hours) with Windows Task Scheduler, e.g.:
rem   schtasks /create /tn "AXP Anchor" /sc HOURLY /mo 6 /tr "\"%~f0\""
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0..\.."
if "%AXP_REGISTRY_URL%"=="" set "AXP_REGISTRY_URL=https://axp.network"
if "%AXP_TRUST_ANCHOR_ADDRESS%"=="" set "AXP_TRUST_ANCHOR_ADDRESS=0x41c427c3F895EfE382Ab5a8B5C6E6Bbd70873278"
node examples/proof-of-trust-anchor/anchor-bsc.js
endlocal
