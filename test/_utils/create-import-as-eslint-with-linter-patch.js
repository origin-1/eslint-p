import { randomUUID }   from 'node:crypto';
import createImportAs   from '../../lib/create-import-as.js';

export default function createImportAsESLint(eslintDirURL)
{
    const importAsESLint = createImportAs(eslintDirURL);
    const patchPromise = patchLinter(importAsESLint);
    const wrapper =
    async specifier => (await Promise.all([importAsESLint(specifier), patchPromise]))[0];
    return wrapper;
}

async function patchLinter(importAsESLint)
{
    const { Linter } = await importAsESLint('./lib/linter/linter.js');
    const { prototype } = Linter;
    const { getSuppressedMessages } = prototype;
    prototype.getSuppressedMessages =
    function ()
    {
        const suppressedMessages = getSuppressedMessages.call(this);
        suppressedMessages.callId = randomUUID();
        return suppressedMessages;
    };
}
