import net from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';
import { requireThat } from '../src/core.mjs';

const version = 2;
function endpoint(value) {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  requireThat(data && data.version === version && data.host === '127.0.0.1' &&
    Number.isInteger(data.port) && data.port > 0 && data.port < 65536 &&
    typeof data.id === 'string' && /^[a-f0-9-]{36}$/u.test(data.id) &&
    typeof data.key === 'string' && /^[a-f0-9]{64}$/u.test(data.key),
  'BUDGET', 'Invalid inherited test-worker allocation');
  return data;
}
async function connect(value) {
  const selected = endpoint(value);
  const socket = net.connect({ host: selected.host, port: selected.port });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let sequence = 0;
  let contents = '';
  const cancellation = new AbortController();
  const pending = new Map();
  socket.on('data', data => {
    contents += data;
    if (contents.length > 65536) return socket.destroy(new Error('Worker-budget response exceeds its limit'));
    for (let newline; (newline = contents.indexOf('\n')) >= 0;) {
      const line = contents.slice(0, newline);
      contents = contents.slice(newline + 1);
      let response;
      try { response = JSON.parse(line); }
      catch { socket.destroy(new Error('Malformed worker-budget response')); return; }
      if (response.cancelled) {
        const error = Object.assign(new Error('The owning test producer was cancelled'), { code: 'BUDGET' });
        cancellation.abort(error);
        reject(error);
        continue;
      }
      const request = pending.get(response.request);
      if (!request) continue;
      pending.delete(response.request);
      if (response.error) request.reject(Object.assign(new Error(response.error), { code: 'BUDGET' }));
      else request.resolve(response);
    }
  });
  const reject = error => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  socket.on('error', reject);
  socket.on('close', () => reject(Object.assign(new Error('Test-worker budget disconnected'), { code: 'BUDGET' })));
  return {
    socket, selected, signal: cancellation.signal,
    request(value) {
      const request = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(request, { resolve, reject });
        socket.write(`${JSON.stringify({ ...value, request, key: selected.key })}\n`);
      });
    },
    close() { socket.destroy(); },
  };
}

