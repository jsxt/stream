
class NotSameValueError<T> extends Error {
    private readonly _value1: T;
    private readonly _value2: T;

    constructor(message: string, value1: T, value2: T) {
        super(message);
        this._value1 = value1;
        this._value2 = value2;
    }

    get value1() {
        return this._value1;
    }

    get value2() {
        return this._value2;
    }
}

export function is<T>(a: T, b: T, message?: string) {
    if (!Object.is(a, b)) {
        throw new NotSameValueError(message || `Values are not the same`, a, b);
    }
}

class NotDeepEqualError<T> extends Error {
    private readonly _value1: T;
    private readonly _value2: T;

    constructor(message: string, value1: T, value2: T) {
        super(message);
        this._value1 = value1;
        this._value2 = value2;
    }

    get value1() {
        return this._value1;
    }

    get value2() {
        return this._value2;
    }
}

export function deepEqual<T>(a: T, b: T, message?: string) {
    const seen = new Set();

    function deepEqualRecursive(a: T, b: T): boolean {
        if (seen.has(a)) {
            throw new TypeError("Circular objects not supported");
        }
        if (a === undefined) {
            return b === undefined;
        } else if (a === null) {
            return b === null;
        } else if (typeof a === "number"
        || typeof a === "string"
        || typeof a === "boolean"
        || typeof a === "bigint"
        || typeof a === "symbol") {
            return Object.is(a, b);
        } else if (Array.isArray(a)) {
            seen.add(a);
            return Array.isArray(b)
                && a.length === b.length
                && a.every((item, index) => deepEqualRecursive(item, b[index]));
        } else if (Object.getPrototypeOf(a) === null
        || Object.getPrototypeOf(a) === Object.prototype) {
            seen.add(a);
            return typeof b === "object"
                && Object.keys(a).length === Object.keys(b).length
                && Object.entries(a).every(([index, item]) => {
                    const o = b as any;
                    return deepEqualRecursive(item, o[index]);
                });
        }
        throw new TypeError("Can't use deepEqual on value");
    }

    if (!deepEqualRecursive(a, b)) {
        throw new NotDeepEqualError(message || `Values are not deep equal`, a, b);
    }
}


class DidntThrowError extends Error {
    private readonly _function: (...args: Array<any>) => any;

    constructor(message: string, func: (...args: Array<any>) => any) {
        super(message);
        this._function = func;
    }

    get function() {
        return this._function;
    }
}

export function throws(func: ((...args: Array<any>) => any), message?: string) {
    try {
        func();
        throw new DidntThrowError(message || `Function didn't throw`, func);
    } catch (err) {
        return err;
    }
}

export async function throwsAsync(func: ((...args: Array<any>) => any), message?: string) {
    try {
        await func();
        throw new DidntThrowError(message || `Function didn't throw`, func);
    } catch (err) {
        return err;
    }
}

class NotTrueError extends Error {}

export function isTrue(value: boolean) {
    if (!value) {
        throw new NotTrueError(`Expected value to be true`);
    }
}

class NotFalseError extends Error {}

export function isFalse(value: boolean, message?: string) {
    if (value) {
        throw new NotFalseError(message || `Expected value to be false`);
    }
}

class NotInstanceOfError extends Error {
    private readonly _value: any;
    private readonly _type: any;

    constructor(message: string, value: any, type: any) {
        super(message);
        this._value = value;
        this._type = type;
    }

    get value() {
        return this._value;
    }

    get type() {
        return this._type;
    }
}

export function instanceOf(value: any, type: any, message?: string) {
    if (!(value instanceof type)) {
        throw new NotInstanceOfError(message || `Expected value to be instance`, value, type);
    }
}

class IsResolvedError extends Error {
    private readonly _promise: Promise<any>;
    constructor(promise: Promise<any>, message: string) {
        super(message);

        this._promise = promise;
    }

    get promise() {
        return this._promise;
    }
}

class NotResolvedError extends Error {
    private readonly _promise: Promise<any>;
    constructor(promise: Promise<any>, message: string) {
        super(message);

        this._promise = promise;
    }

    get promise() {
        return this._promise;
    }
}

async function isResolved(promise: Promise<any>) {
    const resolved = Symbol();
    try {
        const result = await Promise.race([promise, resolved]);
        return result !== resolved;
    } catch {
        return false;
    }
}

export async function resolved(promise: Promise<any>, message?: string) {
    if (!await isResolved(promise)) {
        throw new NotResolvedError(promise, message || `Expected promise to be resolved`);
    }
}

export async function notResolved(promise: Promise<any>, message?: string) {
    if (await isResolved(promise)) {
        throw new IsResolvedError(promise, message || `Expected promise to not be resolved`);
    }
}
