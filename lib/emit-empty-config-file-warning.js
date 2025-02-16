export default function emitEmptyConfigFileWarning(configFilePath)
{
    process.emitWarning
    (
        `Running ESLint with an empty config (from ${configFilePath
        }). Please double-check that this is what you want. If you want to run ESLint with an ` +
        'empty config, export [{}] to remove this warning.',
        'ESLintEmptyConfigWarning',
    );
}
