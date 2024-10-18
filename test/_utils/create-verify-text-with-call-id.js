import { randomUUID }   from 'node:crypto';
import createVerifyText from '../../grab/create-verify-text.js';

export default async function (...args)
{
    const verifyText = await createVerifyText(...args);
    const wrapper =
    config =>
    {
        const result = verifyText(config);
        result.verifyTextCallID = randomUUID();
        return result;
    };
    return wrapper;
}
