import { createFlatConfig } from '@origin-1/eslint-config';
import globals              from 'globals';

const nodeESMGlobals =
{
    ...globals.node,
    __dirname:  'off',
    __filename: 'off',
    exports:    'off',
    module:     'off',
    require:    'off',
};

export default createFlatConfig
(
    { ignores: ['coverage', 'grab', 'test/fixtures'] },
    {
        jsVersion:          2022,
        languageOptions:    { globals: nodeESMGlobals, sourceType: 'module' },
    },
);
