import { parentPort, workerData }   from 'node:worker_threads';
import createImportAs               from './create-import-as.js';
import createLintSingleFile         from './create-lint-single-file.js';
import createTranslateOptions       from './create-translate-options.js';

const { cliOptions, createVerifyTextModuleURL, eslintDirURL, filePathIndexArray, filePaths } =
workerData;
const importAsESLint = createImportAs(eslintDirURL);
const ESLintPromise = importAsESLint('./lib/eslint/eslint.js');
const translateOptions = await createTranslateOptions(importAsESLint);
const [{ ESLint }, eslintOptions] =
await Promise.all([ESLintPromise, translateOptions(cliOptions)]);
{
    const { emitWarning } = process;
    process.emitWarning =
    (...args) =>
    {
        if (args[1] !== 'ESLintIgnoreWarning')
            emitWarning(...args);
    };
}
const engine = new ESLint(eslintOptions);
const lintSingleFile =
await createLintSingleFile(importAsESLint, createVerifyTextModuleURL, engine);
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
