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
    waitingQueue: WaitingQueue<T, R>,
    cleanedUp: Promise<any>,
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

type WaitingForCleanupToFinish<T, R> = {
    name: "waitingForCleanupToFinish",
    waitingQueue: WaitingQueue<T, R>,
    completionValue: CompletionValue<R>,
};

type CompleteState<R> = {
    name: "complete",
    completionValue: CompletionValue<R>,
};

type AbortedState = {
    name: "aborted",
};

type StreamState<T, R>
    = MaybeQueuedState<T, R>
    | EndQueuedState<T, R>
    | WaitingForValueState<T, R>
    | WaitingForEndState<T, R>
    | WaitingForCleanupToFinish<T, R>
    | CompleteState<R>
    | AbortedState;

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
    abortSignal?: AbortSignal,
};

function assert(condition: boolean): asserts condition {
    if (!condition) {
        throw new Error("assertion failed");
    }
}

export class AbortError extends Error {
    name = "AbortError";
}

async function promiseTry<R>(f: () => R | Promise<R>): Promise<R> {
    return await f();
}

export default class Stream<T, R=void>
implements AsyncIterator<T, R>, AsyncIterable<T> {
    static abortable<T, R=void>(
        abortSignal: AbortSignal,
        initializer: StreamInitializer<T, R>,
        options: StreamOptions<T>={},
    ): Stream<T, R> {
        return new Stream(initializer, {
            ...options,
            abortSignal,
        });
    }

    #state: Readonly<StreamState<T, R>>;

    constructor(initializer: StreamInitializer<T, R>, {
        queue=new Queue(),
        abortSignal,
    }: StreamOptions<T>={}) {
        if (typeof initializer !== "function") {
            throw new TypeError("Initializer must be a function");
        }

        const yieldValue = this.#yieldValue;
        const throwValue = this.#throwValue;
        const returnValue = this.#returnValue;

        let cleanupComplete: undefined | Deferred<CompletionValue<R>>;

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

        if (abortSignal?.aborted) {
            this.#state = Object.freeze({ name: "aborted" });
            this.#abort();
            return;
        }

        abortSignal?.addEventListener("abort", this.#abort);

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

        const state = this.#state;
        if (cleanupComplete) {
            assert(state.name === "endQueued");
            const cleanedUp = promiseTry(cleanupOperation);
            this.#state = Object.freeze({
                name: "endQueued",
                itemQueue: state.itemQueue,
                cleanedUp,
                completionValue: state.completionValue,
                waitingQueue: state.waitingQueue,
            });
        } else {
            assert(state.name === "maybeQueued");
            this.#state = Object.freeze({
                ...state,
                cleanupOperation,
            });
        }
    }

    #yieldValue = (value: T): void => {
        const state = this.#state;
        if (state.name === "maybeQueued") {
            assert(state.waitingQueue.isEmpty);
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
            const { waitingQueue, completionValue, cleanupOperation } = state;
            const resolver = waitingQueue.dequeue();
            resolver.resolve({
                done: false,
                value,
            });
            if (waitingQueue.isEmpty) {
                const cleanedUp = promiseTry(cleanupOperation);
                waitingQueue.enqueue(state.endWaiter.resolver);
                void this.#finalizeCleanup(
                    cleanedUp,
                    waitingQueue,
                    completionValue,
                );
            }
        } else if (state.name === "aborted"
        || state.name === "endQueued"
        || state.name === "complete"
        || state.name === "waitingForCleanupToFinish") {
            // FUTURE: Add warning hook
        } else {
            throw new UnreachableError(state);
        }
    };

    #completeValue = (completionValue: CompletionValue<R>): void => {
        const state = this.#state;
        if (state.name === "maybeQueued") {
            const { itemQueue, cleanupOperation } = state;
            this.#state = Object.freeze({
                name: "endQueued",
                itemQueue,
                completionValue,
                cleanedUp: promiseTry(cleanupOperation),
                waitingQueue: state.waitingQueue,
            });
        } else if (state.name === "waitingForValue"
        || state.name === "waitingForEnd") {
            const { cleanupOperation, waitingQueue } = state;
            const cleanedUp = promiseTry(cleanupOperation);
            if (state.name === "waitingForEnd") {
                waitingQueue.enqueue(state.endWaiter.resolver);
            }
            void this.#finalizeCleanup(
                cleanedUp,
                waitingQueue,
                completionValue,
            );
        } else if (state.name === "aborted"
        || state.name === "complete"
        || state.name === "endQueued"
        || state.name === "waitingForCleanupToFinish") {
            // FUTURE: Add warning hook
        } else {
            throw new UnreachableError(state);
        }
    };

    #returnValue = (value: R): void => {
        const completionValue = { type: "return" as const, value };
        this.#completeValue(completionValue);
    };

    #throwValue = (reason: any | any): void => {
        const completionValue = { type: "error" as const, reason };
        this.#completeValue(completionValue);
    };

    #abort = (): void => {
        const state = this.#state;
        this.#state = Object.freeze({ name: "aborted" });
        if (state.name === "waitingForValue"
        || state.name === "waitingForEnd"
        || state.name === "waitingForCleanupToFinish") {
            const { waitingQueue } = state;
            while (!waitingQueue.isEmpty) {
                const resolver = waitingQueue.dequeue();
                resolver.reject(new AbortError("Stream has been aborted"));
            }
            if (state.name === "waitingForEnd") {
                state.endWaiter.resolver.reject(new AbortError("Stream has been aborted"));
            }
        }

        if (state.name === "maybeQueued"
        || state.name === "waitingForValue"
        || state.name === "waitingForEnd"
        ) {
            const cleanedUp = promiseTry(state.cleanupOperation);
            void this.#finalizeCleanup(
                cleanedUp,
                state.waitingQueue,
                {
                    type: "error",
                    reason: new AbortError("Stream has been aborted"),
                },
            );
        }
    };

    #finalizeCleanup = async (
        cleanedUp: Promise<any>,
        waitingQueue: WaitingQueue<T, R>,
        completionValue: CompletionValue<R>,
    ): Promise<void> => {
        if (this.#state.name !== "aborted") {
            this.#state = Object.freeze({
                name: "waitingForCleanupToFinish",
                waitingQueue,
                completionValue,
            });
        }
        try {
            await cleanedUp;
        } catch (error: any) {
            if (completionValue.type === "return") {
                completionValue = { type: "error", reason: error };
            } else {
                completionValue = {
                    type: "error",
                    reason: new AggregateError([completionValue.reason, error]),
                };
            }
        }
        while (!waitingQueue.isEmpty) {
            const resolver = waitingQueue.dequeue();
            if (completionValue.type === "return") {
                resolver.resolve({
                    done: true,
                    value: completionValue.value,
                });
            } else {
                resolver.reject(completionValue.reason);
            }
        }
        if (this.#state.name === "waitingForCleanupToFinish") {
            this.#state = Object.freeze({
                name: "complete",
                completionValue,
            });
        }
    };

    next(): Promise<IteratorResult<T, R>> {
        const state = this.#state;
        if (state.name === "aborted") {
            return Promise.reject(new AbortError("Stream has been aborted"));
        } else if (state.name === "maybeQueued" && !state.itemQueue.isEmpty) {
            const value = state.itemQueue.dequeue();
            return Promise.resolve({ done: false, value });
        } else if (state.name === "waitingForValue"
        || state.name === "maybeQueued") {
            const futureValue = new Deferred<IteratorResult<T, R>>();
            state.waitingQueue.enqueue(futureValue.resolver);
            this.#state = Object.freeze({
                ...state,
                name: "waitingForValue",
            });
            return futureValue.promise;
        } else if (state.name === "endQueued") {
            const {
                cleanedUp,
                completionValue,
                waitingQueue,
                itemQueue,
            } = state;
            if (!itemQueue.isEmpty) {
                const value = itemQueue.dequeue();
                return Promise.resolve({
                    done: false,
                    value,
                });
            }
            const deferred = new Deferred<IteratorResult<T, R>>();
            waitingQueue.enqueue(deferred.resolver);

            void this.#finalizeCleanup(
                cleanedUp,
                state.waitingQueue,
                completionValue,
            );
            return deferred.promise;
        } else if (state.name === "waitingForEnd") {
            return state.endWaiter.promise;
        } else if (state.name === "waitingForCleanupToFinish") {
            const deferred = new Deferred<IteratorResult<T, R>>();
            state.waitingQueue.enqueue(deferred.resolver);
            return deferred.promise;
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

    return(returnValue: R): Promise<IteratorResult<T, R>> {
        const completionValue = {
            type: "return" as const,
            value: returnValue,
        };
        const state = this.#state;
        if (state.name === "aborted") {
            return Promise.reject(new AbortError("Stream has been aborted"));
        } else if (state.name === "maybeQueued") {
            const { cleanupOperation, waitingQueue } = state;
            const cleanedUp = promiseTry(cleanupOperation);
            const futureValue = new Deferred<IteratorResult<T, R>>();
            waitingQueue.enqueue(futureValue.resolver);
            void this.#finalizeCleanup(
                cleanedUp,
                waitingQueue,
                completionValue,
            );
            return futureValue.promise;
        } else if (state.name === "waitingForValue") {
            const { waitingQueue, cleanupOperation } = state;
            const endWaiter = new Deferred<IteratorResult<T, R>>();
            this.#state = Object.freeze({
                name: "waitingForEnd",
                endWaiter,
                waitingQueue,
                cleanupOperation,
                completionValue,
            });
            return endWaiter.promise;
        } else if (state.name === "waitingForEnd") {
            return state.endWaiter.promise;
        } else if (state.name === "endQueued") {
            const { cleanedUp, completionValue, waitingQueue } = state;
            const futureValue = new Deferred<IteratorResult<T, R>>();
            waitingQueue.enqueue(futureValue.resolver);
            void this.#finalizeCleanup(
                cleanedUp,
                waitingQueue,
                completionValue,
            );
            return futureValue.promise;
        } else if (state.name === "waitingForCleanupToFinish") {
            const futureValue = new Deferred<IteratorResult<T, R>>();
            state.waitingQueue.enqueue(futureValue.resolver);
            return futureValue.promise;
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
