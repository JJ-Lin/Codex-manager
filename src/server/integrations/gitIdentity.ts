import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { GitIdentity, Provider } from "../../shared/types";

const execFileAsync = promisify(execFile);

const PROVIDERS: Array<{ provider: Provider; host: string; identityFile: string; apiCommand: string[]; apiHint: string }> = [
  {
    provider: "github",
    host: "github.com",
    identityFile: `${process.env.HOME}/.config/git/identity-github`,
    apiCommand: ["gh", "auth", "status", "--hostname", "github.com"],
    apiHint: "安装并登录 gh 后可同步 GitHub issue 详情"
  },
  {
    provider: "gitlab",
    host: "git.garena.com",
    identityFile: `${process.env.HOME}/.config/git/identity-gitlab`,
    apiCommand: ["glab", "auth", "status", "--hostname", "git.garena.com"],
    apiHint: "安装并登录 glab 后可同步 GitLab issue 详情"
  }
];

export async function detectGitIdentities(): Promise<GitIdentity[]> {
  return Promise.all(PROVIDERS.map(readIdentity));
}

async function readIdentity(config: (typeof PROVIDERS)[number]): Promise<GitIdentity> {
  const parsed = await readGitIdentityFile(config.identityFile);
  const apiAvailable = await commandSucceeds(config.apiCommand);
  return {
    provider: config.provider,
    host: config.host,
    name: parsed.name,
    email: parsed.email,
    source: config.identityFile,
    usableForCommits: Boolean(parsed.name && parsed.email),
    apiAvailable,
    apiHint: apiAvailable ? undefined : config.apiHint
  };
}

async function readGitIdentityFile(path: string): Promise<{ name: string | null; email: string | null }> {
  try {
    const text = await readFile(path, "utf8");
    return {
      name: text.match(/^\s*name\s*=\s*(.+)$/m)?.[1]?.trim() ?? null,
      email: text.match(/^\s*email\s*=\s*(.+)$/m)?.[1]?.trim() ?? null
    };
  } catch {
    return { name: null, email: null };
  }
}

async function commandSucceeds(command: string[]): Promise<boolean> {
  try {
    await execFileAsync(command[0], command.slice(1), { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
