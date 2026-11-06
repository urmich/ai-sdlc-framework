export function createCaptureProcessOwner() {
  const records = [];
  return {
    track(child, role) {
      const record = { child, role, stopRequested: false, stopSent: false, closed: false,
        exitCode: null, signal: null };
      record.closedPromise = new Promise(resolve => {
        child.once('close', (code, signal) => {
          Object.assign(record, { closed: true, exitCode: code, signal });
          resolve();
        });
      });
      const kill = child.kill.bind(child);
      child.kill = (...args) => {
        record.stopRequested = true;
        const sent = kill(...args);
        record.stopSent ||= sent === true;
        return sent;
      };
      records.push(record);
      return child;
    },
    async settle() {
      const failures = [];
      for (const role of ['controller', 'root']) {
        for (const record of records.filter(value => value.role === role)) {
          let timer;
          try {
            if (!record.closed && record.child.exitCode === null && record.child.signalCode === null
                && !record.stopRequested && record.child.kill('SIGKILL') !== true) {
              throw Object.assign(new Error(`Owned capture ${role} stop could not be verified.`),
                { code: 'STOP_UNVERIFIED' });
            }
            await Promise.race([
              record.closedPromise,
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(Object.assign(
                  new Error(`Owned capture ${role} close remains unsettled.`), { code: 'STOP_TIMEOUT' })), 5000);
              }),
            ]);
          } catch (error) {
            failures.push(error);
            // An unsettled controller must not race a subsequent root stop.
            if (role === 'controller') throw new AggregateError(failures, 'Owned capture controller cleanup failed');
          } finally { clearTimeout(timer); }
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Owned capture root cleanup failed');
      return records.map(({ child, role, closed, stopRequested, stopSent, exitCode, signal }) => ({
        role, pid: child.pid ?? null, closeObserved: closed, stopRequested, stopSent, exitCode, signal,
      }));
    },
  };
}
