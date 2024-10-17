import fs                   from 'node:fs';
import createLintSingleFile from '../../lib/create-lint-single-file.js';
import sinon                from 'sinon';

const spy = sinon.spy(fs.promises, 'readFile');

export default async function (...args)
{
    const lintSingleFile = await createLintSingleFile(...args);
    const wrapper =
    async filePath =>
    {
        spy.resetHistory();
        const result = await lintSingleFile(filePath);
        const readFileCalled = spy.calledWith(filePath);
        return { ...result, readFileCalled };
    };
    return wrapper;
}
