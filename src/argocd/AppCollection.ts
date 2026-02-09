import { type App } from './App.js';


export class AppCollection {
  apps: App[];

  constructor(apps: App[]) {
    this.apps = apps;
  }

  // Filters apps to those whose `spec.source.path` overlaps at least one changed file path 
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
      this.apps.filter(app => {
        const appPathRaw = app.spec.source?.path;
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
    );
  }

  filterByExcludedPath(excludedPaths: string[]): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }

    if (excludedPaths.length === 0) {
      return this;
    }

    return new AppCollection(
      this.apps.filter(app => {
        return app.spec.source?.path !== undefined && !excludedPaths.includes(app.spec.source.path);
      })
    );
  }

  filterByRepo(repoMatch: string): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }

    return new AppCollection(
      this.apps.filter(app => {
        return app.spec.source?.repoURL !== undefined && app.spec.source.repoURL.includes(repoMatch);
      })
    );
  }

  filterByTargetRevision(targetRevisions: string[] = [ 'master', 'main', 'HEAD' ]): AppCollection {
    if (this.apps.length === 0) {
      return this;
    }
    return new AppCollection(
      this.apps.filter(app => {
        return app.spec.source?.targetRevision !== undefined && targetRevisions.includes(app.spec.source.targetRevision);
      })
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
