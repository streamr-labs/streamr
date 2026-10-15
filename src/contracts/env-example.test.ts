import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error Typed via runtime ESM script
import { validateEnvExample } from "../../scripts/check-env-example.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const envExampleRaw = fs.readFileSync(
  path.join(repoRoot, ".env.example"),
  "utf8",
);
const utilTsRaw = fs.readFileSync(
  path.join(repoRoot, "src/contracts/util.ts"),
  "utf8",
);

describe(".env.example drift check against src/contracts/util.ts schema (#45)", () => {
  it("passes on the repository .env.example and src/contracts/util.ts", () => {
    const res = validateEnvExample(envExampleRaw, utilTsRaw);
    expect(res.checkedKeys).toEqual([
      "PUBLIC_STELLAR_NETWORK",
      "PUBLIC_STELLAR_NETWORK_PASSPHRASE",
      "PUBLIC_STELLAR_RPC_URL",
      "PUBLIC_STELLAR_HORIZON_URL",
    ]);
  });

  it("fails on the legacy MAINNET comment and stray-indented PUBLIC_ lines", () => {
    const legacyEnv = [
      "STELLAR_SCAFFOLD_ENV=development",
      "   PUBLIC_STELLAR_NETWORK=TESTNET",
      "PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015",
      "PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org",
      "PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org",
      '# PUBLIC_STELLAR_NETWORK="MAINNET"',
    ].join("\n");

    expect(() => validateEnvExample(legacyEnv, utilTsRaw)).toThrow(
      /stray leading indentation[\s\S]*invalid commented PUBLIC_STELLAR_NETWORK value "MAINNET"/,
    );
  });

  it("fails when a required schema key is missing from .env.example", () => {
    const missingKeyEnv = [
      "PUBLIC_STELLAR_NETWORK=TESTNET",
      "PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015",
      "PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org",
    ].join("\n");

    expect(() => validateEnvExample(missingKeyEnv, utilTsRaw)).toThrow(
      /Missing required schema key "PUBLIC_STELLAR_HORIZON_URL"/,
    );
  });

  it("fails when .env.example declares an unknown PUBLIC_ key", () => {
    const unknownKeyEnv = `${envExampleRaw}\nPUBLIC_UNEXPECTED_KEY=123\n`;
    expect(() => validateEnvExample(unknownKeyEnv, utilTsRaw)).toThrow(
      /unknown frontend env key "PUBLIC_UNEXPECTED_KEY"/,
    );
  });
});
