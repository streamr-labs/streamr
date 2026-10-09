import { describe, expect, it } from "vitest";
import {
  TESTNET_TOKENS,
  TOKEN_CONTRACTS,
  getTokenContractAddress,
  getTokenSymbol,
} from "./tokens";

const NETWORKS = Object.keys(TOKEN_CONTRACTS);
const UNKNOWN_ADDRESS = "CUNKNOWNADDRESSUNKNOWNADDRESSUNKNOWNADDRESSUNKNOWNADDRES";

describe("getTokenContractAddress", () => {
  it.each(NETWORKS)("returns the %s addresses for each token", (network) => {
    expect(getTokenContractAddress(network, "usdc")).toBe(TOKEN_CONTRACTS[network].usdc);
    expect(getTokenContractAddress(network, "xlm")).toBe(TOKEN_CONTRACTS[network].xlm);
  });

  it.each(NETWORKS)("treats the %s network name case-insensitively", (network) => {
    expect(getTokenContractAddress(network.toLowerCase(), "usdc")).toBe(
      TOKEN_CONTRACTS[network].usdc,
    );
  });

  it("falls back to TESTNET for an unknown network", () => {
    expect(getTokenContractAddress("MOONNET", "usdc")).toBe(TOKEN_CONTRACTS.TESTNET.usdc);
    expect(getTokenContractAddress("", "xlm")).toBe(TOKEN_CONTRACTS.TESTNET.xlm);
  });
});

describe("getTokenSymbol", () => {
  it("round-trips both TESTNET tokens", () => {
    expect(getTokenSymbol(TOKEN_CONTRACTS.TESTNET.usdc, "TESTNET")).toBe("USDC");
    expect(getTokenSymbol(TOKEN_CONTRACTS.TESTNET.xlm, "TESTNET")).toBe("XLM");
  });

  it("defaults the network to TESTNET", () => {
    expect(getTokenSymbol(TOKEN_CONTRACTS.TESTNET.usdc)).toBe("USDC");
    expect(getTokenSymbol(TOKEN_CONTRACTS.TESTNET.xlm)).toBe("XLM");
  });

  it("matches addresses and network names case-insensitively", () => {
    expect(getTokenSymbol(TOKEN_CONTRACTS.TESTNET.usdc.toLowerCase(), "testnet")).toBe("USDC");
  });

  it.each(NETWORKS)("resolves the %s USDC address to USDC", (network) => {
    expect(getTokenSymbol(TOKEN_CONTRACTS[network].usdc, network)).toBe("USDC");
  });

  // On networks where the XLM entry is still the same placeholder as USDC (#54),
  // the USDC check wins; only assert the XLM round-trip where the addresses differ.
  it.each(NETWORKS.filter((n) => TOKEN_CONTRACTS[n].usdc !== TOKEN_CONTRACTS[n].xlm))(
    "resolves the %s XLM address to XLM",
    (network) => {
      expect(getTokenSymbol(TOKEN_CONTRACTS[network].xlm, network)).toBe("XLM");
    },
  );

  it("uses the TESTNET table for an unknown network", () => {
    expect(getTokenSymbol(TOKEN_CONTRACTS.TESTNET.usdc, "MOONNET")).toBe("USDC");
  });

  it("defaults to XLM for an unknown address", () => {
    expect(getTokenSymbol(UNKNOWN_ADDRESS)).toBe("XLM");
    expect(getTokenSymbol(UNKNOWN_ADDRESS, "PUBLIC")).toBe("XLM");
  });
});

describe("TESTNET_TOKENS", () => {
  it("mirrors TOKEN_CONTRACTS.TESTNET", () => {
    expect(TESTNET_TOKENS).toEqual({
      USDC: TOKEN_CONTRACTS.TESTNET.usdc,
      XLM: TOKEN_CONTRACTS.TESTNET.xlm,
    });
  });
});
