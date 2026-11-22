import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, VITE_API_BASE_URL: 'http://127.0.0.1:18080/api' };
const commands = [
  [npm, ['run', 'build']],
  [npm, ['exec', 'playwright', '--', 'test']],
  [process.execPath, ['--test', 'extension-e2e/popup-storage.test.mjs']],
];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: command === npm && process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
