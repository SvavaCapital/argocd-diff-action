import { expect, test, describe, beforeEach, afterEach } from '@jest/globals';
import * as core from '@actions/core';
import { jest } from '@jest/globals';

import { AppCollection } from '../src/argocd/AppCollection.js';
import { type App } from '../src/argocd/App.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(name: string, path: string, repoURL = 'https://github.com/SvavaCapital/syfe-helm-values'): App {
  return {
    metadata: { name },
    spec: {
      source: {
        repoURL,
        path,
        targetRevision: 'main',
        helm: {},
        kustomize: {}
      }
    },
    status: { sync: { status: 'Synced' } }
  };
}

// ---------------------------------------------------------------------------
// Tests: getActionInput — forceApps parsing
// ---------------------------------------------------------------------------

describe('getActionInput: forceApps parsing', () => {
  let getInputMock: jest.MockedFunction<typeof core.getInput>;

  beforeEach(() => {
    getInputMock = jest.spyOn(core, 'getInput') as jest.MockedFunction<typeof core.getInput>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('parses a comma-separated force-apps string into an array', async () => {
    getInputMock.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'force-apps': 'app-one,app-two,app-three',
        'only-changed-apps': 'true',
        'argocd-server-tls': 'true',
        'argocd-server-fqdn': 'argocd.example',
        'argocd-extra-cli-args': '--grpc-web',
        'argocd-exclude-paths': '',
        'argocd-token': 'token',
        'argocd-version': '',
        'github-token': 'gh-token',
      };
      return inputs[name] ?? '';
    });

    const { default: getActionInput } = await import('../src/getActionInput.js');
    const input = getActionInput();
    expect(input.forceApps).toStrictEqual(['app-one', 'app-two', 'app-three']);
  });

  test('returns empty array when force-apps input is empty string', async () => {
    getInputMock.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'force-apps': '',
        'only-changed-apps': 'false',
        'argocd-server-tls': 'true',
        'argocd-server-fqdn': 'argocd.example',
        'argocd-extra-cli-args': '--grpc-web',
        'argocd-exclude-paths': '',
        'argocd-token': 'token',
        'argocd-version': '',
        'github-token': 'gh-token',
      };
      return inputs[name] ?? '';
    });

    const { default: getActionInput } = await import('../src/getActionInput.js');
    const input = getActionInput();
    expect(input.forceApps).toStrictEqual([]);
  });

  test('trims whitespace from each app name in force-apps', async () => {
    getInputMock.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'force-apps': ' app-one , app-two , app-three ',
        'only-changed-apps': 'false',
        'argocd-server-tls': 'true',
        'argocd-server-fqdn': 'argocd.example',
        'argocd-extra-cli-args': '--grpc-web',
        'argocd-exclude-paths': '',
        'argocd-token': 'token',
        'argocd-version': '',
        'github-token': 'gh-token',
      };
      return inputs[name] ?? '';
    });

    const { default: getActionInput } = await import('../src/getActionInput.js');
    const input = getActionInput();
    expect(input.forceApps).toStrictEqual(['app-one', 'app-two', 'app-three']);
  });
});

// ---------------------------------------------------------------------------
// Tests: force-apps merge logic (mirrors the logic in main.ts)
// ---------------------------------------------------------------------------

describe('force-apps merge logic', () => {
  const appEbs    = makeApp('aws-ebs-csi-saas-mumbai-1-34', 'charts/aws-ebs-csi-driver');
  const appKarp   = makeApp('karpenter-saas-mumbai-1-34',   'charts/karpenter');
  const appKong   = makeApp('kong-public-saas-mumbai-1-34', 'charts/kong');
  const appDirect = makeApp('directly-changed-app',         'charts/directly-changed');

  // allCollection represents everything ArgoCD knows about
  const allCollection = new AppCollection([appEbs, appKarp, appKong, appDirect]);

  // localCollection starts with only the directly-changed app (normal changed-file filter)
  const localCollection = new AppCollection([appDirect]);

  function mergeForceApps(forceApps: string[]): AppCollection {
    // Identical to the logic added in main.ts
    const existingNames = new Set(localCollection.apps.map(a => a.metadata.name));
    const appsToAdd = forceApps
      .filter(name => !existingNames.has(name))
      .map(name => allCollection.getAppByName(name))
      .filter((app): app is NonNullable<typeof app> => app !== undefined);
    if (appsToAdd.length > 0) {
      return new AppCollection([...localCollection.apps, ...appsToAdd]);
    }
    return localCollection;
  }

  test('adds force-apps that are not already in scope', () => {
    const result = mergeForceApps(['aws-ebs-csi-saas-mumbai-1-34', 'karpenter-saas-mumbai-1-34']);
    const names = result.apps.map(a => a.metadata.name).sort();
    expect(names).toStrictEqual([
      'aws-ebs-csi-saas-mumbai-1-34',
      'directly-changed-app',
      'karpenter-saas-mumbai-1-34',
    ]);
  });

  test('does not duplicate an app already in scope', () => {
    const result = mergeForceApps(['directly-changed-app', 'karpenter-saas-mumbai-1-34']);
    const names = result.apps.map(a => a.metadata.name).sort();
    expect(names).toStrictEqual(['directly-changed-app', 'karpenter-saas-mumbai-1-34']);
  });

  test('silently skips app names not found in ArgoCD (allCollection)', () => {
    const result = mergeForceApps(['non-existent-app', 'karpenter-saas-mumbai-1-34']);
    const names = result.apps.map(a => a.metadata.name).sort();
    expect(names).toStrictEqual(['directly-changed-app', 'karpenter-saas-mumbai-1-34']);
  });

  test('returns localCollection unchanged when force-apps is empty', () => {
    const result = mergeForceApps([]);
    expect(result).toStrictEqual(localCollection);
  });

  test('returns localCollection unchanged when all force-apps already in scope', () => {
    const result = mergeForceApps(['directly-changed-app']);
    expect(result).toStrictEqual(localCollection);
  });

  test('merges all three force-apps correctly', () => {
    const result = mergeForceApps([
      'aws-ebs-csi-saas-mumbai-1-34',
      'karpenter-saas-mumbai-1-34',
      'kong-public-saas-mumbai-1-34',
    ]);
    expect(result.apps).toHaveLength(4);
    const names = result.apps.map(a => a.metadata.name).sort();
    expect(names).toStrictEqual([
      'aws-ebs-csi-saas-mumbai-1-34',
      'directly-changed-app',
      'karpenter-saas-mumbai-1-34',
      'kong-public-saas-mumbai-1-34',
    ]);
  });
});
