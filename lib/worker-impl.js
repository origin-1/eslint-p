import { parentPort, workerData }   from 'node:worker_threads';
import createProcessLintReport      from '../grab/create-process-lint-report.js';
import createLintSingleFile         from './create-lint-single-file.js';
import createTranslateOptions       from './create-translate-options.js';
import grabPrivateMembers           from './grab-private-members.js';
import patchCalculateConfigArray    from './patch-calculate-config-array.js';

const
{
    cliOptions,
    createImportAsESLintModuleURL,
    emptyConfigFileWarningChannelName,
    eslintDirURL,
    filePathIndexArray,
    filePaths,
} =
workerData;
const { default: createImportAsESLint } = await import(createImportAsESLintModuleURL);
const importAsESLint = createImportAsESLint(eslintDirURL);
const ESLintPromise = importAsESLint('./lib/eslint/eslint.js');
const calculateConfigArrayPatchPromise = patchCalculateConfigArray(importAsESLint);
const translateOptions = await createTranslateOptions(importAsESLint);
const [{ ESLint }, eslintOptions, setNextIssueEmptyConfigFileWarning] =
await Promise.all([ESLintPromise, translateOptions(cliOptions), calculateConfigArrayPatchPromise]);
const { emitWarning } = process;
process.emitWarning = () => { };
const engine = new ESLint(eslintOptions);
process.emitWarning = emitWarning;
{
    function issueEmptyConfigFileWarning(configFilePath)
    {
        const emptyConfigFileWarningChannel =
        new BroadcastChannel(emptyConfigFileWarningChannelName);
        try
        {
            emptyConfigFileWarningChannel.postMessage(configFilePath);
        }
        finally
        {
            emptyConfigFileWarningChannel.close();
        }
    }

    setNextIssueEmptyConfigFileWarning(issueEmptyConfigFileWarning);
}
const privateMembers = grabPrivateMembers(ESLint);
const [lintSingleFile, processLintReport] =
await Promise.all
(
    [
        createLintSingleFile(importAsESLint, engine),
        createProcessLintReport(importAsESLint, privateMembers),
    ],
);
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
        const rulesMeta = engine.getRulesMetaForResults([result]);
        result.index = index;
        result.rulesMeta = rulesMeta;
        indexedResults.push(result);
    }
}
processLintReport(engine, { results: indexedResults });
parentPort.postMessage(indexedResults);
