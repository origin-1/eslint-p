/* eslint no-unused-vars: "off" */

import { mkdir, stat, writeFile }   from 'node:fs/promises';
import path                         from 'node:path';

/* global isDirectory -- make-grab */

export default async function createPrintResults(eslintDirURL)
{
    const { default: log } = await import(`${eslintDirURL}lib/shared/logging.js`);

    /* global printResults -- make-grab */

    return printResults;
}
