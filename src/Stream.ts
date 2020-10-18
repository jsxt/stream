/// <reference lib="esnext" />

type Resolver<T> = {
    resolve: (value: T | Promise<T>) => void,
    reject: (error: any) => void,
};

class Deferred<T> {
    readonly #resolve: (value: T | Promise<T>) => void;
    readonly #reject: (error: any) => void;
    readonly #promise: Promise<T>;

    constructor() {
        let resolve!: Resolver<T>["resolve"];
        let reject!: Resolver<T>["reject"];
        this.#promise = new Promise((pResolve, pReject) => {
            resolve = pResolve;
            reject = pReject;
        });
        this.#resolve = resolve;
        this.#reject = reject;
    }

    get promise(): Promise<T> {
        return this.#promise;
    }

    get resolver(): Resolver<T> {
        return { resolve: this.#resolve, reject: this.#reject };
    }
}

const doNothing = () => {
    /* Nothing to do in doNothing */
};

interface AbstractQueue<T> {
    isEmpty: boolean;
    enqueue: (value: T) => any;
    dequeue: () => T;
}

export class Queue<T> implements AbstractQueue<T> {
    readonly #queue: Set<{ value: T} > = new Set();

    get isEmpty(): boolean {
        return this.#queue.size === 0;
    }

    enqueue(value: T): void {
        const wrapper = { value };
        this.#queue.add(wrapper);
    }

    dequeue(): T {
        if (this.#queue.size === 0) {
            throw new Error(`Can't dequeue from empty queue`);
        }
        const [wrapper] = this.#queue;
        this.#queue.delete(wrapper);
        return wrapper.value;
    }
}

type CleanupCallback = () => any;

type WaitingQueue<T, R> = Queue<Deferred<IteratorResult<T, R>>["resolver"]>;

type CompletionValue<R> = { type: "return", value: R } | { type: "error", reason: any };

type MaybeQueuedState<T, R> = {
    name: "maybeQueued",
    waitingQueue: WaitingQueue<T, R>,
    itemQueue: AbstractQueue<T>,
    cleanupOperation: CleanupCallback,
};

type EndQueuedState<T, R> = {
    name: "endQueued",
    itemQueue: AbstractQueue<T>,
    cleanedUp: Promise<CompletionValue<R>>,
    completionValue: CompletionValue<R>,
};

type WaitingForValueState<T, R> = {
    name: "waitingForValue",
    waitingQueue: WaitingQueue<T, R>,
    itemQueue: AbstractQueue<T>,
    cleanupOperation: CleanupCallback,
};

type WaitingForEndState<T, R> = {
    name: "waitingForEnd",
    waitingQueue: WaitingQueue<T, R>,
    endWaiter: Deferred<IteratorResult<T, R>>,
    cleanupOperation: CleanupCallback,
    completionValue: CompletionValue<R>,
};

type WaitingForCleanupToFinish<R> = {
    name: "waitingForCleanupToFinish",
    cleanedUp: Promise<CompletionValue<R>>,
    completionValue: CompletionValue<R>,
};

type CompleteState<R> = {
    name: "complete",
    completionValue: CompletionValue<R>,
};

type StreamState<T, R>
    = MaybeQueuedState<T, R>
    | EndQueuedState<T, R>
    | WaitingForValueState<T, R>
    | WaitingForEndState<T, R>
    | WaitingForCleanupToFinish<R>
    | CompleteState<R>;

export type StreamController<T, R=void> = {
    [Symbol.toStringTag]: string,
    yield: (value: T) => void,
    next: (value: T) => void,
    throw: (error?: any) => void,
    error: (error?: any) => void,
    return: (endValue: R) => void,
    complete: (endValue: R) => void,
};

class UnreachableError extends Error {
    constructor(_never: never) {
        super(`This can't happen`);
    }
}

type StreamInitializer<T, R>
    = ((controller: StreamController<T, R>) => void)
    | ((controller: StreamController<T, R>) => CleanupCallback);

type StreamOptions<T> = {
    queue?: AbstractQueue<T>,
};

function assert(condition: boolean): asserts condition {
    if (!condition) {
        throw new Error("assertion failed");
    }
}

