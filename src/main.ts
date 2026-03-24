import * as core from '@actions/core';
import * as github from '@actions/github';

import { type AppTargetRevision } from './argocd/AppTargetRevision.js';
import { AppCollection } from './argocd/AppCollection.js';
import { ArgoCDServer } from './argocd/ArgoCDServer.js';
import { type Diff } from './Diff.js';
import { getPullRequestChangedFiles } from './github/getPullRequestChangedFiles.js';
import { scrubSecrets } from './lib.js';
import getActionInput, { ActionInput } from './getActionInput.js';

run().catch(e => {
  core.error(e instanceof Error ? e.stack ?? e.message : String(e));
  core.setFailed(e instanceof Error ? e.message : String(e));
});

async function run(): Promise<void> {
  const actionInput = getActionInput();
  const argocdServer = new ArgoCDServer(actionInput);
  await argocdServer.installArgoCDCommand(actionInput.argocd.cliVersion, actionInput.arch);

  let appAllCollection = await argocdServer.getAppCollection();
  if (appAllCollection.apps == null) {
    // When the account used for the API key does not have at least read-only
    // access it will result in no Applications being returned.
    core.warning(
      'No Applications were returned from Argo CD. This may be the result of insufficient privileges.'
    );
    return;
  }
  // We can only run `diff --local` on files that are for this current repo.
  // Filter Apps to those following the repo trunk, since that is what the PR is
  // comparing against (in most cases).
  let appLocalCollection = appAllCollection
    .filterByRepo(`${github.context.repo.owner}/${github.context.repo.repo}`)
    .filterByTargetRevision()
    .filterByExcludedPath(actionInput.argocd.excludePaths);

  if (actionInput.onlyChangedApps) {
    const changedFiles = await getPullRequestChangedFiles(actionInput);
    if (changedFiles) {
      const beforeCount = appLocalCollection.apps.length;
      appLocalCollection = appLocalCollection.filterByChangedFiles(changedFiles);
      core.info(
        `PR changed-files filtering enabled. Changed files: ${changedFiles.length}. Apps in scope: ${appLocalCollection.apps.length}/${beforeCount}.`
      );
      core.debug(`Changed files: ${changedFiles.join(', ')}`);
    } else if (actionInput.forceApps.length > 0) {
      // Non-PR event (e.g. issue_comment) with explicit force-apps — scope to force-apps only.
      core.info('Non-PR event with force-apps set: scoping diff to force-apps only.');
      appLocalCollection = new AppCollection([]);
    } else {
      core.warning(
        'Input `only-changed-apps` was enabled but this is not a pull_request event; running diffs for all repo apps.'
      );
    }
  }

  // Merge force-apps: add apps detected via env-values change mapping that aren't already in scope.
  if (actionInput.forceApps.length > 0) {
    core.info(`force-apps: merging ${actionInput.forceApps.length} app(s) from env-values detection: ${actionInput.forceApps.join(', ')}`);
    const existingNames = new Set(appLocalCollection.apps.map(a => a.metadata.name));
    const appsToAdd = actionInput.forceApps
      .filter(name => !existingNames.has(name))
      .map(name => appAllCollection.getAppByName(name))
      .filter((app): app is NonNullable<typeof app> => app !== undefined);
    if (appsToAdd.length > 0) {
      appLocalCollection = new AppCollection([...appLocalCollection.apps, ...appsToAdd]);
      core.info(`force-apps: added ${appsToAdd.length} app(s). Total apps in scope: ${appLocalCollection.apps.length}.`);
    } else {
      core.info('force-apps: all specified apps are already in scope or not found in ArgoCD.');
    }
  }

  core.info(`Apps in scope: ${appLocalCollection.apps.length}`);
  core.debug(`Apps in scope: ${appLocalCollection.apps.map(a => a.metadata.name).join(', ')}`);

  let appDiffs = await argocdServer.getAppCollectionLocalDiffs(appLocalCollection);

  // Get diffs for apps of apps with targetRevision changes from local app diffs.
  // Note that this won't include any other changes to the App of App (e.g., Helm
  // value changes).
  let appOfAppTargetRevisions = getAppOfAppTargetRevisions(appDiffs);
  let appOfAppDiffs = await argocdServer.getAppCollectionRevisionDiffs(
    appAllCollection,
    appOfAppTargetRevisions
  );

  await postDiffComment([...appDiffs, ...appOfAppDiffs], actionInput);
}

