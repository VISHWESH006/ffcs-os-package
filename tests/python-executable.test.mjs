import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectPythonExecutable } from '../api-server/src/lib/python-executable.mjs';

const pythonLibsBin = '/workspace/.pythonlibs/bin/python3';

test('PYTHON_BIN override takes priority on every platform', () => {
  assert.equal(selectPythonExecutable('win32', 'custom-python', pythonLibsBin, true), 'custom-python');
  assert.equal(selectPythonExecutable('linux', 'custom-python', pythonLibsBin, true), 'custom-python');
  assert.equal(selectPythonExecutable('darwin', 'custom-python', pythonLibsBin, true), 'custom-python');
});

test('Windows defaults to python even if the POSIX pythonlibs path exists', () => {
  assert.equal(selectPythonExecutable('win32', undefined, pythonLibsBin, true), 'python');
  assert.equal(selectPythonExecutable('win32', undefined, pythonLibsBin, false), 'python');
});

test('Linux and macOS default to python3 when pythonlibs is absent', () => {
  assert.equal(selectPythonExecutable('linux', undefined, pythonLibsBin, false), 'python3');
  assert.equal(selectPythonExecutable('darwin', undefined, pythonLibsBin, false), 'python3');
});

test('POSIX keeps using the existing pythonlibs interpreter when present', () => {
  assert.equal(selectPythonExecutable('linux', undefined, pythonLibsBin, true), pythonLibsBin);
  assert.equal(selectPythonExecutable('darwin', undefined, pythonLibsBin, true), pythonLibsBin);
});
