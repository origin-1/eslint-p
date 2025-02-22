module.exports =
[
    {
        plugins:
        {
            test:
            {
                processors:
                {
                    txt:
                    {
                        preprocess(input)
                        {
                            return input.split(' ').map
                            (
                                (text, index) =>
                                (
                                    {
                                        filename: `example-${index}/a.js`,
                                        text,
                                    }
                                ),
                            );
                        },
                        postprocess(messagesList)
                        {
                            return messagesList.flat();
                        },
                    },
                },
                rules:
                {
                    'test-rule':
                    {
                        meta: { },
                        create(context)
                        {
                            return {
                                Identifier(node)
                                {
                                    context.report
                                    (
                                        {
                                            node,
                                            message:
                                            `filename: ${context.filename} physicalFilename: ${
                                            context.physicalFilename} identifier: ${node.name}`,
                                        },
                                    );
                                },
                            };
                        },
                    },
                },
            },
        },
    },
    {
        files:      ['**/*.txt'],
        processor:  'test/txt',
    },
    {
        files:  ['**/a.js'],
        rules:  { 'test/test-rule': 'error' },
    },
];
