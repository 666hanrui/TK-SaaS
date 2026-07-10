import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

function validateProfileId(profileId) {
  if (!/^[a-zA-Z0-9._-]+$/.test(profileId)) {
    throw new Error(`Invalid browser profile id: ${profileId}`);
  }
}

export class ProfileLeaseManager {
  constructor({ rootDirectory }) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  profileDirectory(profileId) {
    validateProfileId(profileId);
    return path.join(this.rootDirectory, profileId);
  }

  lockFile(profileId) {
    return path.join(this.profileDirectory(profileId), ".worker.lock");
  }

  async acquire({ profileId, runId, at = new Date().toISOString() }) {
    const directory = this.profileDirectory(profileId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockFile = this.lockFile(profileId);
    let handle;

    try {
      handle = await open(lockFile, "wx", 0o600);
      const lease = {
        profileId,
        runId,
        pid: process.pid,
        acquiredAt: at,
      };
      await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`);
      return {
        ...lease,
        directory,
        async release() {
          await rm(lockFile, { force: true });
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let currentLease = null;
      try {
        currentLease = JSON.parse(await readFile(lockFile, "utf8"));
      } catch {
        // Preserve the lock even when its diagnostic payload is damaged.
      }
      const holder = currentLease?.runId ? ` by run ${currentLease.runId}` : "";
      throw new Error(`Browser profile ${profileId} is already leased${holder}`);
    } finally {
      await handle?.close();
    }
  }
}
