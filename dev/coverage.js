#!/usr/bin/env node

import { createRequire }    from 'node:module';
import c8js                 from 'c8js';

const mochaPath = createRequire(import.meta.url).resolve('mocha/bin/mocha');
await c8js
(
    mochaPath,
    ['--check-leaks', 'test/*.js'],
    {
        all:            true,
        cwd:            new URL('..', import.meta.url),
        include:        'lib/**/*.js',
        reporter:       ['html', 'text-summary'],
        useC8Config:    false,
        watermarks:
        {
            branches:   [90, 100],
            functions:  [90, 100],
            lines:      [90, 100],
            statements: [90, 100],
        },
    },
);
