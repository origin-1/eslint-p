import { parentPort, workerData }   from 'node:worker_threads';
import createImportAs               from './create-import-as.js';
import createLintSingleFile         from './create-lint-single-file.js';
import createTranslateOptions       from './create-translate-options.js';

const { cliOptions, createVerifyTextModuleURL, eslintDirURL, filePathIndexArray, filePaths } =
workerData;
const importAsESLint = createImportAs(eslintDirURL);
const { ESLint } = await importAsESLint('./lib/eslint/eslint.js');
{
    const { emitWarning } = process;
    process.emitWarning =
    (...args) =>
    {
        if (args[1] !== 'ESLintIgnoreWarning')
            emitWarning(...args);
    };
}
const translateOptions = await createTranslateOptions(importAsESLint);
const eslintOptions = await translateOptions(cliOptions);
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
