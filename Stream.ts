/// <reference lib="esnext" />

class Deferred<T> {
    private _resolve!: (value: T) => void

    private _reject!: (error: any) => void

    private _promise: Promise<T>

    constructor() {
        this._promise = new Promise((resolve, reject) => {
            this._resolve = resolve
            this._reject = reject
        })
    }

    get promise() {
        return this._promise
    }

    get resolver() {
        return { resolve: this._resolve, reject: this._reject }
    }
}

const doNothing = () => {
    /* Nothing to do in doNothing */
}

interface AbstractQueue<T> {
    isEmpty: boolean
    enqueue: (value: T) => any
    dequeue: () => T
}

export class Queue<T> implements AbstractQueue<T> {
    private _queue: Set<{ value: T} > = new Set()

    get isEmpty() {
        return this._queue.size === 0
    }

    enqueue(value: T) {
        const wrapper = { value }
        this._queue.add(wrapper)
    }

    dequeue() {
        if (this._queue.size === 0) {
            throw new Error(`Can't dequeue from empty queue`)
        }
        const [wrapper] = this._queue
        this._queue.delete(wrapper)
        return wrapper.value
    }
}

type CleanupCallback = () => any

type WaitingQueue<T> = Queue<Deferred<IteratorResult<T>>['resolver']>

type MaybeQueuedState<T> = {
    name: 'maybeQueued',
    waitingQueue: WaitingQueue<T>,
    itemQueue: AbstractQueue<T>,
    cleanupOperation: CleanupCallback,
}

type EndQueuedState<T> = {
    name: 'endQueued',
    itemQueue: AbstractQueue<T>,
    cleanedUp: Promise<void>,
    completionValue: { type: 'return' | 'throw', value: any },
}

type WaitingForValueState<T> = {
    name: 'waitingForValue',
    waitingQueue: WaitingQueue<T>,
    itemQueue: AbstractQueue<T>,
    cleanupOperation: CleanupCallback,
}

type WaitingForEndState<T> = {
    name: 'waitingForEnd',
    waitingQueue: WaitingQueue<T>,
    endWaiter: Deferred<IteratorResult<T>>,
    cleanupOperation: CleanupCallback,
}

type WaitingForCleanupToFinish = {
    name: 'waitingForCleanupToFinish',
    cleanedUp: Promise<void>,
}

type CompleteState = {
    name: 'complete'
}

type StreamState<T>
    = MaybeQueuedState<T>
    | EndQueuedState<T>
    | WaitingForValueState<T>
    | WaitingForEndState<T>
    | WaitingForCleanupToFinish
    | CompleteState

type StreamController<T> = {
    [Symbol.toStringTag]: string,
    yield: (value: T) => void,
    next: (value: T) => void,
    throw: (error?: any) => void,
    error: (error?: any) => void,
    return: (endValue?: any) => void,
    complete: (endValue?: any) => void,
}

class UnreachableError extends Error {
    constructor(never: never) {
        super(`This can't happen`)
    }
}

type StreamInitializer<T> = (controller: StreamController<T>) => CleanupCallback | void

type StreamOptions<T> = {
    queue?: AbstractQueue<T>,
}

export default class Stream<T> {
    private _state: Readonly<StreamState<T>>

    constructor(initializer: StreamInitializer<T>, options: StreamOptions<T>={}) {
        const { queue=new Queue<T>() } = options

        if (typeof initializer !== 'function') {
            throw new TypeError("Initializer must be a function")
        }

        const _yield = this._createYield()
        const _throw = this._createCompletionMethod('throw')
        const _return = this._createCompletionMethod('return')

        let cleanupAfterInitialization = false
        let cleanupComplete: Deferred<void>

        const waitingQueue: WaitingQueue<T> = new Queue()

        this._state = Object.freeze({
            name: 'maybeQueued',
            itemQueue: queue,
            waitingQueue,
            cleanupOperation: () => {
                cleanupAfterInitialization = true
                cleanupComplete = new Deferred()
                return cleanupComplete.promise
            },
        })

        const realCleanup = initializer({
            [Symbol.toStringTag]: 'StreamController',
            yield: _yield,
            throw: _throw,
            return: _return,
            next: _yield,
            error: _throw,
            complete: _return,
        })

        const cleanupOperation = typeof realCleanup === 'function'
            ? realCleanup
            : doNothing

        if (cleanupAfterInitialization) {
            this._doCleanup(cleanupOperation, cleanupComplete!)
        } else {
            const state = this._state as EndQueuedState<T> | MaybeQueuedState<T>
            if (state.name === 'endQueued') {
                this._state = Object.freeze({
                    ...state,
                    cleanupOperation,
                })
                return
            }
            this._state = Object.freeze({
                ...state,
                cleanupOperation,
            })
        }
    }

