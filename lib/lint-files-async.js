import { parentPort, workerData } from 'node:worker_threads';

const { cliOptions, eslintDirURL, fileInfoIndexArray, fileInfos, patchESLintModuleURL } =
workerData;
const [{ default: patchESLint }, { ESLint }] =
await Promise.all([import(patchESLintModuleURL), import(`${eslintDirURL}/lib/eslint/eslint.js`)]);
await patchESLint(ESLint, eslintDirURL);
const engine = await ESLint.fromCLIOptions(cliOptions);
const lintSingleFile = await engine.createLintSingleFile();
const indexedResults = [];
for (;;)
{
    const index = Atomics.add(fileInfoIndexArray, 0, 1);
    const fileInfo = fileInfos[index];
    if (!fileInfo)
        break;
    const result = await lintSingleFile(fileInfo);
    if (result)
    {
        result.index = index;
        indexedResults.push(result);
    }
}
parentPort.postMessage(indexedResults);
