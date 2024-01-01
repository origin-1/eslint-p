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
                        preprocess(text)
                        {
                            return [text];
                        },
                        postprocess(messages)
                        {
                            return messages[0];
                        },
                    },
                },
            },
        },
        processor: 'test/txt',
        rules:
        {
            'no-console':       2,
            'no-unused-vars':   2,
        },
    },
    {
        files: ['**/*.txt', '**/*.txt/*.txt'],
    },
];
