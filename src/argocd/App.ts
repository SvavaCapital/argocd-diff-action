export interface AppSource {
  repoURL: string;
  path?: string;
  chart?: string;
  targetRevision?: string;
  // Multi-source Applications use `ref` to name a source that other sources
  // reference (e.g. a shared chart repo) rather than render directly.
  ref?: string;
  kustomize?: Object;
  helm?: Object;
  plugin?: Object;
}

export interface App {
  metadata: { name: string };
  spec: {
    // Single-source Applications populate `source`. Multi-source Applications
    // populate `sources` and leave `source` unset — the two are mutually
    // exclusive in the Argo CD API, so every read must go through appSources().
    source?: AppSource;
    sources?: AppSource[];
  };
  status: {
    sync: {
      status: 'OutOfSync' | 'Synced';
    };
  };
}

// Every source of an Application, whether single- or multi-source. Returns an
// empty array for an Application with neither, so callers can filter without
// special-casing.
export function appSources(app: App): AppSource[] {
  if (app.spec.sources && app.spec.sources.length > 0) {
    return app.spec.sources;
  }
  return app.spec.source ? [app.spec.source] : [];
}

// Sources belonging to `repoMatch`. Path- and revision-based filtering must use
// this rather than appSources(): a source from another repo can carry path '.'
// or track main, which would put the Application in scope on changes that touch
// nothing it renders from this repo. An empty repoMatch keeps every source.
export function sourcesForRepo(app: App, repoMatch: string): AppSource[] {
  const sources = appSources(app);
  if (!repoMatch) {
    return sources;
  }
  return sources.filter(source => source.repoURL?.includes(repoMatch));
}

export function isMultiSource(app: App): boolean {
  return (app.spec.sources?.length ?? 0) > 0;
}

// Position of the first source whose repoURL contains `repoMatch`, 1-indexed
// because that is the indexing `argocd app diff --source-positions` expects.
// Returns undefined when no source belongs to that repo.
export function sourcePositionForRepo(app: App, repoMatch: string): number | undefined {
  if (!repoMatch) {
    return undefined;
  }
  const index = appSources(app).findIndex(source => source.repoURL?.includes(repoMatch));
  return index === -1 ? undefined : index + 1;
}
