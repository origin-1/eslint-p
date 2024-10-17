/* eslint no-unused-vars: 'off' */

import { mkdir, stat, writeFile }   from 'node:fs/promises';
import path                         from 'node:path';

/* global isDirectory -- make-grab lib/cli.js */

export default async function createPrintResults(importAsESLint)
{
    const { default: log } = await importAsESLint('./lib/shared/logging.js');

    /* global printResults -- make-grab */

    return printResults;
}