    _createYield() {
        const _yield = (value: T) => {
            const state = this._state
            if (state.name === 'maybeQueued') {
                state.itemQueue.enqueue(value)
                return
            } else if (state.name === 'waitingForValue') {
                const waitingQueue = state.waitingQueue
                const resolver = waitingQueue.dequeue()
                if (waitingQueue.isEmpty) {
                    this._state = Object.freeze({
                        name: 'maybeQueued',
                        waitingQueue: state.waitingQueue,
                        itemQueue: state.itemQueue,
                        cleanupOperation: state.cleanupOperation,
                    })
                }
                resolver.resolve({
                    done: false,
                    value,
                })
            } else if (state.name === 'waitingForEnd') {
                const waitingQueue = state.waitingQueue
                const resolver = waitingQueue.dequeue()
                resolver.resolve({
                    done: false,
                    value,
                })

                if (waitingQueue.isEmpty) {
                    const endWaiter = state.endWaiter
                    const cleanedUp = this._doCleanup(state.cleanupOperation)

                    this._state = Object.freeze({
                        name: 'waitingForCleanupToFinish',
                        cleanedUp,
                    })

                    cleanedUp.then(() => {
                        this._state = Object.freeze({ name: 'complete' })
                        // HACK: Stupid coercion because IteratorResult<T>
                        // is broken in TypeScript
                        endWaiter.resolver.resolve({ done: true, value: undefined as unknown as T })
                    }, error => {
                        this._state = Object.freeze({ name: 'complete' })
                        endWaiter.resolver.reject(error)
                    })
                }
            } else if (state.name === 'complete'
            || state.name === 'endQueued'
            || state.name === 'waitingForCleanupToFinish') {
                // Maybe warn in these states
            }
        }
        return _yield
    }

    _createCompletionMethod(type: 'return' | 'throw') {
        const _method = (value: any) => {
            const state = this._state
            if (state.name === 'maybeQueued') {
                this._state = Object.freeze({
                    name: 'endQueued',
                    itemQueue: state.itemQueue,
                    completionValue: { type, value },
                    cleanedUp: this._doCleanup(state.cleanupOperation)
                })
            } else if (state.name === 'waitingForValue'
            || state.name === 'waitingForEnd') {
                const waitingQueue = state.waitingQueue
                const cleanedUp = this._doCleanup(state.cleanupOperation)

                const resolver = waitingQueue.dequeue()

                cleanedUp.then(_ => {
                    if (type === 'throw') {
                        resolver.reject(value)
                    } else {
                        resolver.resolve({
                            done: true,
                            value,
                        })
                    }
                }, cleanupError => {
                    resolver.reject(cleanupError)
                })

                while (!waitingQueue.isEmpty) {
                    const extraConsumer = waitingQueue.dequeue()
                    const resolveConsumer = () => {
                        extraConsumer.resolve({
                            done: true,
                            // HACK: Stupid coercion because IteratorResult<T>
                            // is broken in TypeScript
                            value: undefined as unknown as T,
                        })
                    }
                    cleanedUp.then(resolveConsumer, resolveConsumer)
                }

                if (state.name === 'waitingForEnd') {
                    const endWaiter = state.endWaiter
                    const resolveEnd = () => endWaiter.resolver
                        // HACK: Stupid coercion because IteratorResult<T>
                        // is broken in TypeScript
                        .resolve({ done: true, value: undefined as unknown as T })
                    cleanedUp.then(resolveEnd, resolveEnd)
                }

                this._state = Object.freeze({
                    name: 'waitingForCleanupToFinish',
                    cleanedUp,
                })
            } else if (state.name === 'complete'
            || state.name === 'waitingForCleanupToFinish'
            || state.name === 'endQueued') {
                // Maybe warn
            }
        }

        return _method
    }

    async _doCleanup(cleanupOperation: CleanupCallback, deferred: Deferred<void>=new Deferred()) {
        try {
            await cleanupOperation()
            deferred.resolver.resolve(undefined)
        } catch (err) {
            deferred.resolver.reject(err)
        }
        return deferred.promise
    }

