import { requireThat } from './core.mjs';

export function parseArguments(argv) {
  const flags = {}, words = [];
  const valued = new Set(['home', 'cwd', 'session', 'work-item', 'repository', 'token', 'operation', 'commit', 'input-file', 'evidence-file', 'source-root', 'offset', 'limit', 'finding']);
  const boolean = new Set(['json', 'human', 'help', 'adopt', 'purge', 'purge-existing']);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) { words.push(argument); continue; }
    const name = argument.slice(2);
    requireThat(!Object.hasOwn(flags, name), 'INPUT', `Duplicate option --${name}`);
    if (boolean.has(name)) flags[name] = true;
    else {
      requireThat(valued.has(name) && argv[index + 1] && !argv[index + 1].startsWith('--'), 'INPUT', `Unknown option or missing value: --${name}`);
      flags[name] = argv[++index];
    }
  }
  return { flags, words };
}