async function postDiffComment(diffs: Diff[], actionInput: ActionInput): Promise<void> {
  const octokit = github.getOctokit(actionInput.githubToken);
  const { owner, repo } = github.context.repo;
  const sha = actionInput.headSha || github.context.payload.pull_request?.head?.sha;

  const commitLink = sha
    ? `https://github.com/${owner}/${repo}/pull/${github.context.issue.number}/commits/${sha}`
    : `https://github.com/${owner}/${repo}/pull/${github.context.issue.number}`;
  const shortCommitSha = sha ? String(sha).substring(0, 7) : 'on-demand';

  const diffOutput = diffs.map(
    ({ app, diff, error }) => `
App: [\`${app.metadata.name}\`](${actionInput.argocd.uri}/applications/${app.metadata.name})
YAML generation: ${error ? ' Error 🛑' : 'Success 🟢'}
App sync status: ${app.status.sync.status === 'Synced' ? 'Synced ✅' : 'Out of Sync ⚠️ '}
${
  error
    ? `
**\`stderr:\`**
\`\`\`
${error.stderr}
\`\`\`

**\`command:\`**
\`\`\`json
${JSON.stringify(error.err)}
\`\`\`
`
    : ''
}

${
  diff
    ? `
<details>

\`\`\`diff
${diff}
\`\`\`

</details>
`
    : ''
}
---
`
  );

  // Use a unique value at the beginning of each comment so we can find the correct comment for the argocd server FQDN
  const headerPrefix = `<!-- argocd-diff-action ${actionInput.argocd.fqdn} -->`;
  const header = `${headerPrefix}
## ArgoCD Diff ${actionInput.argocd.fqdn} for commit [\`${shortCommitSha}\`](${commitLink})
`;

  const output = scrubSecrets(`${header}
_Updated at ${new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' })} IST_
  ${diffOutput.join('\n')}

| Legend | Status |
| :---:  | :---   |
| ✅     | The app is synced in ArgoCD, and diffs you see are solely from this PR. |
| ⚠️      | The app is out-of-sync in ArgoCD, and the diffs you see include those changes plus any from this PR. |
| 🛑     | There was an error generating the ArgoCD diffs due to changes in this PR. |
`);

  const commentsResponse = await octokit.rest.issues.listComments({
    issue_number: github.context.issue.number,
    owner,
    repo
  });

  const existingComment = commentsResponse.data.find(
    d => d.body?.includes(headerPrefix) ?? false
  );

  // Existing comments should be updated even if there are no changes this round in order to indicate that
  if (existingComment) {
    octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body: output
    });
    // Only post a new comment when there are changes
  } else if (diffs.length) {
    octokit.rest.issues.createComment({
      issue_number: github.context.issue.number,
      owner,
      repo,
      body: output
    });
  }
}

function getAppOfAppTargetRevisions(diffs: Diff[]): AppTargetRevision[] {
  let appTargetRevisions: AppTargetRevision[] = [];
  diffs.forEach(appDiff => {
    // Check for diffs of an Application (App of App).
    if (appDiff.diff.includes('argoproj.io/Application')) {
      core.debug(`Found Application in the diff for Application '${appDiff.app.metadata.name}'.`);
      let changedResourceDiffs = appDiff.diff.split('===== ([\\w\\S]+/[\\w\\S]+ ){2}======');

      changedResourceDiffs.forEach(async diff => {
        let match = diff.match(
          '===== (?:argoproj.io\\/Application) (\\w+/\\S+) ======\\n(?:.*\\n)*>\\s+targetRevision: (.*)'
        );
        if (match) {
          const appName = match[1]?.split('/')[1] ?? 'undefined';
          const targetRevision = match[2] ?? 'undefined';
          core.info(
            `Found targetRevision change on Application '${appName}' of Application '${appDiff.app.metadata.name}'.`
          );
          appTargetRevisions.push({ appName: appName, targetRevision: targetRevision });
        }
      });
    } else {
      core.debug(
        `No targetRevision change found in Applications of Application '${appDiff.app.metadata.name}'.`
      );
    }
  });
  return appTargetRevisions;
}
