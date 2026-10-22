import { expect, test, jest, describe, beforeEach } from '@jest/globals';

import {
  appSources,
  isMultiSource,
  sourcePositionForRepo,
  type App
} from '../../src/argocd/App.js';
import { AppCollection } from '../../src/argocd/AppCollection.js';
import { ArgoCDServer } from '../../src/argocd/ArgoCDServer.js';
import { execCommand, type ExecResult } from '../../src/lib.js';
import { ActionInput } from '../../src/getActionInput.js';

jest.mock('../../src/lib');
const mockedExecCommand = jest.mocked(execCommand);

const REPO = 'SvavaCapital/services-launchpad';
const HEAD_SHA = '0cb2d40cba210bffa1e7bcbfc17423203e1b8ab4';

describe('App multi-source helpers', () => {
  test('appSources returns every source of a multi-source app', () => {
    expect(appSources(multiSourceApp()).map(s => s.repoURL)).toStrictEqual([
      'https://github.com/SvavaCapital/launchpad-engine.git',
      'https://github.com/SvavaCapital/services-launchpad.git',
      'https://github.com/SvavaCapital/alfred-manifests.git'
    ]);
  });

  test('appSources wraps a single-source app in an array', () => {
    expect(appSources(singleSourceApp())).toStrictEqual([singleSourceApp().spec.source]);
  });

  test('appSources returns empty for an app with neither source nor sources', () => {
    expect(appSources(sourcelessApp())).toStrictEqual([]);
  });

  test('isMultiSource distinguishes the two shapes', () => {
    expect(isMultiSource(multiSourceApp())).toBe(true);
    expect(isMultiSource(singleSourceApp())).toBe(false);
    expect(isMultiSource(sourcelessApp())).toBe(false);
  });

  test('sourcePositionForRepo is 1-indexed, matching --source-positions', () => {
    expect(sourcePositionForRepo(multiSourceApp(), REPO)).toBe(2);
    expect(sourcePositionForRepo(singleSourceApp(), REPO)).toBe(1);
  });

  test('sourcePositionForRepo returns undefined when nothing matches', () => {
    expect(sourcePositionForRepo(multiSourceApp(), 'SvavaCapital/unrelated')).toBeUndefined();
  });

  test('sourcePositionForRepo returns undefined for an empty repoMatch', () => {
    // Guards against an empty match resolving to position 1 via ''.includes().
    expect(sourcePositionForRepo(multiSourceApp(), '')).toBeUndefined();
  });
});

describe('AppCollection with multi-source apps', () => {
  test('filterByRepo matches a source that is not the first', () => {
    expect(new AppCollection([multiSourceApp()]).filterByRepo(REPO).apps).toStrictEqual([
      multiSourceApp()
    ]);
  });

  test('filterByRepo still excludes apps with no source in this repo', () => {
    expect(
      new AppCollection([multiSourceApp()]).filterByRepo('SvavaCapital/unrelated').apps
    ).toStrictEqual([]);
  });

  test('filterByTargetRevision matches any source on the trunk', () => {
    // Source 1 is pinned to a tag; source 2 tracks HEAD.
    expect(new AppCollection([multiSourceApp()]).filterByTargetRevision().apps).toStrictEqual([
      multiSourceApp()
    ]);
  });

  test('filterByChangedFiles matches a change under any source path', () => {
    expect(
      new AppCollection([multiSourceApp()]).filterByChangedFiles(['syfe/alfred/service.yaml']).apps
    ).toStrictEqual([multiSourceApp()]);
  });

  test('filterByChangedFiles drops the app when no source path matches', () => {
    expect(
      new AppCollection([multiSourceApp()]).filterByChangedFiles(['selfwealth/sw-cx/service.yaml'])
        .apps
    ).toStrictEqual([]);
  });

  test('filterByExcludedPath keeps the app while any source path survives', () => {
    expect(
      new AppCollection([multiSourceApp()]).filterByExcludedPath(['syfe/alfred']).apps
    ).toStrictEqual([multiSourceApp()]);
  });

  test('filterByExcludedPath drops the app when every source path is excluded', () => {
    expect(
      new AppCollection([multiSourceApp()]).filterByExcludedPath([
        'syfe/alfred',
        'charts/alfred'
      ]).apps
    ).toStrictEqual([]);
  });
});

