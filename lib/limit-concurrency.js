/**
 * Wraps a specified async function to ensure that it doesn't run more that a certain number of
 * times concurrently.
 * @template FunctionType extends Function
 * @param {FunctionType} fn An async function.
 * @param {number} maxConcurrency The maximum concurrency.
 * @returns {(...args: Parameters<FunctionType>) => Promise<Awaited<ReturnType<FunctionType>>>}
 * A wrapper around the specified function.
 */
export default function limitConcurrency(fn, maxConcurrency)
{
    let concurrency = 0;

    /** @type {Promise<void>[]} */
    const resolveQueue = [];

    /**
     * Returns a promise that resolves when another task has completed and this task is first in the
     * queue.
     * @returns {Promise<void>} A new promise.
     */
    const nextTurn =
    () => new Promise(resolve => { resolveQueue.push(resolve); });

    /**
     * @param {...Parameters<FunctionType>} args
     * @returns {Promise<Awaited<ReturnType<FunctionType>>>}
     */
    const wrappedFn =
    async function (...args)
    {
        if (concurrency >= maxConcurrency)
            await nextTurn();
        else
            ++concurrency;
        try
        {
            return await Reflect.apply(fn, this, args);
        }
        finally
        {
            const resolve = resolveQueue.shift();
            if (resolve)
                process.nextTick(resolve);
            else
                --concurrency;
        }
    };
    return wrappedFn;
}
