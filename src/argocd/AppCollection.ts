import { appSources, type App } from './App.js';


export class AppCollection {
  apps: App[];

  constructor(apps: App[]) {
    this.apps = apps;
  }

  // Filters apps to those where at least one source path overlaps a changed
  // file path. Multi-source apps match on any of their sources, so a change to
  // one source's path is enough to put the whole Application in scope.
  filterByChangedFiles(changedFiles: string[]): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }

    if (changedFiles.length === 0) {
      return new AppCollection([]);
    }

    const normalizedChangedFiles = changedFiles
      .filter(Boolean)
      .map(f => f.replace(/^\.\//, ''));

    return new AppCollection(
      this.apps.filter(app =>
        appSources(app).some(source => {
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
      )
    );
  }

  // Keeps apps that still have at least one path-bearing source outside the
  // excluded set. An app is only dropped when every one of its paths is
  // excluded — excluding one source of a multi-source app must not silently
  // drop the diff for its other sources.
  filterByExcludedPath(excludedPaths: string[]): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }

    if (excludedPaths.length === 0) {
      return this;
    }

    return new AppCollection(
      this.apps.filter(app =>
        appSources(app).some(
          source => source.path !== undefined && !excludedPaths.includes(source.path)
        )
      )
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
      )
    );
  }

  filterByTargetRevision(targetRevisions: string[] = [ 'master', 'main', 'HEAD' ]): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }
    return new AppCollection(
      this.apps.filter(app =>
        appSources(app).some(
          source =>
            source.targetRevision !== undefined && targetRevisions.includes(source.targetRevision)
        )
      )
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
