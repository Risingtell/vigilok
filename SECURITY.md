# Security Policy

VigilOK moves real money (USD₮0 on X Layer, settled via the OKX Agent
Payments Protocol) and reads real Aave V3 positions. Treat anything that
could misdirect funds, misreport a health factor, or bypass a payment check
as a security issue, not a regular bug.

## Reporting a Vulnerability

Email **risingtell@gmail.com** with:
- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Whether it's already been exploited on the live deployment

Please do not open a public GitHub issue for a live vulnerability — the
service is deployed and actively settling real payments at
[vigilok.onrender.com](https://vigilok.onrender.com).

We'll acknowledge reports promptly and credit responsible disclosure in the
README, the same way we've credited independent red-team findings before
(see the Acknowledgments section).

## Scope

In scope: the payment flows (x402 `exact`, MPP `session`), the Aave V3
health-factor and simulation math, on-chain settlement verification, and
anything that could let a caller pay less than quoted or receive a wrong
risk verdict for a real position.

Out of scope: the underlying `@okxweb3/*` SDKs, the OKX facilitator, and the
Aave V3 protocol contracts themselves — report those to OKX or Aave directly.
