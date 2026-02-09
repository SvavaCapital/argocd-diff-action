import * as core from '@actions/core';
import * as github from '@actions/github';
import { ActionInput } from '../getActionInput.js';

export interface PullRequestChangedFile {
  filename: string;
  previous_filename?: string;
  status?: string;
}

// Returns list of changed file paths for the current PR run, or `null` when not running on a pull_request-ish event.
export async function getPullRequestChangedFiles(
  actionInput: ActionInput
): Promise<string[] | null> {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    return null;
  }

  const { owner, repo } = github.context.repo;
  const pull_number = github.context.issue.number;

  if (!pull_number) {
    core.warning('Could not determine pull request number from GitHub context; skipping changed-file filtering.');
    return null;
  }

  const octokit = github.getOctokit(actionInput.githubToken);

  const files = (await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number,
    per_page: 100
  })) as PullRequestChangedFile[];

  const changed: string[] = [];
  for (const f of files) {
    if (f.filename) {
      changed.push(f.filename);
    }
    // Include previous path for renames so app path matching still works.
    if (f.status === 'renamed' && f.previous_filename) {
      changed.push(f.previous_filename);
    }
  }

  return changed;
}

