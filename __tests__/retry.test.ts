import { describe, expect, jest, test } from '@jest/globals';

import { type App } from '../src/argocd/App.js';
import { ArgoCDServer, isTransientGatewayError } from '../src/argocd/ArgoCDServer.js';
import { type ActionInput } from '../src/getActionInput.js';
import { type ExecResult } from '../src/lib.js';

const app: App = {
  metadata: { name: 'datadog-prod-sydney-1-34' },
  spec: { source: { repoURL: 'x', path: './charts/datadog', targetRevision: 'HEAD' } },
  status: { sync: { status: 'Synced' } }
};

function server(retries: number): ArgoCDServer {
  const input: ActionInput = {
    arch: 'linux',
    headSha: '',
    githubToken: 'fake',
    forceApps: [],
    matchEnvInPath: false,
    pathAliases: [],
    maxConcurrency: 5,
    diffTimeoutSeconds: 90,
    diffRetries: retries,
    argocd: {
      excludePaths: [],
      extraCliArgs: '',
      fqdn: 'argocd.example',
      protocol: 'https',
      token: 'fake',
      uri: 'https://argocd.example',
      cliVersion: ''
    }
  };
  const s = new ArgoCDServer(input);
  s.retryBaseDelayMs = 0;
  return s;
}

const gateway504: ExecResult = {
  stdout: '',
  stderr: '',
  err: new Error('rpc error: GetManifests failed with status code 504')
};
const otherError: ExecResult = { stdout: '', stderr: 'permission denied', err: new Error('exit 20') };
const ok: ExecResult = { stdout: '===== diff =====', stderr: '' };

describe('isTransientGatewayError', () => {
  test('matches 502/503/504 in the error or stderr only', () => {
    expect(isTransientGatewayError(gateway504)).toBe(true);
    expect(isTransientGatewayError({ stdout: '', stderr: 'failed with status code 502' })).toBe(true);
    expect(isTransientGatewayError({ stdout: '', stderr: 'failed with status code 503' })).toBe(true);
    expect(isTransientGatewayError({ stdout: '', stderr: 'failed with status code 500' })).toBe(false);
    expect(isTransientGatewayError(otherError)).toBe(false);
  });
});

describe('getAppDiff retries', () => {
  test('retries a 504 and returns the diff once it succeeds', async () => {
    const s = server(2);
    const cmd = jest.spyOn(s, 'command').mockRejectedValueOnce(gateway504).mockResolvedValueOnce(ok);
    const diff = await s.getAppDiff(app);
    expect(cmd).toHaveBeenCalledTimes(2);
    expect(diff.error).toBeUndefined();
    expect(diff.diff).toBe(ok.stdout);
  });

  test('gives up after the configured retries', async () => {
    const s = server(2);
    const cmd = jest.spyOn(s, 'command').mockRejectedValue(gateway504);
    const diff = await s.getAppDiff(app);
    expect(cmd).toHaveBeenCalledTimes(3);
    expect(diff.error).toBe(gateway504);
  });

  test('does not retry non-gateway errors', async () => {
    const s = server(2);
    const cmd = jest.spyOn(s, 'command').mockRejectedValue(otherError);
    const diff = await s.getAppDiff(app);
    expect(cmd).toHaveBeenCalledTimes(1);
    expect(diff.error).toBe(otherError);
  });

  test('0 retries means a single attempt', async () => {
    const s = server(0);
    const cmd = jest.spyOn(s, 'command').mockRejectedValue(gateway504);
    await s.getAppDiff(app);
    expect(cmd).toHaveBeenCalledTimes(1);
  });
});
