// Thrown by an integration adapter when the teammate module it delegates to does not
// exist yet. Routes map it to a clear error instead of guessing.
export type IntegrationName = "window" | "audit";

export class IntegrationUnavailableError extends Error {
  constructor(readonly integration: IntegrationName) {
    super(`Integration "${integration}" is not available yet`);
    this.name = "IntegrationUnavailableError";
  }
}