async function broker(capacity) {
  requireThat(Number.isInteger(capacity) && capacity > 0 && capacity <= 32,
    'BUDGET', 'A test-worker host allocation is bounded to 1..32 slots');
  const id = randomUUID();
  const key = randomBytes(32).toString('hex');
  const host = Array.from({ length: capacity }, (_, index) => ({ index, owners: [] }));
  const producers = new Map();
  const controls = new Map();
  const workers = new Map();
  const groupProcesses = new Map();
  const sockets = new Set();
  const queue = [];
  const resourceNode = value => producers.get(value) ?? controls.get(value) ?? workers.get(value);
  const peaks = { activeWorkers: 0, producers: 0, residentWorkers: 0, potentialResidentWorkers: 0, controls: 0 };
  const snapshot = () => ({
    version, id, capacity, producerLimit: capacity * 2 + 1, controlLimit: capacity * 2 + 1,
    orchestrationLimit: capacity * 4 + 2,
    residentLimit: capacity * 3, activeWorkers: [...workers.values()].filter(worker => worker.token).length,
    residentWorkers: workers.size, producers: producers.size, controls: controls.size,
    pendingParentRestorations: [...workers.values()].reduce((count, worker) => count + worker.resumptions.length, 0),
    potentialResidentWorkers: [...producers.values()].reduce((count, producer) => count + producer.resident, 0),
    peakActiveWorkers: peaks.activeWorkers, peakProducers: peaks.producers,
    peakResidentWorkers: peaks.residentWorkers, peakControls: peaks.controls,
    peakPotentialResidentWorkers: peaks.potentialResidentWorkers,
    allocationPolicy: 'dynamic-ready-worker-tokens-v2',
  });
  const measure = () => {
    const current = snapshot();
    const tokens = [...host, ...[...producers.values(), ...workers.values()].flatMap(producer => producer.pool),
      ...[...workers.values()].map(worker => worker.token).filter(Boolean)];
    requireThat(tokens.length === capacity && new Set(tokens.map(token => token.index)).size === capacity,
      'BUDGET', 'A worker-budget token cannot be lost or allocated twice');
    peaks.activeWorkers = Math.max(peaks.activeWorkers, current.activeWorkers);
    peaks.producers = Math.max(peaks.producers, producers.size);
    peaks.residentWorkers = Math.max(peaks.residentWorkers, workers.size);
    peaks.potentialResidentWorkers = Math.max(peaks.potentialResidentWorkers, current.potentialResidentWorkers);
    peaks.controls = Math.max(peaks.controls, controls.size);
    requireThat(current.activeWorkers <= capacity && producers.size <= capacity * 2 + 1 &&
      workers.size <= capacity * 3 && current.potentialResidentWorkers <= capacity * 3 &&
      controls.size <= capacity * 2 + 1,
    'BUDGET', 'Aggregate worker allocation exceeded its declared host limits');
  };
  const ancestors = parent => {
    const result = [];
    for (let current = parent; current;) {
      const producer = resourceNode(current);
      if (!producer) break;
      result.push(producer);
      current = producer.parent;
    }
    return result;
  };
  const reply = (request, value) => {
    if (!request.socket.destroyed) request.socket.write(`${JSON.stringify({
      request: request.request, ...value,
    })}\n`);
  };
  const resume = (slot, yieldId, done) => {
    const worker = workers.get(slot);
    if (!worker) { done(); return; }
    worker.yielders.delete(yieldId);
    if (worker.closing) { done(); return; }
    if (worker.token) { done(); return; }
    worker.resumptions.push(done);
    if (worker.yielders.size || worker.resuming) return;
    worker.resuming = true;
    queue.unshift({ kind: 'worker', worker, done: () => {
      worker.resuming = false;
      worker.resumptions.splice(0).forEach(finish => finish());
    } });
  };
  const release = producer => {
    if (!producer.closing || [...workers.values()].some(worker => worker.producer === producer.id) ||
      [...producers.values(), ...controls.values()].some(child => child.parent === producer.id)) return false;
    for (const token of producer.pool) {
      const owner = token.owners.pop();
      const parent = owner && resourceNode(owner);
      (parent?.pool ?? host).push(token);
    }
    if (producers.has(producer.id)) producers.delete(producer.id);
    else controls.delete(producer.id);
    const done = () => { producer.done?.(); };
    resume(producer.slot, producer.id, done);
    return true;
  };
  const releaseWorker = worker => {
    if (!worker.closing || [...producers.values(), ...controls.values()].some(child =>
      child.parent === worker.id)) return false;
    for (const token of worker.pool) {
      const parent = resourceNode(token.owners.pop());
      (parent?.pool ?? host).push(token);
    }
    workers.delete(worker.id);
    worker.resumptions.splice(0).forEach(finish => finish());
    return true;
  };
  const drain = () => {
    let changed;
    do {
      changed = false;
      for (let index = 0; index < queue.length;) {
        const item = queue[index];
        if (item.socket?.destroyed || item.kind === 'worker' && !workers.has(item.worker.id)) {
          queue.splice(index, 1);
          continue;
        }
        if (item.kind === 'producer' && item.parent &&
          (!resourceNode(item.parent) || resourceNode(item.parent).cancelled ||
            resourceNode(item.parent).closing)) {
          reply(item, { error: 'The original parent allocation is no longer available' });
          resume(item.slot, item.id, () => {});
          queue.splice(index, 1);
          continue;
        }
        if (item.kind === 'registration') {
          const producer = producers.get(item.producer);
          if (!producer || producer.closing || producer.cancelled) {
            reply(item, { error: 'The file worker lost its original producer allocation' });
            queue.splice(index, 1);
            continue;
          }
          if ([...workers.values()].filter(worker => worker.producer === producer.id).length >= producer.resident) {
            index++;
            continue;
          }
          const worker = { id: randomUUID(), parent: producer.id, producer: producer.id,
            limit: item.slots, pool: [], token: null, started: false, closing: false,
            exclusiveResources: item.exclusiveResources, groupId: item.groupId, pid: item.pid,
            yielders: new Set(), resumptions: [], resuming: false, socket: item.socket };
          workers.set(worker.id, worker);
          item.socket.workerId = worker.id;
          item.kind = 'worker';
          item.worker = worker;
          item.done = () => reply(item, { slot: worker.id, id, capacity, workers: worker.limit });
        }
        if (item.kind === 'worker') {
          const pools = [...ancestors(item.worker.producer), { id: null, pool: host }];
          const occupied = [...workers.values()].some(other => other !== item.worker &&
            other.started && !other.closing &&
            other.exclusiveResources.some(resource => item.worker.exclusiveResources.includes(resource)));
          if (item.worker.yielders.size || item.worker.closing ||
            (item.worker.started ? !item.worker.pool.length :
              occupied || pools.reduce((count, owner) => count + owner.pool.length, 0) < item.worker.limit)) {
            index++;
            continue;
          }
          if (!item.worker.started) {
            for (const owner of pools) while (owner.pool.length && item.worker.pool.length < item.worker.limit) {
              const token = owner.pool.pop();
              token.owners.push(owner.id);
              item.worker.pool.push(token);
            }
            item.worker.started = true;
            if (item.worker.groupId) {
              const groupKey = `${item.worker.producer}:${item.worker.groupId}`;
              const records = groupProcesses.get(groupKey) ?? [];
              records.push({ pid: item.worker.pid, slot: item.worker.id,
                minimumSlots: item.worker.limit, exclusiveResources: item.worker.exclusiveResources,
                startedAt: new Date().toISOString(), finishedAt: null });
              groupProcesses.set(groupKey, records);
            }
          }
          item.worker.token = item.worker.pool.pop();
          item.done();
        } else {
          if ([...producers.values()].reduce((count, producer) => count + producer.resident, 0) +
              item.resident > capacity * 3) {
            index++;
            continue;
          }
          const producer = { id: item.id, parent: item.parent, limit: item.limit,
            resident: item.resident,
            pool: [], socket: item.socket, slot: item.slot, closing: false };
          producers.set(item.id, producer);
          item.socket.producerId = item.id;
          reply(item, { id, capacity, producer: item.id, workers: item.limit });
        }
        queue.splice(index, 1);
        changed = true;
        measure();
      }
      for (const worker of workers.values()) if (releaseWorker(worker)) changed = true;
      for (const producer of [...producers.values(), ...controls.values()]) if (release(producer)) changed = true;
    } while (changed);
  };
  const yieldParent = (slot, yieldId, parent) => {
    if (!slot) return;
    const worker = workers.get(slot);
    requireThat(worker && (worker.id === parent || worker.producer === parent),
      'BUDGET', 'Nested producer lost its original parent allocation');
    worker.yielders.add(yieldId);
    if (worker.token) {
      worker.pool.push(worker.token);
      worker.token = null;
    }
  };
  const cancelOwned = node => {
    if (node.cancelled) return;
    node.cancelled = true;
    if (!node.socket.destroyed) node.socket.write('{"cancelled":true}\n');
    for (const worker of workers.values()) if (worker.producer === node.id && !worker.socket.destroyed) {
      worker.socket.write('{"cancelled":true}\n');
    }
    for (const child of [...producers.values(), ...controls.values()]) {
      if (child.parent === node.id) cancelOwned(child);
    }
  };
  const cleanup = socket => {
    sockets.delete(socket);
    for (let index = queue.length - 1; index >= 0; index--) if (queue[index].socket === socket) {
      const item = queue.splice(index, 1)[0];
      resume(item.slot, item.id, () => {});
    }
    const worker = workers.get(socket.workerId);
    if (worker) {
      worker.closing = true;
      const observation = groupProcesses.get(`${worker.producer}:${worker.groupId}`)?.find(record => record.slot === worker.id);
      if (observation) observation.finishedAt = new Date().toISOString();
      if (worker.token) { worker.pool.push(worker.token); worker.token = null; }
      for (const node of [...producers.values(), ...controls.values()]) {
        if (node.slot === worker.id) cancelOwned(node);
      }
    }
    const control = controls.get(socket.controlId);
    if (control) {
      control.closing = true;
      cancelOwned(control);
    }
    const producer = producers.get(socket.producerId);
    if (producer) { producer.closing = true; cancelOwned(producer); }
    drain();
  };
  const server = net.createServer(socket => {
    sockets.add(socket);
    let contents = '';
    socket.on('error', () => {});
    socket.on('close', () => cleanup(socket));
    socket.on('data', data => {
      contents += data;
      if (contents.length > 65536) return socket.destroy();
      for (let newline; (newline = contents.indexOf('\n')) >= 0;) {
        const line = contents.slice(0, newline);
        contents = contents.slice(newline + 1);
        let input;
        try {
          input = JSON.parse(line);
          requireThat(input.key === key && Number.isSafeInteger(input.request),
            'BUDGET', 'Worker-budget authentication failed');
          const request = { ...input, socket };
          if (input.op === 'snapshot') reply(request, snapshot());
          else if (input.op === 'group') {
            requireThat(typeof input.groupId === 'string' && /^[a-f0-9]{64}$/u.test(input.groupId),
              'BUDGET', 'A group process query requires its source-bound group identity');
            reply(request, { processes: groupProcesses.get(`${input.producer}:${input.groupId}`) ?? [] });
          }
          else if (input.op === 'begin') {
            requireThat(!socket.producerId && !socket.controlId && !socket.workerId && !socket.pendingWorker,
              'BUDGET', 'A budget connection already owns an allocation');
            const parent = input.parent ?? null;
            const ancestor = resourceNode(parent);
            requireThat(!parent || ancestor && !ancestor.cancelled && !ancestor.closing,
              'BUDGET', 'Parent producer is no longer available');
            const limit = Math.min(input.workers, ancestor?.limit ?? capacity);
            const pendingRestorations = [...workers.values()].reduce((count, worker) =>
              count + worker.resumptions.length, 0);
            requireThat(Number.isInteger(limit) && limit > 0 && limit <= capacity &&
              Number.isInteger(input.fileCount) && input.fileCount > 0 &&
              (input.control ? controls.size : producers.size +
                queue.filter(item => item.kind === 'producer').length) < capacity * 2 + 1 &&
              producers.size + controls.size + pendingRestorations +
                queue.filter(item => item.kind === 'producer').length < capacity * 4 + 2,
            'BUDGET', 'Producer exceeds its aggregate host allocation');
            const ownId = randomUUID();
            yieldParent(input.slot, ownId, parent);
            if (input.control) {
              controls.set(ownId, { id: ownId, slot: input.slot, parent, limit, pool: [], socket });
              socket.controlId = ownId;
              reply(request, { id, capacity, workers: limit, control: ownId });
            } else queue.push({ ...request, kind: 'producer', id: ownId, parent,
              slot: input.slot, limit, resident: Math.min(limit, input.fileCount) });
            drain();
          } else if (input.op === 'worker') {
            const producer = producers.get(input.producer);
            requireThat(producer && !producer.closing && !socket.workerId && !socket.pendingWorker &&
              Number.isInteger(input.slots) && input.slots > 0 && input.slots <= producer.limit &&
              Number.isInteger(input.pid) && input.pid > 0 &&
              (input.groupId === null || typeof input.groupId === 'string' && /^[a-f0-9]{64}$/u.test(input.groupId)) &&
              Array.isArray(input.exclusiveResources) &&
              new Set(input.exclusiveResources).size === input.exclusiveResources.length &&
              input.exclusiveResources.every(resource => typeof resource === 'string' && resource.trim() &&
                resource.length <= 4096) &&
              queue.filter(item => item.kind === 'registration').length < capacity * 3,
            'BUDGET', 'File worker has no remaining declared allocation');
            socket.pendingWorker = true;
            queue.push({ ...request, kind: 'registration', producer: producer.id, slots: input.slots });
            drain();
          } else if (input.op === 'end') {
            const producer = producers.get(socket.producerId);
            const control = controls.get(socket.controlId);
            if (producer) {
              producer.closing = true;
              producer.done = () => reply(request, { complete: true, ...snapshot() });
            } else if (control) {
              control.closing = true;
              control.done = () => reply(request, { complete: true, ...snapshot() });
            } else reply(request, { complete: true, ...snapshot() });
            drain();
          } else throw new Error('Unsupported worker-budget operation');
          measure();
        } catch (error) {
          reply({ socket, request: input?.request ?? null }, { error: error.message });
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  return {
    endpoint: { version, host: '127.0.0.1', port: server.address().port, id, key },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

export async function enterTestBudget({ workers, fileCount = workers, inherited = process.env.SDLC_TEST_BUDGET,
  parent = process.env.SDLC_TEST_BUDGET_PARENT || process.env.SDLC_TEST_BUDGET_PRODUCER || null,
  slot = process.env.SDLC_TEST_BUDGET_SLOT ?? null, control = false }) {
  const owner = inherited ? null : await broker(workers);
  const selected = inherited ? endpoint(inherited) : owner.endpoint;
  const client = await connect(selected);
  try {
    const allocation = await client.request({ op: 'begin', workers, fileCount, parent, slot, control });
    return {
      id: allocation.id, capacity: allocation.capacity, workers: allocation.workers,
      inherited: JSON.stringify(selected), parent: control ? allocation.control : allocation.producer,
      signal: client.signal,
      environment: { SDLC_TEST_BUDGET: JSON.stringify(selected),
        SDLC_TEST_BUDGET_PRODUCER: control ? allocation.control : allocation.producer,
        SDLC_TEST_BUDGET_PARENT: '',
        SDLC_TEST_BUDGET_SLOT: '' },
      snapshot: () => client.request({ op: 'snapshot' }),
      async close() {
        try { await client.request({ op: 'end' }); }
        finally { client.close(); await owner?.close(); }
      },
    };
  } catch (error) {
    client.close();
    await owner?.close();
    throw error;
  }
}

export async function acquireTestWorker(slots = 1, { groupId = null, exclusiveResources = [] } = {}) {
  const client = await connect(process.env.SDLC_TEST_BUDGET);
  try {
    const allocation = await client.request({ op: 'worker',
      producer: process.env.SDLC_TEST_BUDGET_PRODUCER, slots, groupId, exclusiveResources, pid: process.pid });
    process.env.SDLC_TEST_BUDGET_SLOT = allocation.slot;
    process.env.SDLC_TEST_BUDGET_PARENT = allocation.slot;
    let closed = false;
    client.signal.addEventListener('abort', () => {
      if (!closed) { process.exitCode ||= 2; process.kill(process.pid, 'SIGTERM'); }
    }, { once: true });
    client.socket.once('close', () => {
      if (!closed) {
        process.exitCode ||= 2;
        process.kill(process.pid, 'SIGTERM');
      }
    });
    client.socket.unref();
    return { ...allocation, close: () => { closed = true; client.close(); } };
  } catch (error) { client.close(); throw error; }
}

export async function readTestBudget() {
  const client = await connect(process.env.SDLC_TEST_BUDGET);
  try { return await client.request({ op: 'snapshot' }); }
  finally { client.close(); }
}

export async function readTestGroupProcesses(groupId) {
  const client = await connect(process.env.SDLC_TEST_BUDGET);
  try { return (await client.request({ op: 'group', groupId,
    producer: process.env.SDLC_TEST_BUDGET_PRODUCER })).processes; }
  finally { client.close(); }
}
