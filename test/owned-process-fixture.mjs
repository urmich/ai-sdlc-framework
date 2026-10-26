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

export async function windowsProcessIdentity(pid, exitPath, { createdBeforeMs, retainUntilRelease = false } = {}) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.ok(Number.isSafeInteger(createdBeforeMs) && createdBeforeMs >= 0,
    'A live ready observation must bound the original process creation');
  assert.equal(typeof retainUntilRelease, 'boolean');
  const releasePath = `${exitPath}.release`;
  const inspectionPath = `${exitPath}.inspection.json`;
  const creationGuard =
    `if([long]::Parse($creation)-ge[long]::Parse('${BigInt(createdBeforeMs) * 10000n + 621355968000000000n}'))` +
    `{throw 'Owned process creation does not predate its ready observation'};`;
  const exitRecord =
    `$record='{"pid":${pid},"present":false,"creationTime":"'+$creation+'","image":"'+$image+` +
    `'","exitTimeTicks":"'+$p.ExitTime.ToUniversalTime().Ticks.ToString()+` +
    `'","observedAt":"'+[DateTime]::UtcNow.ToString('o')+'"}';` +
    `[IO.File]::WriteAllText('${exitPath.replaceAll("'", "''")}.tmp',$record);` +
    `[IO.File]::Move('${exitPath.replaceAll("'", "''")}.tmp','${exitPath.replaceAll("'", "''")}');`;
  const observation = retainUntilRelease
    ? `$exited=$false;while(![IO.File]::Exists('${releasePath.replaceAll("'", "''")}') -and !$owner.HasExited){` +
      `if(!$exited -and $p.WaitForExit(10)){${exitRecord}$exited=$true};` +
      `if([IO.File]::Exists('${exitPath.replaceAll("'", "''")}.inspect') -and ` +
      `![IO.File]::Exists('${inspectionPath.replaceAll("'", "''")}')){` +
      `$record='{"pid":${pid},"creationTime":"'+$creation+'","handleOpen":'+` +
      `($p.Handle -ne [IntPtr]::Zero).ToString().ToLowerInvariant()+',"hasExited":'+` +
      `$p.HasExited.ToString().ToLowerInvariant()+'}';` +
      `[IO.File]::WriteAllText('${inspectionPath.replaceAll("'", "''")}.tmp',$record);` +
      `[IO.File]::Move('${inspectionPath.replaceAll("'", "''")}.tmp','${inspectionPath.replaceAll("'", "''")}')};` +
      `if($exited){$null=$owner.WaitForExit(10)}};` +
      `if(!$exited -and $p.HasExited){${exitRecord}};`
    : `if(!$p.WaitForExit(15000)){throw 'Original owned worker did not exit within its observation budget'};` +
      exitRecord;
  const retainOnFailure = retainUntilRelease
    ? `if($ownedVerified){while(![IO.File]::Exists('${releasePath.replaceAll("'", "''")}') -and ` +
      `!$owner.WaitForExit(10)){}};`
    : '';
  // Closed scalar records avoid cmdlet-module loading within the capture budget.
  const script = `$ErrorActionPreference='Stop';$p=[Diagnostics.Process]::GetProcessById(${pid});` +
    `$ownedVerified=$false;$owner=$null;` +
    `try{$null=$p.Handle;$creation=$p.StartTime.ToUniversalTime().Ticks.ToString();$image=$p.ProcessName;` +
    creationGuard +
    `if($image -cnotmatch '^[A-Za-z0-9_.-]+$'){throw 'Invalid owned process image'};` +
    (retainUntilRelease
      ? `if($p.HasExited){throw 'Owned process must still be alive when its identity is pinned'};` +
        `$owner=[Diagnostics.Process]::GetProcessById(${process.pid});$null=$owner.Handle;`
      : '') +
    `$ownedVerified=$true;` +
    `$record='{"pid":${pid},"present":true,"creationTime":"'+$creation+'","image":"'+$image+` +
    `'","observedAt":"'+[DateTime]::UtcNow.ToString('o')+'"}';[Console]::Out.WriteLine($record);` +
    observation +
    `}catch{[IO.File]::WriteAllText('${exitPath.replaceAll("'", "''")}.error',` +
    `($_.Exception.GetType().FullName+': '+$_.Exception.Message));exit 1}` +
    `finally{${retainOnFailure}try{try{if($ownedVerified -and !$p.HasExited){$p.Kill();$p.WaitForExit()}}` +
    `finally{$p.Dispose()}}finally{if($null -ne $owner){$owner.Dispose()}}}`;
  const child = spawn(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let released = false;
  const release = () => {
    if (retainUntilRelease && !released) {
      fs.writeFileSync(releasePath, 'release', { flag: 'wx' });
      released = true;
    }
    return closed;
  };
  let stdout = '';
  let stderrBytes = 0;
  child.stderr.on('data', bytes => { stderrBytes += bytes.length; });
  const captured = new Promise((resolve, reject) => {
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
  try {
    const value = await captured;
    assert.equal(value.pid, pid);
    assert.equal(typeof value.present, 'boolean');
    assert.ok(Number.isFinite(Date.parse(value.observedAt)));
    if (value.present) {
      assert.match(value.creationTime, /^[0-9]+$/u);
      assert.match(value.image, /^[A-Za-z0-9_.-]+$/u);
    }
    return { identity: value, closed, release };
  } catch (error) {
    if (retainUntilRelease) {
      try { await release(); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Owned process identity capture and release failed');
      }
    }
    throw error;
  }
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
