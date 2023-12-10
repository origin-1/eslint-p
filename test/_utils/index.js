/**
 * @fileoverview Utilities used in tests
 */

// -----------------------------------------------------------------------------
// Requirements
// -----------------------------------------------------------------------------

import { createTeardown } from 'fs-teardown';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Prevents leading spaces in a multiline template literal from appearing in the resulting string
 * @param {string[]} strings The strings in the template literal
 * @param {any[]} values The interpolation values in the template literal.
 * @returns {string} The template literal, with spaces removed from all lines
 */
function unIndent(strings, ...values)
{
    const text = strings
    .map((s, i) => i === 0 ? s : values[i - 1] + s)
    .join('');
    const lines = text.replace(/^\n/u, '').replace(/\n\s*$/u, '').split('\n');
    const lineIndents = lines.filter(line => line.trim()).map(line => line.match(/ */u)[0].length);
    const minLineIndent = Math.min(...lineIndents);
    return lines.map(line => line.slice(minLineIndent)).join('\n');
}

/**
 * Creates a new filesystem volume at the given location with the given files.
 * @param {Object} desc A description of the filesystem volume to create.
 * @param {string} desc.cwd The current working directory ESLint is using.
 * @param {Object} desc.files A map of filename to file contents to create.
 * @returns {Teardown} An object with prepare(), cleanup(), and getPath() methods.
 */
function createCustomTeardown({ cwd, files })
{
    const { prepare, cleanup, resolve: getPath } = createTeardown({ rootDir: cwd, paths: files });
    return { prepare, cleanup, getPath };
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

export { createCustomTeardown, unIndent };
