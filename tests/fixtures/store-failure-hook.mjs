import fs from 'node:fs';

const failure = process.env.FFCS_TEST_STORE_FAILURE;
if (failure === 'temp-write') {
  const writeFileSync = fs.writeFileSync;
  fs.writeFileSync = function (filePath, ...args) {
    if (typeof filePath === 'string' && filePath.includes('ffcs-store-failure-') && filePath.endsWith('.tmp')) {
      const error = new Error('Injected temporary file creation/write failure.');
      error.code = 'EACCES';
      throw error;
    }
    return writeFileSync.call(fs, filePath, ...args);
  };
}

if (failure === 'rename') {
  const renameSync = fs.renameSync;
  fs.renameSync = function (sourcePath, ...args) {
    if (typeof sourcePath === 'string' && sourcePath.includes('ffcs-store-failure-') && sourcePath.endsWith('.tmp')) {
      const error = new Error('Injected atomic rename failure.');
      error.code = 'EACCES';
      throw error;
    }
    return renameSync.call(fs, sourcePath, ...args);
  };
}
