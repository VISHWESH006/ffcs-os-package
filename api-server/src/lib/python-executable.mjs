/**
 * Select the Python command used to run FFCS CLI modules.
 * Explicit configuration always wins. The packaged pythonlibs executable is
 * retained on POSIX hosts; Windows uses its standard `python` command.
 * @param {string} platform
 * @param {string | undefined} configured
 * @param {string} pythonLibsBin
 * @param {boolean} hasPythonLibsBin
 * @returns {string}
 */
export function selectPythonExecutable(platform, configured, pythonLibsBin, hasPythonLibsBin) {
  if (configured) return configured;
  if (platform === 'win32') return 'python';
  if (hasPythonLibsBin) return pythonLibsBin;
  return 'python3';
}
