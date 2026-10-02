import type { AuthenticatedIdentity } from "../auth/identity.js";

declare global {
  // Express's own documented pattern for augmenting its Request type —
  // there is no ES2015-module equivalent for extending a third-party
  // global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Present only after the `authenticate` middleware has run
       * successfully. Always derived from the verified session token —
       * never from client-supplied body/query/header values (PRD: "Never
       * trust schoolId or role supplied by the frontend").
       */
      auth?: AuthenticatedIdentity;
    }
  }
}

export {};
