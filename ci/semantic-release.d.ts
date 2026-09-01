declare module "semantic-release" {
  export interface SemanticReleaseResult {
    lastRelease: { version: string; gitTag: string; gitHead: string };
    nextRelease: { version: string; gitTag: string; gitHead: string; notes: string };
  }
  export default function semanticRelease(options?: Record<string, unknown>, context?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<SemanticReleaseResult | false>;
}
