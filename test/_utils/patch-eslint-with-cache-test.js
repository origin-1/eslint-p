import fs           from 'node:fs';
import patchESLint  from '../../lib/patch-eslint.js';
import sinon        from 'sinon';

const spy = sinon.spy(fs.promises, 'readFile');

export default async function (ESLint, eslintDirURL)
{
    await patchESLint(ESLint, eslintDirURL);
    const { prototype } = ESLint;
    const { createLintSingleFile } = prototype;
    prototype.createLintSingleFile =
    function ()
    {
        const lintSingleFile = createLintSingleFile.call(this);
        const wrapper =
        async filePath =>
        {
            spy.resetHistory();
            const result = await lintSingleFile(filePath);
            const readFileCalled = spy.calledWith(filePath);
            return { ...result, readFileCalled };
        };
        return wrapper;
    };
}
