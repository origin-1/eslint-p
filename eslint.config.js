import { createConfig } from '@origin-1/eslint-config';
import globals          from 'globals';

export default createConfig
(
    { ignores: ['coverage'] },
    {
        jsVersion:          2022,
        languageOptions:    { globals: globals.nodeBuiltin },
    },
    {
        files:              ['test/*'],
        languageOptions:    { globals: globals.mocha },
    },
);