    next(): Promise<IteratorResult<T>> {
        const state = this._state
        if (state.name === 'maybeQueued' && !state.itemQueue.isEmpty) {
            const value = state.itemQueue.dequeue()
            return Promise.resolve({
                done: false,
                value,
            })
        } else if (state.name === 'waitingForValue' || state.name === 'maybeQueued') {
            const futureValue = new Deferred<IteratorResult<T>>()
            state.waitingQueue.enqueue(futureValue.resolver)
            this._state = Object.freeze({
                ...state,
                name: 'waitingForValue',
            })
            return futureValue.promise
        } else if (state.name === 'endQueued') {
            if (state.itemQueue.isEmpty) {
                const completion = state.completionValue
                const cleanedUp = state.cleanedUp

                this._state = Object.freeze({
                    name: 'waitingForCleanupToFinish',
                    cleanedUp,
                })
                return cleanedUp.then(_ => {
                    this._state = Object.seal({ name: 'complete' })
                    if (completion.type === 'return') {
                        return { done: true, value: completion.value }
                    } else {
                        throw completion.value
                    }
                }, cleanupError => {
                    this._state = Object.seal({ name: 'complete' })
                    throw cleanupError
                })
            } else {
                const value = state.itemQueue.dequeue()
                return Promise.resolve({
                    done: false,
                    value,
                })
            }
        } else if (state.name === 'waitingForEnd') {
            return state.endWaiter.promise.then(() => {
                // HACK: Stupid coercion because IteratorResult<T>
                // is broken in TypeScript
                return { done: true, value: undefined as unknown as T }
            })
        } else if (state.name === 'waitingForCleanupToFinish') {
            function doneTrue() {
                return {
                    done: true,
                    // HACK: Stupid coercion because IteratorResult<T>
                    // is broken in TypeScript
                    value: undefined as unknown as T,
                }
            }
            return state.cleanedUp.then(doneTrue, doneTrue)
        } else if (state.name === 'complete') {
            // HACK: Stupid coercion because IteratorResult<T>
            // is broken in TypeScript
            return Promise.resolve({ done: true, value: undefined as unknown as T })
        } else {
            throw new UnreachableError(state)
        }
    }

    return(returnValue?: any): Promise<IteratorResult<T>> {
        const state = this._state
        if (state.name === 'maybeQueued') {
            const cleanedUp = this._doCleanup(state.cleanupOperation)
            this._state = Object.freeze({
                name: 'waitingForCleanupToFinish',
                cleanedUp,
            })
            return cleanedUp.then(_ => {
                this._state = Object.freeze({ name: 'complete' })
                return { done: true, value: returnValue as T }
            }, cleanupError => {
                this._state = Object.freeze({ name: 'complete' })
                throw cleanupError
            })
        } else if (state.name === 'waitingForValue') {
            const endWaiter = new Deferred<IteratorResult<T>>()
            this._state = {
                name: 'waitingForEnd',
                endWaiter,
                waitingQueue: state.waitingQueue,
                cleanupOperation: state.cleanupOperation,
            }
            return endWaiter.promise
        } else if (state.name === 'waitingForEnd') {
            const doneTrue = () => ({ done: true, value: returnValue })
            const endWaiter = state.endWaiter
            return endWaiter.promise.then(doneTrue, doneTrue)
        } else if (state.name === 'endQueued') {
            const completion = state.completionValue
            const cleanedUp = state.cleanedUp
            this._state = Object.freeze({
                name: 'waitingForCleanupToFinish',
                cleanedUp: state.cleanedUp,
            })
            return cleanedUp.then(_ => {
                this._state = Object.freeze({ name: 'complete' })
                if (completion.type === 'return') {
                    return { done: true, value: completion.value }
                } else {
                    throw completion.value
                }
            }, cleanupError => {
                this._state = Object.freeze({ name: 'complete' })
                throw cleanupError
            })
        } else if (state.name === 'waitingForCleanupToFinish') {
            const doneTrue = () => ({ done: true, value: returnValue })
            return state.cleanedUp.then(doneTrue, doneTrue)
        } else if (state.name === 'complete') {
            return Promise.resolve({ done: true, value: returnValue })
        } else {
            throw new UnreachableError(state)
        }
    }

    [Symbol.asyncIterator]() {
        return this
    }
}
