import { setImmediate }                                         from 'node:timers/promises';
import { getEnvironmentData, isMainThread, setEnvironmentData } from 'node:worker_threads';

let loadConfigCountArray;
const concurrency = 2;
const environmentDataKey = 'load-config-count-array';
if (isMainThread)
{
    loadConfigCountArray = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    setEnvironmentData(environmentDataKey, loadConfigCountArray);
}
else
{
    while (!(loadConfigCountArray = getEnvironmentData(environmentDataKey)))
        await setImmediate();
    let loadConfigCount = Atomics.add(loadConfigCountArray, 0, 1) + 1;
    while (loadConfigCount < concurrency)
    {
        await Atomics.wait(loadConfigCountArray, 0, loadConfigCount).value;
        loadConfigCount = Atomics.load(loadConfigCountArray, 0);
    }
    Atomics.notify(loadConfigCountArray, 0);
}
process.emitWarning("\n⚠\n");

export default [{}];
