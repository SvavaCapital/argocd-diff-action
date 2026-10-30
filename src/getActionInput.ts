import * as core from '@actions/core';

export interface ActionInput {
  arch: string;
  githubToken: string;
  headSha: string;
  onlyChangedApps?: boolean;
  matchEnvInPath: boolean;
  pathAliases: [string, string][];
  maxConcurrency: number;
  diffTimeoutSeconds: number;
  forceApps: string[];
  argocd: {
    excludePaths: string[];
    extraCliArgs: string;
    fqdn: string;
    protocol: string;
    token: string;
    uri: string;
    cliVersion: string;
  };
}

export function parsePathAliases(raw: string): [string, string][] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.includes('='))
    .map(s => {
      const i = s.indexOf('=');
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()] as [string, string];
    })
    .filter(([from]) => from !== '');
}

function nonNegativeInt(raw: string, fallback: number): number {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export default function getActionInput(): ActionInput {
  const useTls = core.getInput('argocd-server-tls') === 'true';
  const fqdn = core.getInput('argocd-server-fqdn');
  const protocol = useTls ? 'https' : 'http';
  let extraCliArgs = core.getInput('argocd-extra-cli-args');

  if (!useTls) {
    extraCliArgs += ' --plaintext';
  }

  const forceAppsRaw = core.getInput('force-apps').trim();
  const forceApps = forceAppsRaw ? forceAppsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  return {
    arch: process.env.ARCH || 'linux',
    headSha: core.getInput('head-sha').trim(),
    onlyChangedApps: core.getInput('only-changed-apps') === 'true',
    matchEnvInPath: core.getInput('match-env-in-path') === 'true',
    pathAliases: parsePathAliases(core.getInput('path-aliases')),
    maxConcurrency: nonNegativeInt(core.getInput('max-concurrency'), 5),
    diffTimeoutSeconds: nonNegativeInt(core.getInput('diff-timeout-seconds'), 90),
    forceApps,
    argocd: {
      excludePaths: core.getInput('argocd-exclude-paths').split(','),
      extraCliArgs,
      fqdn,
      protocol,
      token: core.getInput('argocd-token'),
      uri: `${protocol}://${fqdn}`,
      cliVersion: core.getInput('argocd-version')
    },
    githubToken: core.getInput('github-token'),
  };
}
