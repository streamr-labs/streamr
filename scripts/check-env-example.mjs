#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseSchemaFromUtilTs(utilTsContent) {
  const schemaMatch = utilTsContent.match(
    /const\s+envSchema\s*=\s*z\.object\(\{([\s\S]*?)\}\);/,
  );
  if (!schemaMatch) {
    throw new Error("Could not locate envSchema in src/contracts/util.ts");
  }
  const body = schemaMatch[1];
  const keys = [];
  for (const m of body.matchAll(/^\s*(PUBLIC_[A-Z0-9_]+)\s*:/gm)) {
    keys.push(m[1]);
  }
  const enumMatch = body.match(
    /PUBLIC_STELLAR_NETWORK\s*:\s*z\.enum\(\[([\s\S]*?)\]/,
  );
  if (!enumMatch) {
    throw new Error(
      "Could not locate PUBLIC_STELLAR_NETWORK z.enum in src/contracts/util.ts",
    );
  }
  const allowedNetworks = [];
  for (const m of enumMatch[1].matchAll(/"([A-Z0-9_]+)"/g)) {
    allowedNetworks.push(m[1]);
  }
  return { keys, allowedNetworks };
}

function unquote(rawVal) {
  const trimmed = rawVal.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function validateEnvExample(envExampleContent, utilTsContent) {
  const { keys: schemaKeys, allowedNetworks } =
    parseSchemaFromUtilTs(utilTsContent);
  const schemaKeySet = new Set(schemaKeys);
  const allowedNetworkSet = new Set(allowedNetworks);
  const activePublicKeys = new Set();
  const errors = [];

  const lines = envExampleContent.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.trim() === "") return;

    // Detect stray leading whitespace on non-comment assignment lines
    if (/^[ \t]+[^#\s]/.test(line)) {
      errors.push(
        `Line ${lineNo}: stray leading indentation in "${line}" (env assignments must start at column 1)`,
      );
    }

    // Match either active KEY=VALUE or commented example `# PUBLIC_KEY=VALUE`
    const commentedMatch = line.match(
      /^\s*#\s*(PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/,
    );
    const activeMatch = !line.trimStart().startsWith("#")
      ? line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      : null;

    const match = commentedMatch || activeMatch;
    if (!match) return;

    const isCommented = Boolean(commentedMatch);
    const key = match[1];
    const value = unquote(match[2]);

    if (!key.startsWith("PUBLIC_")) return;

    if (!schemaKeySet.has(key)) {
      errors.push(
        `Line ${lineNo}: unknown frontend env key "${key}" is not accepted by envSchema (${schemaKeys.join(", ")})`,
      );
      return;
    }

    if (!isCommented) {
      activePublicKeys.add(key);
    }

    if (key === "PUBLIC_STELLAR_NETWORK") {
      if (!allowedNetworkSet.has(value)) {
        errors.push(
          `Line ${lineNo}: invalid ${isCommented ? "commented " : ""}PUBLIC_STELLAR_NETWORK value "${value}" (expected one of: ${allowedNetworks.join(", ")})`,
        );
      }
    } else if (!isCommented && value.length === 0) {
      errors.push(`Line ${lineNo}: active ${key} must not be empty`);
    }
  });

  for (const requiredKey of schemaKeys) {
    if (!activePublicKeys.has(requiredKey)) {
      errors.push(
        `Missing required schema key "${requiredKey}" in .env.example`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`.env.example drift detected:\n- ${errors.join("\n- ")}`);
  }

  return {
    checkedKeys: [...activePublicKeys],
    allowedNetworks,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const envExamplePath = path.resolve(
    repoRoot,
    process.argv[2] ?? ".env.example",
  );
  const utilTsPath = path.resolve(
    repoRoot,
    process.argv[3] ?? "src/contracts/util.ts",
  );

  try {
    const envRaw = fs.readFileSync(envExamplePath, "utf8");
    const utilRaw = fs.readFileSync(utilTsPath, "utf8");
    const result = validateEnvExample(envRaw, utilRaw);
    console.log(
      `.env.example matches src/contracts/util.ts schema (${result.checkedKeys.join(", ")})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  }
}
