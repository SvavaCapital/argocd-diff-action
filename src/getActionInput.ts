import * as core from '@actions/core';
import * as github from '@actions/github';

export interface ActionInput {
  arch: string;
  githubToken: string;
  headSha: string;
  onlyChangedApps?: boolean;
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
    // `head-sha` is only supplied by non-PR callers (e.g. issue_comment). Fall
    // back to the PR head so multi-source diffs, which must pin a revision, work
    // on a plain pull_request event without the caller passing anything.
    headSha:
      core.getInput('head-sha').trim() ||
      github.context.payload.pull_request?.head?.sha ||
      '',
    onlyChangedApps: core.getInput('only-changed-apps') === 'true',
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
