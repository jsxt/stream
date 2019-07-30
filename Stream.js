/// <reference lib="esnext" />
class Deferred {
    constructor() {
        this._promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }
    get promise() {
        return this._promise;
    }
    get resolver() {
        return { resolve: this._resolve, reject: this._reject };
    }
}
const doNothing = () => {
    /* Nothing to do in doNothing */
};
export class Queue {
    constructor() {
        this._queue = new Set();
    }
    get isEmpty() {
        return this._queue.size === 0;
    }
    enqueue(value) {
        const wrapper = { value };
        this._queue.add(wrapper);
    }
    dequeue() {
        if (this._queue.size === 0) {
            throw new Error(`Can't dequeue from empty queue`);
        }
        const [wrapper] = this._queue;
        this._queue.delete(wrapper);
        return wrapper.value;
    }
}
class UnreachableError extends Error {
    constructor(never) {
        super(`This can't happen`);
    }
}
export default class Stream {
    constructor(initializer, options = {}) {
        const { queue = new Queue() } = options;
        if (typeof initializer !== 'function') {
            throw new TypeError("Initializer must be a function");
        }
        const _yield = this._createYield();
        const _throw = this._createCompletionMethod('throw');
        const _return = this._createCompletionMethod('return');
        let cleanupAfterInitialization = false;
        let cleanupComplete;
        const waitingQueue = new Queue();
        this._state = Object.freeze({
            name: 'maybeQueued',
            itemQueue: queue,
            waitingQueue,
            cleanupOperation: () => {
                cleanupAfterInitialization = true;
                cleanupComplete = new Deferred();
                return cleanupComplete.promise;
            },
        });
        const realCleanup = initializer({
            [Symbol.toStringTag]: 'StreamController',
            yield: _yield,
            throw: _throw,
            return: _return,
            next: _yield,
            error: _throw,
            complete: _return,
        });
        const cleanupOperation = typeof realCleanup === 'function'
            ? realCleanup
            : doNothing;
        if (cleanupAfterInitialization) {
            this._doCleanup(cleanupOperation, cleanupComplete);
        }
        else {
            const state = this._state;
            if (state.name === 'endQueued') {
                this._state = Object.freeze({
                    ...state,
                    cleanupOperation,
                });
                return;
            }
            this._state = Object.freeze({
                ...state,
                cleanupOperation,
            });
        }
    }
    _createYield() {
        const _yield = (value) => {
            const state = this._state;
            if (state.name === 'maybeQueued') {
                state.itemQueue.enqueue(value);
                return;
            }
            else if (state.name === 'waitingForValue') {
                const waitingQueue = state.waitingQueue;
                const resolver = waitingQueue.dequeue();
                if (waitingQueue.isEmpty) {
                    this._state = Object.freeze({
                        name: 'maybeQueued',
                        waitingQueue: state.waitingQueue,
                        itemQueue: state.itemQueue,
                        cleanupOperation: state.cleanupOperation,
                    });
                }
                resolver.resolve({
                    done: false,
                    value,
                });
            }
            else if (state.name === 'waitingForEnd') {
                const waitingQueue = state.waitingQueue;
                const resolver = waitingQueue.dequeue();
                resolver.resolve({
                    done: false,
                    value,
                });
                if (waitingQueue.isEmpty) {
                    const endWaiter = state.endWaiter;
                    const cleanedUp = this._doCleanup(state.cleanupOperation);
                    this._state = Object.freeze({
                        name: 'waitingForCleanupToFinish',
                        cleanedUp,
                    });
                    cleanedUp.then(() => {
                        this._state = Object.freeze({ name: 'complete' });
                        // HACK: Stupid coercion because IteratorResult<T>
                        // is broken in TypeScript
                        endWaiter.resolver.resolve({ done: true, value: undefined });
                    }, error => {
                        this._state = Object.freeze({ name: 'complete' });
                        endWaiter.resolver.reject(error);
                    });
                }
            }
            else if (state.name === 'complete'
                || state.name === 'endQueued'
                || state.name === 'waitingForCleanupToFinish') {
                // Maybe warn in these states
            }
        };
        return _yield;
    }
    _createCompletionMethod(type) {
        const _method = (value) => {
            const state = this._state;
            if (state.name === 'maybeQueued') {
                this._state = Object.freeze({
                    name: 'endQueued',
                    itemQueue: state.itemQueue,
                    completionValue: { type, value },
                    cleanedUp: this._doCleanup(state.cleanupOperation)
                });
            }
            else if (state.name === 'waitingForValue'
                || state.name === 'waitingForEnd') {
                const waitingQueue = state.waitingQueue;
                const cleanedUp = this._doCleanup(state.cleanupOperation);
                const resolver = waitingQueue.dequeue();
                cleanedUp.then(_ => {
                    if (type === 'throw') {
                        resolver.reject(value);
                    }
                    else {
                        resolver.resolve({
                            done: true,
                            value,
                        });
                    }
                }, cleanupError => {
                    resolver.reject(cleanupError);
                });
                while (!waitingQueue.isEmpty) {
                    const extraConsumer = waitingQueue.dequeue();
                    const resolveConsumer = () => {
                        extraConsumer.resolve({
                            done: true,
                            // HACK: Stupid coercion because IteratorResult<T>
                            // is broken in TypeScript
                            value: undefined,
                        });
                    };
                    cleanedUp.then(resolveConsumer, resolveConsumer);
                }
                if (state.name === 'waitingForEnd') {
                    const endWaiter = state.endWaiter;
                    const resolveEnd = () => endWaiter.resolver
                        // HACK: Stupid coercion because IteratorResult<T>
                        // is broken in TypeScript
                        .resolve({ done: true, value: undefined });
                    cleanedUp.then(resolveEnd, resolveEnd);
                }
                this._state = Object.freeze({
                    name: 'waitingForCleanupToFinish',
                    cleanedUp,
                });
            }
            else if (state.name === 'complete'
                || state.name === 'waitingForCleanupToFinish'
                || state.name === 'endQueued') {
                // Maybe warn
            }
        };
        return _method;
    }
    async _doCleanup(cleanupOperation, deferred = new Deferred()) {
        try {
            await cleanupOperation();
            deferred.resolver.resolve(undefined);
        }
        catch (err) {
            deferred.resolver.reject(err);
        }
        return deferred.promise;
    }
    next() {
        const state = this._state;
        if (state.name === 'maybeQueued' && !state.itemQueue.isEmpty) {
            const value = state.itemQueue.dequeue();
            return Promise.resolve({
                done: false,
                value,
            });
        }
        else if (state.name === 'waitingForValue' || state.name === 'maybeQueued') {
            const futureValue = new Deferred();
            state.waitingQueue.enqueue(futureValue.resolver);
            this._state = Object.freeze({
                ...state,
                name: 'waitingForValue',
            });
            return futureValue.promise;
        }
        else if (state.name === 'endQueued') {
            if (state.itemQueue.isEmpty) {
                const completion = state.completionValue;
                const cleanedUp = state.cleanedUp;
                this._state = Object.freeze({
                    name: 'waitingForCleanupToFinish',
                    cleanedUp,
                });
                return cleanedUp.then(_ => {
                    this._state = Object.seal({ name: 'complete' });
                    if (completion.type === 'return') {
                        return { done: true, value: completion.value };
                    }
                    else {
                        throw completion.value;
                    }
                }, cleanupError => {
                    this._state = Object.seal({ name: 'complete' });
                    throw cleanupError;
                });
            }
            else {
                const value = state.itemQueue.dequeue();
                return Promise.resolve({
                    done: false,
                    value,
                });
            }
        }
        else if (state.name === 'waitingForEnd') {
            return state.endWaiter.promise.then(() => {
                // HACK: Stupid coercion because IteratorResult<T>
                // is broken in TypeScript
                return { done: true, value: undefined };
            });
        }
        else if (state.name === 'waitingForCleanupToFinish') {
            function doneTrue() {
                return {
                    done: true,
                    // HACK: Stupid coercion because IteratorResult<T>
                    // is broken in TypeScript
                    value: undefined,
                };
            }
            return state.cleanedUp.then(doneTrue, doneTrue);
        }
        else if (state.name === 'complete') {
            // HACK: Stupid coercion because IteratorResult<T>
            // is broken in TypeScript
            return Promise.resolve({ done: true, value: undefined });
        }
        else {
            throw new UnreachableError(state);
        }
    }
    return(returnValue) {
        const state = this._state;
        if (state.name === 'maybeQueued') {
            const cleanedUp = this._doCleanup(state.cleanupOperation);
            this._state = Object.freeze({
                name: 'waitingForCleanupToFinish',
                cleanedUp,
            });
            return cleanedUp.then(_ => {
                this._state = Object.freeze({ name: 'complete' });
                return { done: true, value: returnValue };
            }, cleanupError => {
                this._state = Object.freeze({ name: 'complete' });
                throw cleanupError;
            });
        }
        else if (state.name === 'waitingForValue') {
            const endWaiter = new Deferred();
            this._state = {
                name: 'waitingForEnd',
                endWaiter,
                waitingQueue: state.waitingQueue,
                cleanupOperation: state.cleanupOperation,
            };
            return endWaiter.promise;
        }
        else if (state.name === 'waitingForEnd') {
            const doneTrue = () => ({ done: true, value: returnValue });
            const endWaiter = state.endWaiter;
            return endWaiter.promise.then(doneTrue, doneTrue);
        }
        else if (state.name === 'endQueued') {
            const completion = state.completionValue;
            const cleanedUp = state.cleanedUp;
            this._state = Object.freeze({
                name: 'waitingForCleanupToFinish',
                cleanedUp: state.cleanedUp,
            });
            return cleanedUp.then(_ => {
                this._state = Object.freeze({ name: 'complete' });
                if (completion.type === 'return') {
                    return { done: true, value: completion.value };
                }
                else {
                    throw completion.value;
                }
            }, cleanupError => {
                this._state = Object.freeze({ name: 'complete' });
                throw cleanupError;
            });
        }
        else if (state.name === 'waitingForCleanupToFinish') {
            const doneTrue = () => ({ done: true, value: returnValue });
            return state.cleanedUp.then(doneTrue, doneTrue);
        }
        else if (state.name === 'complete') {
            return Promise.resolve({ done: true, value: returnValue });
        }
        else {
            throw new UnreachableError(state);
        }
    }
    [Symbol.asyncIterator]() {
        return this;
    }
}
//# sourceMappingURL=Stream.js.map