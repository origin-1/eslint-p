#!/usr/bin/env node

import { mkdir, readFile, writeFile }   from 'node:fs/promises';
import { fileURLToPath }                from 'node:url';
import eslintDirURL                     from '../lib/default-eslint-dir-url.js';
import { parse }                        from 'acorn';

{
    const grabDirURL = new URL('../grab', import.meta.url);
    await mkdir(grabDirURL, { recursive: true });
    const promises =
    [
        makeGrabs
        (
            `${eslintDirURL}lib/cli.js`,
            [
                'count-errors.js',
                'create-print-results.js',
                'quiet-fix-predicate.js',
            ],
            grabDirURL,
        ),
        makeGrabs
        (
            `${eslintDirURL}lib/eslint/flat-eslint.js`,
            [
                'create-calculate-config-array.js',
                'create-process-lint-report.js',
                'create-should-message-be-fixed.js',
                'create-verify-text.js',
                'get-placeholder-path.js',
            ],
            grabDirURL,
        ),
    ];
    await Promise.all(promises);
}

function applyCuts(code, cuts)
{
    const parts = [];
    let start = 0;
    for (const cut of cuts)
    {
        const part1 = code.slice(start, cut.start);
        const part2 = cut.replacement;
        parts.push(part1, part2);
        start = cut.end;
    }
    {
        const part = code.slice(start);
        parts.push(part);
    }
    return parts.join('');
}

function findCuts(templateCode, comments, sourceCode, sourceNodes)
{
    const cuts = [];
    for (const comment of comments)
    {
        if (comment.type === 'Block')
        {
            const match =
            /^\s*globals?\s+(?<name>\w+)(?:[\s*:].*)?\s*--\s*make-grab\s*$/u.exec(comment.value);
            if (match)
            {
                const { name } = match.groups;
                const functionCode = getFunctionCode(sourceCode, sourceNodes, name);
                const indentSpace = getIndentBefore(templateCode, comment.start);
                const replacement = indent(functionCode, indentSpace);
                const cut =
                {
                    start:  comment.start - indentSpace.length,
                    end:    comment.end,
                    replacement,
                };
                cuts.push(cut);
            }
        }
    }
    cuts.sort((cutA, cutB) => cutA.start - cutB.start);
    return cuts;
}

function getFunctionCode(code, nodes, name)
{
    let prevNode = null;
    for (const node of nodes)
    {
        if (node.type === 'FunctionDeclaration')
        {
            const { id } = node;
            if (id.type === 'Identifier' && id.name === name)
            {
                let start;
                if (prevNode)
                    start = prevNode.end;
                else
                    ({ start } = node);
                const { end } = node;
                const functionCode = trimLeadingEmptyLines(code.slice(start, end));
                return functionCode;
            }
        }
        prevNode = node;
    }
}

function getIndentBefore(code, end)
{
    let index = end;
    while (index--)
    {
        const char = code[index];
        if (char === '\n')
            break;
        if (char !== ' ' && char !== '\t')
            return '';
    }
    return code.slice(index + 1, end);
}

function indent(code, indentSpace)
{
    return code.split('\n').map(line => `${indentSpace}${line}`).join('\n');
}

async function makeGrab(fileBasename, grabDirURL, sourceCode, sourceNodes)
{
    const templateURL = new URL(`../grab-src/${fileBasename}`, import.meta.url);
    const templateCode = await readFile(templateURL, 'utf-8');
    const comments = [];
    parse(templateCode, { ecmaVersion: 'latest', onComment: comments, sourceType: 'module' });
    const cuts = findCuts(templateCode, comments, sourceCode, sourceNodes);
    const destCode = applyCuts(templateCode, cuts);
    const destURL = `${grabDirURL}/${fileBasename}`;
    const destPath = fileURLToPath(destURL);
    await writeFile(destPath, destCode);
}

async function makeGrabs(sourceURL, fileBasenames, grabDirURL)
{
    const sourcePath = fileURLToPath(sourceURL);
    const sourceCode = await readFile(sourcePath, 'utf-8');
    const sourceNodes = parse(sourceCode, { ecmaVersion: 'latest' }).body;
    const promises =
    fileBasenames.map(fileBasename => makeGrab(fileBasename, grabDirURL, sourceCode, sourceNodes));
    await Promise.all(promises);
}

function trimLeadingEmptyLines(code)
{
    return code.replace(/^( *\n)*/, '');
}
