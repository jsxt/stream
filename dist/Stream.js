/// <reference lib="esnext" />
class AggregateError extends Error {
    constructor(errors, message) {
        super(message);
        this.errors = errors;
    }
}
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
    constructor(_never) {
        super(`This can't happen`);
    }
}
export default class Stream {
    constructor(initializer, options = {}) {
        const { queue = new Queue() } = options;
        if (typeof initializer !== "function") {
            throw new TypeError("Initializer must be a function");
        }
        const _yield = this._createYield();
        const _throw = this._createThrow();
        const _return = this._createReturn();
        let cleanupComplete;
        const waitingQueue = new Queue();
        this._state = Object.freeze({
            name: "maybeQueued",
            itemQueue: queue,
            waitingQueue,
            cleanupOperation: () => {
                cleanupComplete = new Deferred();
                return cleanupComplete.promise;
            },
        });
        const realCleanup = initializer({
            [Symbol.toStringTag]: "StreamController",
            yield: _yield,
            throw: _throw,
            return: _return,
            next: _yield,
            error: _throw,
            complete: _return,
        });
        const cleanupOperation = typeof realCleanup === "function"
            ? realCleanup
            : doNothing;
        if (cleanupComplete) {
            const state = this._state;
            if (state.name !== "endQueued") {
                throw new Error("Impossible state");
            }
            const cleanedUp = this._doCleanup(cleanupOperation, state.completionValue, cleanupComplete);
            this._state = Object.freeze({
                name: "waitingForCleanupToFinish",
                cleanedUp,
                completionValue: state.completionValue,
            });
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            cleanedUp.then((completionValue) => {
                this._state = Object.freeze({
                    name: "complete",
                    completionValue,
                });
            });
        }
        else {
            const state = this._state;
            if (state.name === "endQueued") {
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
            if (state.name === "maybeQueued") {
                state.itemQueue.enqueue(value);
            }
            else if (state.name === "waitingForValue") {
                const { waitingQueue } = state;
                const resolver = waitingQueue.dequeue();
                if (waitingQueue.isEmpty) {
                    this._state = Object.freeze({
                        name: "maybeQueued",
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
            else if (state.name === "waitingForEnd") {
                const { waitingQueue } = state;
                const resolver = waitingQueue.dequeue();
                resolver.resolve({
                    done: false,
                    value,
                });
                if (waitingQueue.isEmpty) {
                    const { endWaiter, completionValue } = state;
                    const cleanedUp = this._doCleanup(state.cleanupOperation, completionValue);
                    this._state = Object.freeze({
                        name: "waitingForCleanupToFinish",
                        cleanedUp,
                        completionValue,
                    });
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    cleanedUp.then((completionValue) => {
                        this._state = Object.freeze({ name: "complete", completionValue });
                        if (completionValue.type === "return") {
                            endWaiter.resolver.resolve({ done: true, value: completionValue.value });
                        }
                        else {
                            endWaiter.resolver.reject(completionValue.reason);
                        }
                    });
                }
            }
            else if (state.name === "complete"
                || state.name === "endQueued"
                || state.name === "waitingForCleanupToFinish") {
                // Maybe warn in these states
            }
        };
        return _yield;
    }
    _createReturn() {
        const _return = (value) => {
            const completionValue = { type: "return", value };
            const state = this._state;
            if (state.name === "maybeQueued") {
                this._state = Object.freeze({
                    name: "endQueued",
                    itemQueue: state.itemQueue,
                    completionValue,
                    cleanedUp: this._doCleanup(state.cleanupOperation, completionValue),
                });
            }
            else if (state.name === "waitingForValue"
                || state.name === "waitingForEnd") {
                const { waitingQueue, cleanupOperation } = state;
                const cleanedUp = this._doCleanup(cleanupOperation, completionValue);
                while (!waitingQueue.isEmpty) {
                    const resolver = waitingQueue.dequeue();
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    cleanedUp.then((completionValue) => {
                        if (completionValue.type === "return") {
                            resolver.resolve({ done: true, value: completionValue.value });
                        }
                        else {
                            resolver.reject(completionValue.reason);
                        }
                    });
                }
                if (state.name === "waitingForEnd") {
                    const { endWaiter } = state;
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    cleanedUp.then((completionValue) => {
                        if (completionValue.type === "return") {
                            endWaiter.resolver.resolve({ done: true, value: completionValue.value });
                        }
                        else {
                            endWaiter.resolver.reject(completionValue.reason);
                        }
                    });
                }
                this._state = Object.freeze({
                    name: "waitingForCleanupToFinish",
                    cleanedUp,
                    completionValue,
                });
            }
        };
        return _return;
    }
    _createThrow() {
        const _throw = (reason) => {
            const completionValue = { type: "error", reason };
            const state = this._state;
            if (state.name === "maybeQueued") {
                this._state = Object.freeze({
                    name: "endQueued",
                    itemQueue: state.itemQueue,
                    completionValue,
                    cleanedUp: this._doCleanup(state.cleanupOperation, completionValue),
                });
            }
            else if (state.name === "waitingForValue"
                || state.name === "waitingForEnd") {
                const { waitingQueue, cleanupOperation } = state;
                const cleanedUp = this._doCleanup(cleanupOperation, completionValue);
                while (!waitingQueue.isEmpty) {
                    const resolver = waitingQueue.dequeue();
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    cleanedUp.then((completionValue) => {
                        if (completionValue.type === "return") {
                            resolver.resolve({ done: true, value: completionValue.value });
                        }
                        else {
                            resolver.reject(completionValue.reason);
                        }
                    });
                }
                if (state.name === "waitingForEnd") {
                    const { endWaiter } = state;
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    cleanedUp.then((completionValue) => {
                        if (completionValue.type === "return") {
                            endWaiter.resolver.resolve({ done: true, value: completionValue.value });
                        }
                        else {
                            endWaiter.resolver.reject(completionValue.reason);
                        }
                    });
                }
                this._state = Object.freeze({
                    name: "waitingForCleanupToFinish",
                    cleanedUp,
                    completionValue,
                });
            }
        };
        return _throw;
    }
    async _doCleanup(cleanupOperation, completionValue, deferred = new Deferred()) {
        try {
            await cleanupOperation();
            deferred.resolver.resolve(completionValue);
        }
        catch (cleanupError) {
            if (completionValue.type === "return") {
                deferred.resolver.resolve({ type: "error", reason: cleanupError });
            }
            else {
                deferred.resolver.resolve({
                    type: "error",
                    reason: new AggregateError([completionValue.reason, cleanupError]),
                });
            }
        }
        return deferred.promise;
    }
    next() {
        const state = this._state;
        if (state.name === "maybeQueued" && !state.itemQueue.isEmpty) {
            const value = state.itemQueue.dequeue();
            return Promise.resolve({
                done: false,
                value,
            });
        }
        else if (state.name === "waitingForValue" || state.name === "maybeQueued") {
            const futureValue = new Deferred();
            state.waitingQueue.enqueue(futureValue.resolver);
            this._state = Object.freeze({
                ...state,
                name: "waitingForValue",
            });
            return futureValue.promise;
        }
        else if (state.name === "endQueued") {
            if (state.itemQueue.isEmpty) {
                const { cleanedUp, completionValue } = state;
                this._state = Object.freeze({
                    name: "waitingForCleanupToFinish",
                    cleanedUp,
                    completionValue,
                });
                return cleanedUp.then((completionValue) => {
                    this._state = Object.freeze({ name: "complete", completionValue });
                    if (completionValue.type === "return") {
                        return { done: true, value: completionValue.value };
                    }
                    throw completionValue.reason;
                });
            }
            const value = state.itemQueue.dequeue();
            return Promise.resolve({
                done: false,
                value,
            });
        }
        else if (state.name === "waitingForEnd") {
            return Promise.resolve(state.endWaiter.promise);
        }
        else if (state.name === "waitingForCleanupToFinish") {
            const { cleanedUp } = state;
            return cleanedUp.then((completionValue) => {
                if (completionValue.type === "return") {
                    return { done: true, value: completionValue.value };
                }
                throw completionValue.reason;
            });
        }
        else if (state.name === "complete") {
            const { completionValue } = state;
            if (completionValue.type === "return") {
                return Promise.resolve({ done: true, value: completionValue.value });
            }
            return Promise.reject(completionValue.reason);
        }
        throw new UnreachableError(state);
    }
    return(returnValue) {
        const completionValue = {
            type: "return",
            value: returnValue,
        };
        const state = this._state;
        if (state.name === "maybeQueued") {
            const cleanedUp = this._doCleanup(state.cleanupOperation, completionValue);
            this._state = Object.freeze({
                name: "waitingForCleanupToFinish",
                cleanedUp,
                completionValue,
            });
            return cleanedUp.then((completionValue) => {
                this._state = Object.freeze({
                    name: "complete",
                    completionValue,
                });
                if (completionValue.type === "return") {
                    return { done: true, value: completionValue.value };
                }
                throw completionValue.reason;
            });
        }
        else if (state.name === "waitingForValue") {
            const endWaiter = new Deferred();
            this._state = {
                name: "waitingForEnd",
                endWaiter,
                waitingQueue: state.waitingQueue,
                cleanupOperation: state.cleanupOperation,
                completionValue: { type: "return", value: returnValue },
            };
            return endWaiter.promise;
        }
        else if (state.name === "waitingForEnd") {
            const doneTrue = () => ({ done: true, value: returnValue });
            const { endWaiter } = state;
            return endWaiter.promise.then(doneTrue, doneTrue);
        }
        else if (state.name === "endQueued") {
            const { cleanedUp, completionValue } = state;
            this._state = Object.freeze({
                name: "waitingForCleanupToFinish",
                cleanedUp: state.cleanedUp,
                completionValue,
            });
            return cleanedUp.then((completionValue) => {
                this._state = Object.freeze({
                    name: "complete",
                    completionValue,
                });
                if (completionValue.type === "return") {
                    return { done: true, value: completionValue.value };
                }
                throw completionValue.reason;
            });
        }
        else if (state.name === "waitingForCleanupToFinish") {
            const { cleanedUp } = state;
            return cleanedUp.then((completionValue) => {
                this._state = Object.freeze({
                    name: "complete",
                    completionValue,
                });
                if (completionValue.type === "return") {
                    return { done: true, value: completionValue.value };
                }
                throw completionValue.reason;
            });
        }
        else if (state.name === "complete") {
            const { completionValue } = state;
            if (completionValue.type === "return") {
                return Promise.resolve({ done: true, value: completionValue.value });
            }
            throw completionValue.reason;
        }
        throw new UnreachableError(state);
    }
    [Symbol.asyncIterator]() {
        return this;
    }
}
//# sourceMappingURL=Stream.js.map