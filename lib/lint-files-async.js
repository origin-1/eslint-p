import { parentPort, workerData }   from 'node:worker_threads';
import patchFlatESLint              from './patch-flat-eslint.js';

const { eslintDirURL, cliOptions } = workerData;
const { FlatESLint } = await import(`${eslintDirURL}/lib/eslint/flat-eslint.js`);
await patchFlatESLint(FlatESLint, eslintDirURL);
const engine = await FlatESLint.fromCLIOptions(cliOptions);
const lintSingleFile = await engine.createLintSingleFile();

async function lintFile(filePathInfo)
{
    const result = await lintSingleFile(filePathInfo);
    parentPort.postMessage({ index: filePathInfo.index, result });
}

function listener(filePathInfo)
{
    if (filePathInfo)
        lintFile(filePathInfo).catch(error => { throw error; });
    else
        parentPort.off('message', listener);
}

parentPort.on('message', listener);
