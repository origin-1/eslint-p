export default function grabPrivateMembers(ESLint)
{
    const { hasFlag } = ESLint.prototype;
    let privateMembers;
    {
        const { prototype } = WeakMap;
        const { get } = prototype;
        prototype.get =
        function ()
        {
            prototype.get = get;
            privateMembers = this;
            throw Symbol();
        };
    }
    try
    {
        hasFlag();
    }
    catch
    {
        return privateMembers;
    }
}
