import patchESLint  from '../../lib/patch-eslint.js';
import fs           from 'fs';
import sinon        from 'sinon';

const spy = sinon.spy(fs.promises, 'readFile');

export default async function (ESLint, eslintDirURL)
{
    await patchESLint(ESLint, eslintDirURL);
    const { prototype } = ESLint;
    const { createLintSingleFile } = prototype;
    prototype.createLintSingleFile =
    async function ()
    {
        const lintSingleFile = await createLintSingleFile.call(this);
        const wrapper =
        async fileInfo =>
        {
            spy.resetHistory();
            const result = await lintSingleFile(fileInfo);
            const readFileCalled = spy.calledWith(fileInfo.filePath);
            return { ...result, readFileCalled };
        };
        return wrapper;
    };
}
