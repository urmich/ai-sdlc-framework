import * as fs from 'node:fs/promises';
import path from 'node:path';

export async function isolatedNpmEnvironment(root) {
  const home = path.join(root, 'npm home');
  const cache = path.join(root, 'npm cache');
  const userConfig = path.join(root, 'empty npmrc');
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(userConfig, '');
  const environment = { ...process.env,
    HOME: home,
    USERPROFILE: home,
    npm_config_cache: cache,
    npm_config_userconfig: userConfig,
    npm_config_update_notifier: 'false',
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
  for (const name of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GITHUB_TOKEN',
    'npm_config__auth', 'npm_config__authToken']) delete environment[name];
  return environment;
}
