import { parentPort, workerData }   from 'node:worker_threads';
import createLintSingleFile         from './create-lint-single-file.js';
import createTranslateOptions       from './create-translate-options.js';

const { cliOptions, createImportAsESLintModuleURL, eslintDirURL, filePathIndexArray, filePaths } =
workerData;
const { default: createImportAsESLint } = await import(createImportAsESLintModuleURL);
const importAsESLint = createImportAsESLint(eslintDirURL);
const ESLintPromise = importAsESLint('./lib/eslint/eslint.js');
const WarningServicePromise = importAsESLint('./lib/services/warning-service.js');
const translateOptions = await createTranslateOptions(importAsESLint);
const [{ ESLint }, { WarningService }, eslintOptions] =
await Promise.all([ESLintPromise, WarningServicePromise, translateOptions(cliOptions)]);
let engine;
const warningServicePrototype = WarningService.prototype;
const { emitESLintIgnoreWarning, emitInactiveFlagWarning } = warningServicePrototype;
warningServicePrototype.emitESLintIgnoreWarning =
warningServicePrototype.emitInactiveFlagWarning =
() => { };
try
{
    engine = new ESLint(eslintOptions);
}
finally
{
    warningServicePrototype.emitInactiveFlagWarning = emitInactiveFlagWarning;
    warningServicePrototype.emitESLintIgnoreWarning = emitESLintIgnoreWarning;
}
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
