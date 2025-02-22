module.exports =
{
    plugins:
    {
        test:
        {
            rules:
            {
                'deprecated-with-replacement':
                {
                    meta:   { deprecated: true, replacedBy: ['replacement'] },
                    create: () => ({ }),
                },
                'deprecated-without-replacement':
                {
                    meta:   { deprecated: true },
                    create: () => ({ }),
                },
            },
        },
    },
};