export default class Stream<T, R=void>
implements AsyncIterator<T, R>, AsyncIterable<T> {
    #state: Readonly<StreamState<T, R>>;

    constructor(initializer: StreamInitializer<T, R>, options: StreamOptions<T>={}) {
        const { queue=new Queue<T>() } = options;

        if (typeof initializer !== "function") {
            throw new TypeError("Initializer must be a function");
        }

        const yieldValue = this.#yieldValue;
        const throwValue = this.#throwValue;
        const returnValue = this.#returnValue;

        let cleanupComplete: Deferred<CompletionValue<R>>;

        const waitingQueue: WaitingQueue<T, R> = new Queue();

        this.#state = Object.freeze({
            name: "maybeQueued",
            itemQueue: queue,
            waitingQueue,
            cleanupOperation: () => {
                cleanupComplete = new Deferred();
                return cleanupComplete.promise;
            },
        }) as StreamState<T, R>;

        const realCleanup = initializer({
            [Symbol.toStringTag]: "StreamController",
            yield: yieldValue,
            throw: throwValue,
            return: returnValue,
            next: yieldValue,
            error: throwValue,
            complete: returnValue,
        });

        const cleanupOperation = typeof realCleanup === "function"
            ? realCleanup
            : doNothing;

        if (cleanupComplete!) {
            const state = this.#state;
            if (state.name !== "endQueued") {
                throw new Error("Impossible state");
            }

            const cleanedUp = this.#doCleanup(cleanupOperation, state.completionValue, cleanupComplete!);
            this.#state = Object.freeze({
                name: "endQueued",
                itemQueue: state.itemQueue,
                cleanedUp,
                completionValue: state.completionValue,
            });
        } else {
            assert(
                this.#state.name === "endQueued"
                || this.#state.name === "maybeQueued",
            );
            const state = this.#state;
            if (state.name === "endQueued") {
                this.#state = Object.freeze({
                    ...state,
                    cleanupOperation,
                });
                return;
            }
            this.#state = Object.freeze({
                ...state,
                cleanupOperation,
            });
        }
    }

    #yieldValue = (value: T): void => {
        const state = this.#state;
        if (state.name === "maybeQueued") {
            state.itemQueue.enqueue(value);
        } else if (state.name === "waitingForValue") {
            const { waitingQueue } = state;
            const resolver = waitingQueue.dequeue();
            if (waitingQueue.isEmpty) {
                this.#state = Object.freeze({
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
        } else if (state.name === "waitingForEnd") {
            const { waitingQueue } = state;
            const resolver = waitingQueue.dequeue();
            resolver.resolve({
                done: false,
                value,
            });

            if (waitingQueue.isEmpty) {
                const { endWaiter, completionValue } = state;
                const cleanedUp = this.#doCleanup(state.cleanupOperation, completionValue);

                this.#state = Object.freeze({
                    name: "waitingForCleanupToFinish",
                    cleanedUp,
                    completionValue,
                });

                void cleanedUp.then((completionValue) => {
                    this.#state = Object.freeze({ name: "complete", completionValue });
                    if (completionValue.type === "return") {
                        endWaiter.resolver.resolve({ done: true, value: completionValue.value });
                    } else {
                        endWaiter.resolver.reject(completionValue.reason);
                    }
                });
            }
        } else if (state.name === "complete"
            || state.name === "endQueued"
            || state.name === "waitingForCleanupToFinish") {
            // Maybe warn in these states
        }
    };

    #returnValue = (value: R): void => {
        const completionValue = { type: "return" as const, value };
        const state = this.#state;
        if (state.name === "maybeQueued") {
            this.#state = Object.freeze({
                name: "endQueued",
                itemQueue: state.itemQueue,
                completionValue,
                cleanedUp: this.#doCleanup(state.cleanupOperation, completionValue),
            });
        } else if (state.name === "waitingForValue"
            || state.name === "waitingForEnd") {
            const { waitingQueue, cleanupOperation } = state;
            const cleanedUp = this.#doCleanup(cleanupOperation, completionValue);

            while (!waitingQueue.isEmpty) {
                const resolver = waitingQueue.dequeue();

                void cleanedUp.then((completionValue) => {
                    if (completionValue.type === "return") {
                        resolver.resolve({ done: true, value: completionValue.value });
                    } else {
                        resolver.reject(completionValue.reason);
                    }
                });
            }

            if (state.name === "waitingForEnd") {
                const { endWaiter } = state;

                void cleanedUp.then((completionValue) => {
                    if (completionValue.type === "return") {
                        endWaiter.resolver.resolve({ done: true, value: completionValue.value });
                    } else {
                        endWaiter.resolver.reject(completionValue.reason);
                    }
                });
            }

            this.#state = Object.freeze({
                name: "waitingForCleanupToFinish",
                cleanedUp,
                completionValue,
            });
        }
    };

    #throwValue = (reason: any | any): void => {
        const completionValue = { type: "error" as const, reason };
        const state = this.#state;
        if (state.name === "maybeQueued") {
            this.#state = Object.freeze({
                name: "endQueued",
                itemQueue: state.itemQueue,
                completionValue,
                cleanedUp: this.#doCleanup(state.cleanupOperation, completionValue),
            });
        } else if (state.name === "waitingForValue"
            || state.name === "waitingForEnd") {
            const { waitingQueue, cleanupOperation } = state;
            const cleanedUp = this.#doCleanup(cleanupOperation, completionValue);

            while (!waitingQueue.isEmpty) {
                const resolver = waitingQueue.dequeue();

                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                cleanedUp.then((completionValue) => {
                    if (completionValue.type === "return") {
                        resolver.resolve({ done: true, value: completionValue.value });
                    } else {
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
                    } else {
                        endWaiter.resolver.reject(completionValue.reason);
                    }
                });
            }

            this.#state = Object.freeze({
                name: "waitingForCleanupToFinish",
                cleanedUp,
                completionValue,
            });
        }
    };

    #doCleanup = async (
        cleanupOperation: CleanupCallback,
        completionValue: CompletionValue<R>,
        deferred: Deferred<CompletionValue<R>>=new Deferred(),
    ): Promise<CompletionValue<R>> => {
        try {
            await cleanupOperation();
            deferred.resolver.resolve(completionValue);
        } catch (cleanupError: any) {
            if (completionValue.type === "return") {
                deferred.resolver.resolve({ type: "error" as const, reason: cleanupError });
            } else {
                deferred.resolver.resolve({
                    type: "error" as const,
                    reason: new AggregateError([completionValue.reason, cleanupError]),
                });
            }
        }
        return await deferred.promise;
    };

    next(): Promise<IteratorResult<T, R>> {
        const state = this.#state;
        if (state.name === "maybeQueued" && !state.itemQueue.isEmpty) {
            const value = state.itemQueue.dequeue();
            return Promise.resolve({
                done: false,
                value,
            });
        } else if (state.name === "waitingForValue" || state.name === "maybeQueued") {
            const futureValue = new Deferred<IteratorResult<T>>();
            state.waitingQueue.enqueue(futureValue.resolver);
            this.#state = Object.freeze({
                ...state,
                name: "waitingForValue",
            });
            return futureValue.promise;
        } else if (state.name === "endQueued") {
            if (state.itemQueue.isEmpty) {
                const { cleanedUp, completionValue } = state;

                this.#state = Object.freeze({
                    name: "waitingForCleanupToFinish",
                    cleanedUp,
                    completionValue,
                });
                return cleanedUp.then((completionValue) => {
                    this.#state = Object.freeze({ name: "complete", completionValue });
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
        } else if (state.name === "waitingForEnd") {
            return Promise.resolve(state.endWaiter.promise);
        } else if (state.name === "waitingForCleanupToFinish") {
            const { cleanedUp } = state;

            return cleanedUp.then((completionValue) => {
                if (completionValue.type === "return") {
                    return { done: true, value: completionValue.value };
                }
                throw completionValue.reason;
            });
        } else if (state.name === "complete") {
            const { completionValue } = state;
            if (completionValue.type === "return") {
                return Promise.resolve({ done: true, value: completionValue.value });
            }
            return Promise.reject(completionValue.reason);
        }
        throw new UnreachableError(state);
    }

    return(returnValue: R): Promise<IteratorResult<T, R>> {
        const completionValue = {
            type: "return" as const,
            value: returnValue,
        };
        const state = this.#state;
        if (state.name === "maybeQueued") {
            const cleanedUp = this.#doCleanup(state.cleanupOperation, completionValue);
            this.#state = Object.freeze({
                name: "waitingForCleanupToFinish",
                cleanedUp,
                completionValue,
            });
            return cleanedUp.then((completionValue) => {
                this.#state = Object.freeze({
                    name: "complete",
                    completionValue,
                });
                if (completionValue.type === "return") {
                    return { done: true, value: completionValue.value };
                }
                throw completionValue.reason;
            });
        } else if (state.name === "waitingForValue") {
            const endWaiter = new Deferred<IteratorResult<T, R>>();
            this.#state = {
                name: "waitingForEnd",
                endWaiter,
                waitingQueue: state.waitingQueue,
                cleanupOperation: state.cleanupOperation,
                completionValue: { type: "return", value: returnValue },
            };
            return endWaiter.promise;
        } else if (state.name === "waitingForEnd") {
            const doneTrue = () => ({ done: true as const, value: returnValue });
            const { endWaiter } = state;
            return endWaiter.promise.then(doneTrue, doneTrue);
        } else if (state.name === "endQueued") {
            const { cleanedUp, completionValue } = state;
            this.#state = Object.freeze({
                name: "waitingForCleanupToFinish",
                cleanedUp: state.cleanedUp,
                completionValue,
            });
            return cleanedUp.then((completionValue) => {
                this.#state = Object.freeze({
                    name: "complete",
                    completionValue,
                });
                if (completionValue.type === "return") {
                    return { done: true, value: completionValue.value };
                }
                throw completionValue.reason;
            });
        } else if (state.name === "waitingForCleanupToFinish") {
            const { cleanedUp } = state;
            return cleanedUp.then((completionValue) => {
                this.#state = Object.freeze({
                    name: "complete",
                    completionValue,
                });
                if (completionValue.type === "return") {
                    return { done: true, value: completionValue.value };
                }
                throw completionValue.reason;
            });
        } else if (state.name === "complete") {
            const { completionValue } = state;
            if (completionValue.type === "return") {
                return Promise.resolve({
                    done: true,
                    value: completionValue.value,
                });
            }
            return Promise.reject(completionValue.reason);
        }
        throw new UnreachableError(state);
    }

    [Symbol.asyncIterator](): this {
        return this;
    }
}
