import { parentPort, workerData } from 'node:worker_threads';

const { cliOptions, eslintDirURL, fileInfoIndexArray, fileInfos, patchFlatESLintModuleURL } =
workerData;
const [{ default: patchFlatESLint }, { FlatESLint }] =
await Promise.all
([import(patchFlatESLintModuleURL), import(`${eslintDirURL}/lib/eslint/flat-eslint.js`)]);
await patchFlatESLint(FlatESLint, eslintDirURL);
const engine = await FlatESLint.fromCLIOptions(cliOptions);
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
