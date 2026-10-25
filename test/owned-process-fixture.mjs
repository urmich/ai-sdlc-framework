import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';

if (process.argv[2] === '--owned-pipe-fixture') {
  const [mode, directory, token] = process.argv.slice(3);
  const release = path.join(directory, `${token}.release`);
  if (mode === 'writer') {
    const publication = path.join(directory, `${token}.writer.json`);
    const pending = `${publication}.${randomUUID()}.pending`;
    fs.writeFileSync(pending, JSON.stringify({ pid: process.pid, parent: process.ppid, token }), { flag: 'wx' });
    fs.renameSync(pending, publication);
    process.send({ ready: true });
    const timer = setInterval(() => {
      if (!fs.existsSync(release)) return;
      clearInterval(timer);
      fs.writeFileSync(path.join(directory, `${token}.drained`), String(process.pid));
    }, 10);
  } else {
    const writer = spawn(process.execPath,
      [import.meta.filename, '--owned-pipe-fixture', 'writer', directory, token],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], shell: false, detached: true });
    writer.once('message', () => {
      writer.disconnect();
      process.stdout.write('owned-natural-tail');
      if (mode === 'root-exit') process.exitCode = 23;
      else {
        const timer = setInterval(() => {
          if (!fs.existsSync(release)) return;
          clearInterval(timer);
          process.exitCode = 23;
        }, 10);
      }
      writer.unref();
    });
  }
}

export async function windowsProcessIdentity(pid, exitPath, { createdBeforeMs } = {}) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.ok(Number.isSafeInteger(createdBeforeMs) && createdBeforeMs >= 0,
    'A live ready observation must bound the original process creation');
  const creationGuard =
    `if([long]::Parse($creation)-ge[long]::Parse('${BigInt(createdBeforeMs) * 10000n + 621355968000000000n}'))` +
    `{throw 'Owned process creation does not predate its ready observation'};`;
  // Closed scalar records avoid cmdlet-module loading within the capture budget.
  const script = `$ErrorActionPreference='Stop';$p=[Diagnostics.Process]::GetProcessById(${pid});` +
    `$ownedVerified=$false;` +
    `try{$null=$p.Handle;$creation=$p.StartTime.ToUniversalTime().Ticks.ToString();$image=$p.ProcessName;` +
    creationGuard + `$ownedVerified=$true;` +
    `if($image -cnotmatch '^[A-Za-z0-9_.-]+$'){throw 'Invalid owned process image'};` +
    `$record='{"pid":${pid},"present":true,"creationTime":"'+$creation+'","image":"'+$image+` +
    `'","observedAt":"'+[DateTime]::UtcNow.ToString('o')+'"}';[Console]::Out.WriteLine($record);` +
    `if(!$p.WaitForExit(15000)){throw 'Original owned worker did not exit within its observation budget'};` +
    `$record='{"pid":${pid},"present":false,"creationTime":"'+$creation+'","image":"'+$image+` +
    `'","exitTimeTicks":"'+$p.ExitTime.ToUniversalTime().Ticks.ToString()+` +
    `'","observedAt":"'+[DateTime]::UtcNow.ToString('o')+'"}';` +
    `[IO.File]::WriteAllText('${exitPath.replaceAll("'", "''")}.tmp',$record);` +
    `[IO.File]::Move('${exitPath.replaceAll("'", "''")}.tmp','${exitPath.replaceAll("'", "''")}')` +
    `}catch{[IO.File]::WriteAllText('${exitPath.replaceAll("'", "''")}.error',` +
    `($_.Exception.GetType().FullName+': '+$_.Exception.Message));exit 1}` +
    `finally{try{if($ownedVerified -and !$p.HasExited){$p.Kill();$p.WaitForExit()}}finally{$p.Dispose()}}`;
  const child = spawn(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let stdout = '';
  let stderrBytes = 0;
  child.stderr.on('data', bytes => { stderrBytes += bytes.length; });
  const value = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned process identity capture did not complete')), 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(JSON.stringify({ kind: 'process-identity-unavailable', pid, code, signal, stderrBytes })));
    });
    child.stdout.on('data', bytes => {
      stdout += bytes;
      if (!stdout.includes('\n')) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(error); }
    });
  });
  assert.equal(value.pid, pid);
  assert.equal(typeof value.present, 'boolean');
  assert.ok(Number.isFinite(Date.parse(value.observedAt)));
  if (value.present) {
    assert.match(value.creationTime, /^[0-9]+$/u);
    assert.match(value.image, /^[A-Za-z0-9_.-]+$/u);
  }
  return { identity: value, closed };
}

export function assertOwnedProcessExited(owned, observed, completedAtMs) {
  assert.equal(owned.present, true, 'Owned identity must be captured while the worker is alive');
  assert.equal(observed.pid, owned.pid);
  assert.match(owned.creationTime, /^[0-9]+$/u);
  assert.match(owned.image, /^[A-Za-z0-9_.-]+$/u);
  assert.equal(typeof observed.present, 'boolean');
  assert.match(observed.creationTime, /^[0-9]+$/u);
  assert.match(observed.image, /^[A-Za-z0-9_.-]+$/u);
  const sameProcess = observed.creationTime === owned.creationTime &&
    observed.image.toLowerCase() === owned.image.toLowerCase();
  const diagnostic = 'No owned file process may survive the nested command: ' +
    JSON.stringify({ owned, observed, completedAtMs, completionClockPrecisionMs: 1 });
  if (observed.present) { assert.equal(sameProcess, false, diagnostic); return; }
  assert.equal(sameProcess, true, 'Exit observation must identify the held original process');
  assert.match(observed.exitTimeTicks, /^[0-9]+$/u);
  assert.ok(Number.isSafeInteger(completedAtMs));
  // Completion is a millisecond lower bound; same-bucket ordering is unknown and fails closed.
  assert.ok(BigInt(observed.exitTimeTicks) <
    BigInt(completedAtMs) * 10000n + 621355968000000000n, diagnostic);
}
