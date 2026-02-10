import { describe, expect, test, jest, beforeEach } from '@jest/globals';

import * as core from '@actions/core';
import * as github from '@actions/github';

import { getPullRequestChangedFiles } from '../../src/github/getPullRequestChangedFiles.js';
import { type PullRequestChangedFile } from '../../src/github/getPullRequestChangedFiles.js';
import { type ActionInput } from '../../src/getActionInput.js';

jest.mock('@actions/core');
jest.mock('@actions/github');

const mockedCore = jest.mocked(core);
const mockedGithub = jest.mocked(github);

describe('getPullRequestChangedFiles', () => {
  beforeEach(() => {
    mockedCore.warning.mockReset();
    (mockedGithub.getOctokit as unknown as jest.Mock).mockReset();

    // Default context: not a PR event
    (mockedGithub as any).context = {
      payload: {},
      repo: { owner: 'o', repo: 'r' },
      issue: { number: 123 }
    };
  });

  test('returns null when not running on pull_request', async () => {
    const res = await getPullRequestChangedFiles(fakeActionInput());
    expect(res).toBeNull();
  });

  test('returns null and warns when PR number is missing', async () => {
    (mockedGithub as any).context = {
      payload: { pull_request: {} },
      repo: { owner: 'o', repo: 'r' },
      issue: { number: undefined }
    };

    const res = await getPullRequestChangedFiles(fakeActionInput());
    expect(res).toBeNull();
    expect(mockedCore.warning).toHaveBeenCalledTimes(1);
  });

  test('returns filenames and previous_filename for renamed files', async () => {
    const listFiles = { __tag: 'listFiles' };
    const paginate = jest.fn(async () => [] as PullRequestChangedFile[]);
    paginate.mockResolvedValue([
      { filename: 'deploy/app-one/values.yaml' },
      { filename: 'deploy/app-two/values.yaml', status: 'renamed', previous_filename: 'deploy/app-old/values.yaml' }
    ]);

    (mockedGithub as any).context = {
      payload: { pull_request: {} },
      repo: { owner: 'o', repo: 'r' },
      issue: { number: 123 }
    };

    (mockedGithub.getOctokit as unknown as jest.Mock).mockReturnValue({
      paginate,
      rest: { pulls: { listFiles } }
    });

    const res = await getPullRequestChangedFiles(fakeActionInput());
    expect(res).toStrictEqual([
      'deploy/app-one/values.yaml',
      'deploy/app-two/values.yaml',
      'deploy/app-old/values.yaml'
    ]);

    expect(paginate).toHaveBeenCalledWith(listFiles, {
      owner: 'o',
      repo: 'r',
      pull_number: 123,
      per_page: 100
    });
  });
});

function fakeActionInput(): ActionInput {
  return {
    arch: 'linux',
    githubToken: 'fake',
    onlyChangedApps: true,
    argocd: {
      excludePaths: [],
      extraCliArgs: '--grpc-web',
      fqdn: 'argocd.example',
      protocol: 'https',
      token: 'fake',
      uri: 'https://argocd.example',
      cliVersion: ''
    }
  };
}

