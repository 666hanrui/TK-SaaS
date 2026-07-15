export class InternalAutomationDriver {
  constructor({ handlers = {}, verifiers = {} } = {}) {
    this.handlers = handlers;
    this.verifiers = verifiers;
  }

  async acquireInternal() {}

  async observe() {
    return { authenticated: true, challengeDetected: false, pageFingerprint: "internal" };
  }

  async runInternal({ task, definition, observation }) {
    const handler = this.handlers[definition.id];
    if (!handler) throw new Error(`No internal handler registered for ${definition.id}`);
    return handler({ task, definition, observation });
  }

  async runRead() {
    throw new Error("InternalAutomationDriver cannot run browser read definitions.");
  }

  async proposeWrite() {
    throw new Error("InternalAutomationDriver cannot propose browser writes.");
  }

  async execute() {
    throw new Error("InternalAutomationDriver cannot execute browser writes.");
  }

  async verify({ task, definition, observation, result, receipt }) {
    const verifier = this.verifiers[definition.id];
    if (verifier) return verifier({ task, definition, observation, result, receipt });
    const recordsValid = result?.summary?.recordsValid === true;
    return {
      ok: recordsValid,
      checks: [
        {
          id: "internal_records_valid",
          ok: recordsValid,
          observed: result?.summary,
          message: recordsValid ? "Internal output is marked source-backed." : "Internal output is incomplete.",
        },
      ],
    };
  }

  async close() {}
}
