import { createConfig } from '@origin-1/eslint-config';
import globals          from 'globals';

export default createConfig
(
    { ignores: ['coverage', 'grab', 'test/fixtures'] },
    {
        jsVersion:          2022,
        languageOptions:    { globals: globals.nodeBuiltin, sourceType: 'module' },
    },
    {
        files:              ['test/*'],
        languageOptions:    { globals: globals.mocha },
    },
);
