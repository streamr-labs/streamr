# Streamr Pitch Deck

### 1. Problem
- Creators, collectives, and service platforms struggle to automate continuous payouts or usage-based billing.  
- Treasury managers waste hours reconciling spreadsheets, while contributors wait for manual bulk transfers.  
- Legacy payroll rails are expensive across borders and lack transparency or programmable logic.

### 2. Solution
- **Streamr** offers programmable, real-time payment streams and recurring subscriptions for stablecoins on the Stellar network.  
- Treasury teams define per-second rates or subscription cadences once; the Soroban contract enforces distribution autonomously.  
- Recipients can withdraw accrued balances instantly with on-chain proofs and auditability.

### 3. Product Snapshot
- Multi-recipient stream creation with rate-per-second math handled by contract logic.  
- Dedicated subscription module with escrowed balances, due-date enforcement, and manual/automated charge flows.  
- React dashboard with wallet authentication, live balances, withdrawal actions, and trustline helpers.  
- Auto-generated TypeScript client bindings for developers embedding Streamr into existing back offices.

### 4. Market Opportunity
- **Total addressable market:** \$120B+ in global freelancing, creator economy, and DAO payroll that requires faster settlements.  
- **Serviceable obtainable market (near term):** \$4B in Web3-native projects managing recurring contributor payouts and SaaS-style token billing.  
- Growing demand for transparent, programmable disbursements across remittances, defi treasuries, and gig marketplaces.

### 5. Business Model
- Usage-based fees (bps) on streamed or subscription volume processed through the Streamr contract.  
- Premium interface tier for treasury automation, analytics, and accounting integrations.  
- Partner program for wallets and payment aggregators that embed Streamr flows.

### 6. Competitive Advantage
- Built on Stellar’s low-fee, high-speed settlement layer plus Soroban smart contracts for deterministic execution.  
- Open-source contract + generated client bindings accelerate partner integrations.  
- UX-first dashboard lowers the barrier for non-technical operators to manage real-time payouts.

### 7. Traction & Validation
- End-to-end prototype live in this repository: contract, bindings, and dashboard already operating on Stellar testnet.  
- Wallet connectivity, friendbot funding, and notifications demonstrate production-readiness paths.  
- Strong developer velocity from scaffold tooling—new features can ship in days, not weeks.

### 8. Go-To-Market Plan
- Launch with hackathon and DAO treasuries that already manage multi-recipient payouts.  
- Integrate with Stellar ecosystem wallets and on/off-ramps for fiat bridge use cases.  
- Provide SDK tutorials, recipes, and grants for platforms embedding Streamr billing.

### 9. Roadmap
| Quarter | Milestone |
|---------|-----------|
| Q2 | Harden smart contract for mainnet, add automated withdrawal cron tooling |
| Q3 | Release analytics module, CSV export, and compliance-ready audit logs |
| Q4 | Expand to fiat off-ramps, offer programmable webhook/API triggers |
| Q1 (next year) | Cross-chain streaming adapters and yield optimization vaults |

### 10. Team & Advisors
- Hackathon team of Stellar-focused full-stack engineers with Rust, Soroban, and fintech backgrounds.  
- Advisors from the Stellar ecosystem and payments industry guiding compliance and treasury UX.

### 11. Ask / Call to Action
- **Developers:** Fork this repo, deploy on testnet, and contribute feature ideas.  
- **Treasury leaders & DAOs:** Join the early adopter program to pilot automated payouts.  
- **Investors & partners:** Reach out for co-development, integrations, or ecosystem grant support.

## Prerequisites

Before you begin, make sure you have the following installed:

