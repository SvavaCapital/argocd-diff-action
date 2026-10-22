import { appSources, sourcesForRepo, type App } from './App.js';


export class AppCollection {
  apps: App[];
  // "owner/repo" the diff is being generated for. Path- and revision-based
  // filters consider only sources from this repo; see sourcesForRepo. Empty
  // means "unknown repo", which falls back to considering every source.
  repoMatch: string;

  constructor(apps: App[], repoMatch = '') {
    this.apps = apps;
    this.repoMatch = repoMatch;
  }

  // Filters apps to those where at least one source path in this repo overlaps
  // a changed file path. Multi-source apps match on any of their sources in
  // this repo, so a change under one such source's path is enough to put the
  // whole Application in scope.
  filterByChangedFiles(changedFiles: string[]): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }

    if (changedFiles.length === 0) {
      return new AppCollection([], this.repoMatch);
    }

    const normalizedChangedFiles = changedFiles
      .filter(Boolean)
      .map(f => f.replace(/^\.\//, ''));

    return new AppCollection(
      this.apps.filter(app =>
        sourcesForRepo(app, this.repoMatch).some(source => {
          const appPathRaw = source.path;
          if (!appPathRaw) {
            return false;
          }

          const appPath = appPathRaw.replace(/\/+$/, '').replace(/^\.\//, '');

          if (appPath === '.' || appPath === '') {
            return true;
          }

          return normalizedChangedFiles.some(changedPath => {
            const p = changedPath.replace(/\/+$/, '');
            return p === appPath || p.startsWith(`${appPath}/`);
          });
        })
      ),
      this.repoMatch
    );
  }

  // Keeps apps that still have at least one path-bearing source in this repo
  // outside the excluded set. An app is only dropped when every one of its
  // paths here is excluded — excluding one source of a multi-source app must
  // not silently drop the diff for its other sources in this repo.
  filterByExcludedPath(excludedPaths: string[]): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }

    if (excludedPaths.length === 0) {
      return this;
    }

    return new AppCollection(
      this.apps.filter(app =>
        sourcesForRepo(app, this.repoMatch).some(
          source => source.path !== undefined && !excludedPaths.includes(source.path)
        )
      ),
      this.repoMatch
    );
  }

  filterByRepo(repoMatch: string): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }

    return new AppCollection(
      this.apps.filter(app =>
        appSources(app).some(
          source => source.repoURL !== undefined && source.repoURL.includes(repoMatch)
        )
      ),
      // Membership is decided here, so this is where an unknown repoMatch is learnt.
      this.repoMatch || repoMatch
    );
  }

  // Only this repo's sources are considered: the PR compares against this
  // repo's trunk, and another source tracking main says nothing about that.
  filterByTargetRevision(targetRevisions: string[] = [ 'master', 'main', 'HEAD' ]): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }
    return new AppCollection(
      this.apps.filter(app =>
        sourcesForRepo(app, this.repoMatch).some(
          source =>
            source.targetRevision !== undefined && targetRevisions.includes(source.targetRevision)
        )
      ),
      this.repoMatch
    );
  }

  getAppByName(name: string): App | undefined {
    if (this.apps.length === 0) {
      return;
    }
    return this.apps.find(app => {
      return name === app.metadata.name;
    });
  }
}
