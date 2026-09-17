#!/usr/bin/env node

const hookCommand = ['gate', 'hook'].includes(process.argv[2]);
function failOpen(message) {
  void message;
  process.stdout.write('{}\n');
  process.exitCode = 0;
}
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('AI SDLC requires Node.js >=22');
  const { runCli, humanOutput } = await import('../src/cli.mjs');
  const { result, exitCode, human } = await runCli();
  if (process.argv[2] === 'gate' && (result.advisory || result.unmanaged)) {
    if (result.advisory && result.advisoryReason) {
      process.stdout.write(`${JSON.stringify({
        type: 'progress',
        message: `AI SDLC advisory: ${String(result.advisoryReason).replace(/\s+/gu, ' ').slice(0, 500)}`,
      })}\n`);
    }
    process.stdout.write('{}\n');
  } else {
    process.stdout.write(`${human ? humanOutput(result) : JSON.stringify(result)}\n`);
  }
  process.exitCode = exitCode;
} catch (error) {
  if (hookCommand) {
    failOpen(`${error.code ?? 'ERROR'}: ${error.message}`);
  } else {
    const result = { verdict: 'error', error: { code: error.code ?? 'ERROR', message: error.message,
      ...(error.details ? { details: error.details } : {}) } };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 4;
  }
}