| Tool | Description | Install Link |
|------|-------------|--------------|
| Rust & Cargo | For writing and compiling smart contracts | `curl https://sh.rustup.rs -sSf | sh` |
| Node.js & npm | For frontend development | [https://nodejs.org/](https://nodejs.org/) |
| Stellar CLI | For building, deploying, and interacting with smart contracts | [https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) |
| Docker | For running a Stellar node locally | [https://docs.docker.com/get-docker/](https://docs.docker.com/get-docker/) |


## Quickstart (New Developers Welcome!)

This section walks you through setting up Scaffold Stellar from scratch.

### 1. Install the Scaffold Stellar CLI

```bash
cargo install --locked stellar-scaffold-cli
```

The Scaffold Stellar CLI is installed as a plugin under the stellar CLI.

We recommend the use of cargo-binstall to install pre-compiled binaries.

### 2. Create a New Project

```bash
stellar scaffold init my-project
cd my-project
```

### 3. Configure Your Frontend Environment

Edit `.env` with your preferred network, and other settings.

### 4. Install Frontend Dependencies

```bash
# Install Frontend dependencies
npm install
```

### 5. Start Development

```bash
npm run dev
```

You should see your React frontend at http://localhost:5173.

### 6. For testnet/mainnet deployment:

```bash
# First publish your contract to the registry
stellar registry publish --wasm path/to/contract.wasm --wasm-name my-contract

# Then deploy an instance with constructor parameters
stellar registry deploy \
  --contract-name my-contract-instance \
  --wasm-name my-contract \
  -- \
  --param1 value1

# Can access the help docs for constructor parameters
stellar registry deploy \
  --contract-name my-contract-instance \
  --wasm-name my-contract \
  -- \
  --help

# Install the deployed contract locally for use with stellar-cli
stellar registry install my-contract-instance
```

## Project Layout

After scaffolding a project, your folder structure will look like this:

```
my-project/
├── contracts/            # Rust smart contracts (compiled to WASM)
├── packages/             # Auto-generated TypeScript contract clients
├── src/                  # React frontend code
│   ├── components/       # Reusable UI pieces
│   ├── contracts/        # Contract interaction logic
│   ├── App.tsx           # Main app component
│   └── main.tsx          # Entry point
├── environments.toml     # Configuration per environment (dev/test/prod)
├── .env                  # Local environment variables
├── package.json          # Frontend packages
├── target/               # Build outputs
```

This template provides a ready-to-use frontend application with example smart contracts and their TypeScript clients. You can use these as reference while building your own contracts and UI. The frontend is set up with Vite, React, and includes basic components for interacting with the contracts.

See the CLI Documentation for detailed command information and the Environments Guide for configuration details.

## CLI Tools

Scaffold Stellar provides two main CLI tools:

**stellar-scaffold** Initialize and manage dApp projects:

```bash
stellar scaffold init my-project
stellar scaffold build
```

**stellar-registry** Manage contract deployment and versions:

```bash
stellar registry publish --wasm contract.wasm --wasm-name my-contract    # Publish contract to the registry
stellar registry deploy --contract-name instance --wasm-name my-contract # Deploy a contract instance
stellar registry install my-contract-instance                           # Install deployed contracts locally
```

Use `--help` on any command for usage instructions.

## Smart Contract Deployment

### 1. Publish Your Contract

```bash
# Publish with automatic metadata extraction
stellar registry publish --wasm target/stellar/local/my_contract.wasm

# Or specify details manually
stellar registry publish \
  --wasm target/stellar/local/my_contract.wasm \
  --wasm-name my-contract \
  --binver "1.0.0"
```

### 2. Deploy the Contract

```bash
# Deploy without initialization
stellar registry deploy \
  --contract-name my-contract-instance \
  --wasm-name my-contract

# Deploy with constructor parameters
stellar registry deploy \
  --contract-name my-token \
  --wasm-name token \
  --version "1.0.0" \
  -- \
  --name "My Token" \
  --symbol "MTK" \
  --decimals 7
```

### 3. Install the Deployed Contract

```bash
stellar registry install my-contract-instance
```

After installation, you can interact with the contract using stellar-cli:

```bash
stellar contract invoke --id my-contract-instance -- --help
```

You can deploy to testnet or mainnet depending on your `.env` and `environments.toml`.

## Concept: What Is the Contract Registry?

The registry is an on-chain smart contract that lets you:

- Publish and verify contract WASM binaries with versioning
- Deploy published contracts as named instances
- Manage multiple versions of the same contract
- Reuse deployed contracts across dApps

The registry separates the concepts of:

- **WASM publication**: Publishing reusable contract code
- **Contract deployment**: Creating instances of published contracts
- **Local installation**: Creating aliases for easy CLI access

This means your contracts can be upgraded, shared, and used like packages.

## Project Structure (Top-Level)

Your repo contains the following key folders:

| Folder | Purpose |
|--------|---------|
| `.cargo/`, `.config/` | Rust and build settings |
| `contracts/` | Example smart contracts |
| `crates/` | Internal Rust libraries and helpers |
| `docs/` | Documentation files |
| `npm/` | Shared frontend packages |
| `deploy_registry.sh` | Helper script to deploy the registry |
| `justfile` | Commands you can run with `just` |

## Documentation

- [CLI Commands](https://github.com/theahaco/scaffold-stellar)
- [Environment Setup](https://github.com/theahaco/scaffold-stellar)
- [Registry Guide](https://github.com/theahaco/scaffold-stellar)
- Additional Developer Resources

### Video Tutorials

- [Video: Intro to Scaffold Stellar](https://github.com/theahaco/scaffold-stellar)
- [Video: Which Frontend?](https://github.com/theahaco/scaffold-stellar)
- [Video: Get Started Building](https://github.com/theahaco/scaffold-stellar)
- [Video: Live Demo of Scaffold Stellar 👈 Start Here](https://github.com/theahaco/scaffold-stellar)

## Contributing

We love contributions! If you're new, check these out:

- [Contributing Guide](CONTRIBUTING.md)

## License

This project is licensed under the Apache-2.0 License — see the LICENSE file for details.

## Need Help?

If you're new to Stellar, Rust, or smart contracts:

- Ask questions in the repo Discussions tab
- Search DeepWiki
- Or just open an issue — we're happy to help!

Happy hacking!
