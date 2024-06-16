import { parentPort, workerData } from 'node:worker_threads';

const { cliOptions, eslintDirURL, filePathIndexArray, filePaths, patchESLintModuleURL } =
workerData;
const [{ default: patchESLint }, { ESLint }] =
await Promise.all([import(patchESLintModuleURL), import(`${eslintDirURL}/lib/eslint/eslint.js`)]);
{
    const { emitWarning } = process;
    process.emitWarning =
    (...args) =>
    {
        if (args[1] !== 'ESLintIgnoreWarning')
            emitWarning(...args);
    };
}
await patchESLint(ESLint, eslintDirURL);
const engine = await ESLint.fromCLIOptions(cliOptions);
const lintSingleFile = await engine.createLintSingleFile();
const indexedResults = [];
for (;;)
{
    const index = Atomics.add(filePathIndexArray, 0, 1);
    const filePath = filePaths[index];
    if (!filePath)
        break;
    const result = await lintSingleFile(filePath);
    if (result)
    {
        result.index = index;
        indexedResults.push(result);
    }
}
parentPort.postMessage(indexedResults);
