import { describe, expect, it } from "vitest";
import { parseExternalIssueUrl } from "../src/shared/external";

describe("parseExternalIssueUrl", () => {
  it("parses GitHub issues", () => {
    expect(parseExternalIssueUrl("https://github.com/JJ-Lin/Codex-manager/issues/12")).toMatchObject({
      provider: "github",
      owner: "JJ-Lin",
      repo: "Codex-manager",
      number: 12
    });
  });

  it("parses GitLab issues", () => {
    expect(parseExternalIssueUrl("https://git.garena.com/a/b/c/-/issues/45")).toMatchObject({
      provider: "gitlab",
      host: "git.garena.com",
      projectPath: "a/b/c",
      iid: 45
    });
  });
});
