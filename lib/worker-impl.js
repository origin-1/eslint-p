import { parentPort, workerData }   from 'node:worker_threads';
import createLintSingleFile         from './create-lint-single-file.js';
import createTranslateOptions       from './create-translate-options.js';

const { cliOptions, createImportAsESLintModuleURL, eslintDirURL, filePathIndexArray, filePaths } =
workerData;
const { default: createImportAsESLint } = await import(createImportAsESLintModuleURL);
const importAsESLint = createImportAsESLint(eslintDirURL);
const ESLintPromise = importAsESLint('./lib/eslint/eslint.js');
const translateOptions = await createTranslateOptions(importAsESLint);
const [{ ESLint }, eslintOptions] =
await Promise.all([ESLintPromise, translateOptions(cliOptions)]);
{
    const { emitWarning } = process;
    process.emitWarning =
    (...args) =>
    {
        const [, arg1] = args;
        if
        (
            typeof arg1 !== 'string' ||
            arg1 !== 'ESLintIgnoreWarning' &&
            !arg1.startsWith('ESLintInactiveFlag_') &&
            arg1 !== 'ESLintEmptyConfigWarning'
        )
            emitWarning(...args);
    };
}
const engine = new ESLint(eslintOptions);
const lintSingleFile = await createLintSingleFile(importAsESLint, engine);
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
