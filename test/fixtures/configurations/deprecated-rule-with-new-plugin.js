const deprecated =
{
    message:    'Deprecation',
    url:        'https://example.com',
    replacedBy:
    [
        {
            message:    'Replacement',
            plugin:     { name: 'plugin' },
            rule:       { name: 'name' },
        },
    ],
};

module.exports =
{
    plugins:
    {
        test:
        {
            rules:
            {
                deprecated:
                {
                    meta:   { deprecated },
                    create: () => ({ }),
                },
            },
        },
    },
};
