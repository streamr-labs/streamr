import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Deploy to GitHub Pages protected environment gate (#44)", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const workflowPath = path.join(repoRoot, ".github/workflows/deploy-gh-pages.yml");
  const policyPath = path.join(repoRoot, ".github/environments/github-pages.json");

  it("documents the github-pages environment release control and restricts deploy to main", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("name: github-pages");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("Release control: the `github-pages` environment is gated by required");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
  });

  it("declares required reviewers and main-only deployment branch policy for github-pages", () => {
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    expect(policy.environment).toBe("github-pages");
    expect(Array.isArray(policy.reviewers)).toBe(true);
    expect(policy.reviewers.length).toBeGreaterThan(0);
    expect(policy.deployment_branch_policy.custom_branch_policies).toBe(true);
    expect(policy.deployment_branch_policy.allowed_branches).toEqual(["main"]);
  });
});
