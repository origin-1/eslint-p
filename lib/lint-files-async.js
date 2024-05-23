import { parentPort, workerData }   from 'node:worker_threads';
import allAsync                     from 'all-async';

const { cliOptions, eslintDirURL, fileInfoIndexArray, fileInfos, patchESLintModuleURL } =
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

function * generator()
{
    for (;;)
    {
        const index = Atomics.add(fileInfoIndexArray, 0, 1);
        const fileInfo = fileInfos[index];
        if (!fileInfo)
            break;
        const promise =
        Promise.resolve(lintSingleFile(fileInfo))
        .then
        (
            result =>
            {
                if (result)
                {
                    result.index = index;
                    indexedResults.push(result);
                }
            },
        );
        yield promise;
    }
}

await allAsync(generator(), 2);
parentPort.postMessage(indexedResults);
