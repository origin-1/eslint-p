export default function grabPrivateMembers(ESLint)
{
    let privateMembers;
    const thrown = Symbol();
    const { prototype } = WeakMap;
    const { set } = prototype;
    let count = 0;
    prototype.set =
    function (...args)
    {
        if (++count === 2)
        {
            privateMembers = this;
            throw thrown;
        }
        return Reflect.apply(set, this, args);
    };
    try
    {
        new ESLint();
    }
    catch (error)
    {
        if (error !== thrown)
            throw error;
    }
    finally
    {
        prototype.set = set;
    }
    return privateMembers;
}
