#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile }  from 'node:fs/promises';
import { fileURLToPath }                        from 'node:url';
import eslintDirURL                             from '../lib/default-eslint-dir-url.js';
import { parse }                                from 'acorn';

{
    const sourceCache = new Map();
    const grabDirURL = new URL('../grab', import.meta.url);
    await mkdir(grabDirURL, { recursive: true });
    const grabSrcDirURL = new URL('../grab-src', import.meta.url);
    const fileBasenames = await readdir(grabSrcDirURL);
    const promises =
    fileBasenames.map(fileBasename => makeGrab(fileBasename, grabDirURL, sourceCache));
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

async function findCuts(templateCode, comments, sourceCache)
{
    const cuts = [];
    let sourceCode;
    let sourceNodes;
    for (const comment of comments)
    {
        if (comment.type === 'Block')
        {
            const match =
            /^\s*globals?\s+(?<name>\w+)(?:[\s*:].*)?\s*--\s*make-grab(?:\s+(?<url>.+))?\s*$/u
            .exec(comment.value);
            if (match)
            {
                const { name, url } = match.groups;
                if (url)
                {
                    const sourceURL = `${eslintDirURL}${url}`;
                    ({ sourceCode, sourceNodes } = await getSourceData(sourceCache, sourceURL));
                }
                const declarationCode = getDeclarationCode(sourceCode, sourceNodes, name);
                const indentSpace = getIndentBefore(templateCode, comment.start);
                const replacement = indent(declarationCode, indentSpace);
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

function getDeclarationCode(code, nodes, name)
{
    let prevNode = null;
    for (const node of nodes)
    {
        switch (node.type)
        {
        case 'FunctionDeclaration':
            if (hasIdWithName(node, name))
            {
                let start;
                if (prevNode)
                    start = prevNode.end;
                else
                    ({ start } = node);
                const { end } = node;
                const declarationCode = trimLeadingEmptyLines(code.slice(start, end));
                return declarationCode;
            }
            break;
        case 'VariableDeclaration':
            if (node.declarations.some(declarator => hasIdWithName(declarator, name)))
            {
                const { start, end } = node;
                const declarationCode = trimLeadingEmptyLines(code.slice(start, end));
                return declarationCode;
            }
            break;
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

async function getSourceData(sourceCache, sourceURL)
{
    let data = sourceCache.get(sourceURL);
    if (!data)
    {
        const sourcePath = fileURLToPath(sourceURL);
        const sourceCode = await readFile(sourcePath, 'utf-8');
        const sourceNodes = parse(sourceCode, { ecmaVersion: 'latest' }).body;
        data = { sourceCode, sourceNodes };
        sourceCache.set(sourceURL, data);
    }
    return data;
}

function hasIdWithName(node, name)
{
    const { id } = node;
    return id.type === 'Identifier' && id.name === name;
}

function indent(code, indentSpace)
{
    return code.split('\n').map(line => `${indentSpace}${line}`).join('\n');
}

async function makeGrab(fileBasename, grabDirURL, sourceCache)
{
    const templateURL = new URL(`../grab-src/${fileBasename}`, import.meta.url);
    const templateCode = await readFile(templateURL, 'utf-8');
    const comments = [];
    parse(templateCode, { ecmaVersion: 'latest', onComment: comments, sourceType: 'module' });
    const cuts = await findCuts(templateCode, comments, sourceCache);
    const destCode = applyCuts(templateCode, cuts);
    const destURL = `${grabDirURL}/${fileBasename}`;
    const destPath = fileURLToPath(destURL);
    await writeFile(destPath, destCode);
}

function trimLeadingEmptyLines(code)
{
    return code.replace(/^( *\n)*/, '');
}
