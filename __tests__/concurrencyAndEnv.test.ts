import { describe, expect, test } from '@jest/globals';

import { type App } from '../src/argocd/App.js';
import { AppCollection } from '../src/argocd/AppCollection.js';
import { runWithConcurrency } from '../src/argocd/ArgoCDServer.js';

function runnerApp(name: string, env: string, path = './charts/actions-runner-scale-set'): App {
  return {
    metadata: { name },
    spec: {
      source: {
        repoURL: 'https://github.com/SvavaCapital/syfe-helm-values',
        path,
        targetRevision: 'HEAD',
        plugin: {
          name: 'helmfilePlugin',
          env: [
            { name: 'ENV', value: env },
            { name: 'SELECTOR', value: `${name}-actions-runner-scale-set` }
          ]
        }
      }
    },
    status: { sync: { status: 'Synced' } }
  };
}

const saas = runnerApp('analytics-saas', 'saas-mumbai');
const nonprod = runnerApp('analytics-nonprod-sg', 'nonprod-singapore');
const noEnv: App = {
  metadata: { name: 'plain' },
  spec: { source: { repoURL: 'x', path: 'charts/actions-runner-scale-set', targetRevision: 'HEAD' } },
  status: { sync: { status: 'Synced' } }
};
const all = (): AppCollection => new AppCollection([saas, nonprod, noEnv]);
const names = (c: AppCollection): string[] => c.apps.map(a => a.metadata.name);

describe('filterByChangedFiles with matchEnvInPath', () => {
  test('values/<env>/ only selects that env (plus apps without ENV)', () => {
    const changed = ['charts/actions-runner-scale-set/values/nonprod-singapore/analytics-blue-values.yaml.gotmpl'];
    expect(names(all().filterByChangedFiles(changed, true))).toStrictEqual(['analytics-nonprod-sg', 'plain']);
  });

  test('cluster-config/<env>/ only selects that env', () => {
    const changed = ['charts/actions-runner-scale-set/cluster-config/saas-mumbai/1.34/config-analytics.json'];
    expect(names(all().filterByChangedFiles(changed, true))).toStrictEqual(['analytics-saas', 'plain']);
  });

  test('values/base/ and values/common/ select every env', () => {
    for (const shared of ['base', 'common']) {
      const changed = [`charts/actions-runner-scale-set/values/${shared}/values.yaml.gotmpl`];
      expect(names(all().filterByChangedFiles(changed, true))).toHaveLength(3);
    }
  });

  test('a file outside values/ and cluster-config/ selects every env', () => {
    const changed = ['charts/actions-runner-scale-set/values/values.yaml'];
    expect(names(all().filterByChangedFiles(changed, true))).toHaveLength(3);
  });

  test('without matchEnvInPath the path-only behaviour is unchanged', () => {
    const changed = ['charts/actions-runner-scale-set/values/nonprod-singapore/x.yaml'];
    expect(names(all().filterByChangedFiles(changed))).toHaveLength(3);
  });

  test('files outside the app path still select nothing', () => {
    const changed = ['charts/kong-3.9/values/nonprod-singapore/values.yaml'];
    expect(names(all().filterByChangedFiles(changed, true))).toStrictEqual([]);
  });
});

describe('filterByChangedFiles with pathAliases (nonprod-argo layout)', () => {
  const blue = runnerApp('analytics-blue', 'nonprod-singapore', './argocd-nonprod/charts/actions-runner-scale-set');
  const blueKong = runnerApp('kong-blue', 'nonprod-singapore', './argocd-nonprod/charts/kong-3.9');
  const apps = (): AppCollection => new AppCollection([blue, blueKong]);
  const aliases: [string, string][] = [['argocd-nonprod/', '']];

  test('a values file under charts/<chart>/values/<env>/ selects the aliased app for that env', () => {
    const changed = ['charts/actions-runner-scale-set/values/nonprod-singapore/analytics-blue-values.yaml.gotmpl'];
    expect(names(apps().filterByChangedFiles(changed, true, aliases))).toStrictEqual(['analytics-blue']);
  });

  test('another env under the aliased path does not select it', () => {
    const changed = ['charts/actions-runner-scale-set/values/saas-mumbai/analytics-values.yaml.gotmpl'];
    expect(names(apps().filterByChangedFiles(changed, true, aliases))).toStrictEqual([]);
  });

  test('a cluster-config file under the real app path still selects it', () => {
    const changed = ['argocd-nonprod/charts/kong-3.9/cluster-config/nonprod-singapore/blue/config-internal-nlb.json'];
    expect(names(apps().filterByChangedFiles(changed, true, aliases))).toStrictEqual(['kong-blue']);
  });

  test('without aliases, files under charts/<chart> do not select argocd-nonprod apps', () => {
    const changed = ['charts/kong-3.9/values/nonprod-singapore/values-internal-nlb.yaml.gotmpl'];
    expect(names(apps().filterByChangedFiles(changed, true))).toStrictEqual([]);
    expect(names(apps().filterByChangedFiles(changed, true, aliases))).toStrictEqual(['kong-blue']);
  });
});

describe('parsePathAliases', () => {
  test('parses from=to pairs and ignores junk', async () => {
    const { parsePathAliases } = await import('../src/getActionInput.js');
    expect(parsePathAliases('argocd-nonprod/=, a/=b/ ,bad,=x')).toStrictEqual([
      ['argocd-nonprod/', ''],
      ['a/', 'b/']
    ]);
    expect(parsePathAliases('')).toStrictEqual([]);
  });
});

describe('runWithConcurrency', () => {
  const tracked = (limit: number) => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, (_, i) => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      if (i === 3) throw new Error('boom');
      return i;
    });
    return { tasks, peak: () => peak, limit };
  };

  test('never runs more than the limit at once and keeps result order', async () => {
    const t = tracked(3);
    const results = await runWithConcurrency(t.tasks, t.limit);
    expect(t.peak()).toBeLessThanOrEqual(3);
    expect(results).toHaveLength(12);
    expect(results[0]).toStrictEqual({ status: 'fulfilled', value: 0 });
    expect(results[3]?.status).toBe('rejected');
    expect(results[11]).toStrictEqual({ status: 'fulfilled', value: 11 });
  });

  test('0 means no limit', async () => {
    const t = tracked(0);
    await runWithConcurrency(t.tasks, 0);
    expect(t.peak()).toBe(12);
  });

  test('empty task list resolves', async () => {
    expect(await runWithConcurrency([], 5)).toStrictEqual([]);
  });
});
