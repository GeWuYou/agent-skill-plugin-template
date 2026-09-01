declare module "semantic-release" {
  export interface SemanticReleaseResult {
    lastRelease: { version: string; gitTag: string; gitHead: string };
    nextRelease: { version: string; gitTag: string; gitHead: string; notes: string };
  }

  export interface SemanticReleaseOptions {
    branches?: string[];
    tagFormat?: string;
    repositoryUrl?: string;
    plugins?: unknown[];
    dryRun?: boolean;
    ci?: boolean;
  }

  export interface SemanticReleaseContext {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }

  export default function semanticRelease(
    options?: SemanticReleaseOptions,
    context?: SemanticReleaseContext,
  ): Promise<SemanticReleaseResult | false>;
}