describe('ArgoCDServer multi-source diff', () => {
  beforeEach(() => {
    mockedExecCommand.mockReset();
  });

  // Asserted with stringContaining so these cases pin the multi-source flags
  // only. The surrounding `app diff --local-repo-root=... --exit-code=false
  // --server=...` scaffolding is already asserted in full by
  // ArgoCDServer.test.ts; repeating it here would just duplicate that coverage.
  test('diffs with --server-side-generate pinned to this repo source position', async () => {
    mockedExecCommand.mockReturnValueOnce(Promise.resolve(execResult()));

    await argocdServer().getAppLocalDiff(multiSourceApp());

    expect(mockedExecCommand).toHaveBeenCalledWith(
      expect.stringContaining(
        `${multiSourceApp().metadata.name} --server-side-generate ` +
          `--source-positions=2 --revisions=${HEAD_SHA} --exit-code=false`
      )
    );
  });

  test('single-source apps keep using --local', async () => {
    mockedExecCommand.mockReturnValueOnce(Promise.resolve(execResult()));

    await argocdServer().getAppLocalDiff(singleSourceApp());

    expect(mockedExecCommand).toHaveBeenCalledWith(
      expect.stringContaining(
        `${singleSourceApp().metadata.name} --local=${singleSourceApp().spec.source?.path}`
      )
    );
    expect(mockedExecCommand).not.toHaveBeenCalledWith(
      expect.stringContaining('--server-side-generate')
    );
  });

  test('returns an empty diff and runs nothing when no source is in this repo', async () => {
    await expect(
      argocdServer('SvavaCapital/unrelated').getAppLocalDiff(multiSourceApp())
    ).resolves.toStrictEqual({ app: multiSourceApp(), diff: '' });
    expect(mockedExecCommand).not.toHaveBeenCalled();
  });

  test('returns an empty diff and runs nothing without a head SHA', async () => {
    // A multi-source diff must pin a revision, so there is nothing sensible to
    // run when the SHA is unknown.
    await expect(
      argocdServer(REPO, '').getAppLocalDiff(multiSourceApp())
    ).resolves.toStrictEqual({ app: multiSourceApp(), diff: '' });
    expect(mockedExecCommand).not.toHaveBeenCalled();
  });
});

// getAppLocalDiff routes multi-source apps correctly on its own, so the cases
// above pass even when the collection-level caller never reaches it. These
// drive the real entry point instead.
describe('ArgoCDServer.getAppCollectionLocalDiffs source selection', () => {
  beforeEach(() => {
    mockedExecCommand.mockReset();
  });

  test('dispatches a diff for a multi-source app', async () => {
    mockedExecCommand.mockReturnValue(Promise.resolve(execResult()));

    await argocdServer().getAppCollectionLocalDiffs(new AppCollection([multiSourceApp()]));

    expect(mockedExecCommand).toHaveBeenCalledWith(
      expect.stringContaining('--server-side-generate')
    );
  });

  test('dispatches a diff for a single-source app', async () => {
    mockedExecCommand.mockReturnValue(Promise.resolve(execResult()));

    await argocdServer().getAppCollectionLocalDiffs(new AppCollection([singleSourceApp()]));

    expect(mockedExecCommand).toHaveBeenCalledWith(
      expect.stringContaining(`--local=${singleSourceApp().spec.source?.path}`)
    );
  });

  test('runs nothing for an app with no source at all', async () => {
    await argocdServer().getAppCollectionLocalDiffs(new AppCollection([sourcelessApp()]));

    expect(mockedExecCommand).not.toHaveBeenCalled();
  });
});

function multiSourceApp(): App {
  return {
    metadata: { name: 'alfred-nonprod-mumbai-1-34' },
    spec: {
      sources: [
        {
          repoURL: 'https://github.com/SvavaCapital/launchpad-engine.git',
          targetRevision: 'v1.4.2',
          ref: 'scaffold'
        },
        {
          repoURL: 'https://github.com/SvavaCapital/services-launchpad.git',
          targetRevision: 'HEAD',
          path: 'syfe/alfred',
          plugin: { name: 'helmfilePlugin' }
        },
        {
          repoURL: 'https://github.com/SvavaCapital/alfred-manifests.git',
          targetRevision: 'main',
          path: 'charts/alfred'
        }
      ]
    },
    status: { sync: { status: 'Synced' } }
  };
}

function singleSourceApp(): App {
  return {
    metadata: { name: 'app-one' },
    spec: {
      source: {
        repoURL: 'https://github.com/SvavaCapital/services-launchpad',
        path: 'deploy/app-one',
        targetRevision: 'HEAD'
      }
    },
    status: { sync: { status: 'Synced' } }
  };
}

function sourcelessApp(): App {
  return {
    metadata: { name: 'app-none' },
    spec: {},
    status: { sync: { status: 'Synced' } }
  };
}

function execResult(): ExecResult {
  return { stdout: '', stderr: '' };
}

// Sets only the fields ArgoCDServer actually reads. The credential fields are
// deliberately left unset — these cases assert on the multi-source flags, and
// the full command string including the auth suffix is already asserted by
// ArgoCDServer.test.ts. Cast because the omitted fields are irrelevant here.
function argocdServer(repoMatch = REPO, headSha = HEAD_SHA): ArgoCDServer {
  const actionInput = {
    arch: 'linux',
    headSha,
    forceApps: [],
    argocd: {
      excludePaths: [],
      extraCliArgs: '',
      fqdn: 'argocd.example',
      protocol: 'https',
      uri: 'https://argocd.example',
      cliVersion: '1.0.0'
    }
  } as unknown as ActionInput;
  return new ArgoCDServer(actionInput, repoMatch);
}
