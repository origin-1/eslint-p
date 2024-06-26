import { createConfig } from '@origin-1/eslint-config';
import globals          from 'globals';

const nodeESMGlobals =
{
    ...globals.node,
    __dirname:  'off',
    __filename: 'off',
    exports:    'off',
    module:     'off',
    require:    'off',
};

export default createConfig
(
    { ignores: ['coverage', 'eslint-p.js', 'grab', 'test/fixtures'] },
    {
        jsVersion:          2022,
        languageOptions:    { globals: nodeESMGlobals, sourceType: 'module' },
    },
);
