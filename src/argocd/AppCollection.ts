import { type App } from './App.js';

const SHARED_ENV_DIRS = ['base', 'common'];

function envFromPath(relativePath: string): string | undefined {
  const match = /(?:^|\/)(?:values|cluster-config)\/([^/]+)\//.exec(relativePath);
  return match?.[1];
}

export class AppCollection {
  apps: App[];

  constructor(apps: App[]) {
    this.apps = apps;
  }

  // Filters apps to those whose `spec.source.path` overlaps at least one changed file path.
  // With matchEnvInPath, a file under `<path>/values/<env>/` or `<path>/cluster-config/<env>/`
  // only selects apps whose plugin env `ENV` is <env>; `base` and `common` select every app,
  // and apps without an `ENV` are always kept.
  // pathAliases maps an app path prefix to extra prefixes whose files also belong to the app
  // (e.g. ['argocd-nonprod/', ''] makes argocd-nonprod/charts/x also match charts/x/...).
  filterByChangedFiles(
    changedFiles: string[],
    matchEnvInPath = false,
    pathAliases: [string, string][] = []
  ): AppCollection {
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

        const appEnv = app.spec.source?.plugin?.env?.find(e => e.name === 'ENV')?.value;
        const candidatePaths = [appPath];
        for (const [from, to] of pathAliases) {
          if (from !== '' && appPath.startsWith(from)) {
            candidatePaths.push(`${to}${appPath.slice(from.length)}`);
          }
        }

        return normalizedChangedFiles.some(changedPath => {
          const p = changedPath.replace(/\/+$/, '');
          const base = candidatePaths.find(c => p === c || p.startsWith(`${c}/`));
          if (base === undefined) {
            return false;
          }
          if (!matchEnvInPath || appEnv === undefined || appEnv === '') {
            return true;
          }
          const fileEnv = envFromPath(p.slice(base.length + 1));
          return fileEnv === undefined || SHARED_ENV_DIRS.includes(fileEnv) || fileEnv === appEnv;
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
