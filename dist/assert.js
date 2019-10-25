class NotSameValueError extends Error {
    constructor(message, value1, value2) {
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
export function is(a, b, message) {
    if (!Object.is(a, b)) {
        throw new NotSameValueError(message || `Values are not the same`, a, b);
    }
}
class NotDeepEqualError extends Error {
    constructor(message, value1, value2) {
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
export function deepEqual(a, b, message) {
    const seen = new Set();
    function deepEqualRecursive(a, b) {
        if (seen.has(a)) {
            throw new TypeError("Circular objects not supported");
        }
        if (a === undefined) {
            return b === undefined;
        }
        else if (a === null) {
            return b === null;
        }
        else if (typeof a === "number"
            || typeof a === "string"
            || typeof a === "boolean"
            || typeof a === "bigint"
            || typeof a === "symbol") {
            return Object.is(a, b);
        }
        else if (Array.isArray(a)) {
            seen.add(a);
            return Array.isArray(b)
                && a.length === b.length
                && a.every((item, index) => deepEqualRecursive(item, b[index]));
        }
        else if (Object.getPrototypeOf(a) === null
            || Object.getPrototypeOf(a) === Object.prototype) {
            seen.add(a);
            return typeof b === "object"
                && Object.keys(a).length === Object.keys(b).length
                && Object.entries(a).every(([index, item]) => {
                    const o = b;
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
    constructor(message, func) {
        super(message);
        this._function = func;
    }
    get function() {
        return this._function;
    }
}
export function throws(func, message) {
    try {
        func();
        throw new DidntThrowError(message || `Function didn't throw`, func);
    }
    catch (err) {
        return err;
    }
}
export async function throwsAsync(func, message) {
    try {
        await func();
        throw new DidntThrowError(message || `Function didn't throw`, func);
    }
    catch (err) {
        return err;
    }
}
class NotTrueError extends Error {
}
export function isTrue(value) {
    if (!value) {
        throw new NotTrueError(`Expected value to be true`);
    }
}
class NotFalseError extends Error {
}
export function isFalse(value, message) {
    if (value) {
        throw new NotFalseError(message || `Expected value to be false`);
    }
}
class NotInstanceOfError extends Error {
    constructor(message, value, type) {
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
export function instanceOf(value, type, message) {
    if (!(value instanceof type)) {
        throw new NotInstanceOfError(message || `Expected value to be instance`, value, type);
    }
}
class IsResolvedError extends Error {
    constructor(promise, message) {
        super(message);
        this._promise = promise;
    }
    get promise() {
        return this._promise;
    }
}
class NotResolvedError extends Error {
    constructor(promise, message) {
        super(message);
        this._promise = promise;
    }
    get promise() {
        return this._promise;
    }
}
async function isResolved(promise) {
    const resolved = Symbol();
    try {
        const result = await Promise.race([promise, resolved]);
        return result !== resolved;
    }
    catch {
        return false;
    }
}
export async function resolved(promise, message) {
    if (!await isResolved(promise)) {
        throw new NotResolvedError(promise, message || `Expected promise to be resolved`);
    }
}
export async function notResolved(promise, message) {
    if (await isResolved(promise)) {
        throw new IsResolvedError(promise, message || `Expected promise to not be resolved`);
    }
}
//# sourceMappingURL=assert.js.map