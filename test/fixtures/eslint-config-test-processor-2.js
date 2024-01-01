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
                            return [text.replace('a()', 'b()')];
                        },
                        postprocess(messages)
                        {
                            messages[0][0].ruleId = 'post-processed';
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
