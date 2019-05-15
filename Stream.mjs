// @ts-check
/// <reference lib="esnext" />

export class CancelError extends Error {}

const cancelSignalNever = {
    signaled: false,
    /**
     * @param {() => void} _handler
     */
    subscribe(_handler) {
        return {
            unsubscribe() {
                /* this never signals so nothing to do */
            }
        }
    }
}

// Deferred creates a Promise and stores the resolve/reject on the same object

/**
 * @template T
 */
class Deferred {
    /**
     * @type {(value: T) => void}
     */
    _resolve;

    /**
     * @type {(error: any) => void}
     */
    _reject;

    /**
     * @type {Promise<T>}
     */
    _promise;

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

/**
 * @template T
 * @typedef {object} AbstractQueue
 * @property {boolean} isEmpty
 * @property {(value: T) => any} enqueue
 * @property {() => T} dequeue
 */

/**
 * @template T
 */
export class Queue {
    constructor() {
        /**
         * @type {Set<{ value: T}>}
         */
        this._queue = new Set()
    }

    get isEmpty() {
        return this._queue.size === 0
    }

    /**
     * @param {T} value
     */
    enqueue(value) {
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

/**
 * @typedef {object} CompleteState
 * @property {'complete'} name
 */

/**
 * @template T
 * @typedef {object} WaitingForValueState
 * @property {'waitingForValue'} name
 * @property {Queue<Deferred<{ done: false, value: T } | { done: true, value: any }>['resolver']>} waitingQueue
 * @property {AbstractQueue<T>} itemQueue
 * @property {() => void | Promise<void>} cleanupOperation
 */

/**
 * @template T
 * @typedef {object} WaitingForEndState
 * @property {'waitingForEnd'} name
 * @property {Queue<Deferred<{ done: false, value: T } | { done: true, value: any }>['resolver']>} waitingQueue
 * @property {Deferred<{ done: boolean, value: T}>} endWaiter
 * @property {() => void | Promise<void>} cleanupOperation
 */

/**
  * @template T
  * @typedef {object} MaybeQueuedState
  * @property {'maybeQueued'} name
  * @property {Queue<Deferred<{ done: false, value: T } | { done: true, value: any }>['resolver']>} waitingQueue
  * @property {AbstractQueue<T>} itemQueue
  * @property {() => void | Promise<void>} cleanupOperation
  */

/**
 * @template T
 * @typedef {object} EndQueuedState
 * @property {'endQueued'} name
 * @property {AbstractQueue<T>} itemQueue
 * @property { { type: 'return' | 'throw', value: any } } completionValue
 * @property {Promise<void>} cleanedUp
 */

/**
 * @typedef {object} WaitingForCleanupToFinish
 * @property {'waitingForCleanupToFinish'} name
 * @property {Promise<void>} cleanedUp
 */

/**
 * @template T
 * @typedef {CompleteState | WaitingForValueState<T> | WaitingForEndState<T> | MaybeQueuedState<T> | EndQueuedState<T> | WaitingForCleanupToFinish} StreamState
 */

/**
 * @template T
 * @typedef {object} StreamController
 * @property {(value: T) => void} yield
 * @property {(value: T) => void} next
 * @property {(error: any) => void} throw
 * @property {(error: any) => void} error
 * @property {(endValue: any) => void} return
 * @property {(endValue: any) => void} complete
 */

class UnreachableError extends Error {
    /**
     * @param {never} never
     */
    constructor(never) {
        super(`This can't happen`)
    }
}

/**
 * @template T
 */
export default class Stream {
    /**
     * @type {boolean}
     */
    _canceled = false;

    /**
     * @type {Readonly<StreamState<T>>}
     */
    _state;

    /**
     * @param {(controller: StreamController<T>) => () => (void | Promise<void>)} initializer
     * @param {object} [options]
     * @param {AbstractQueue<T>} [options.queue]
     */
    constructor(initializer, { queue=new Queue() }={}) {
        if (typeof initializer !== 'function') {
            throw new TypeError("Initializer must be a function")
        }

        const _yield = this._createYield()
        const _throw = this._createCompletionMethod('throw')
        const _return = this._createCompletionMethod('return')

        let cleanupAfterInitialization = false
        /**
         * @type {Deferred<void>}
         */
        let cleanupComplete

        this._state = Object.freeze({
            name: 'maybeQueued',
            itemQueue: queue,
            waitingQueue: new Queue(),
            cleanupOperation: () => {
                cleanupAfterInitialization = true
                cleanupComplete = new Deferred()
                return cleanupComplete.promise
            },
        })

        const realCleanup = initializer(Object.freeze({
            [Symbol.toStringTag]: 'StreamController',
            yield: _yield,
            throw: _throw,
            return: _return,
            next: _yield,
            error: _throw,
            complete: _return,
        }))

        const cleanupOperation = typeof realCleanup === 'function'
            ? realCleanup
            : doNothing

        if (cleanupAfterInitialization) {
            this._doCleanup(cleanupOperation, cleanupComplete)
        } else {
            
            const state = /** @type {StreamState<T>} */(this._state)
            if (state.name === 'waitingForCleanupToFinish'
            || state.name === 'complete'
            || state.name === 'waitingForValue'
            || state.name === 'waitingForEnd') {
                throw new Error("Shouldn't happen")
            }
            if (state.name === 'endQueued') {
                this._state = Object.freeze({
                    ...state,
                    cleanupOperation,
                })
                return;
            }
            this._state = Object.freeze({
                ...state,
                cleanupOperation,
            })
        }
    }

    _createYield() {
        /**
         * @param {T} value
         */
        const _yield = value => {
            const state = this._state
            if (state.name === 'maybeQueued') {
                state.itemQueue.enqueue(value)
                return;
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
                        endWaiter.resolver.resolve({ done: true, value: undefined })
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

    /**
     * @param {'return' | 'throw'} type
     */
    _createCompletionMethod(type) {
        /**
         * @param {any} value
         */
        const _method = value => {
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
                            value: undefined,
                        })
                    }
                    cleanedUp.then(resolveConsumer, resolveConsumer)
                }

                if (state.name === 'waitingForEnd') {
                    const endWaiter = state.endWaiter
                    const resolveEnd = () => endWaiter.resolver
                        .resolve({ done: true, value: undefined })
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

    async _doCleanup(cleanupOperation, deferred=new Deferred()) {
        try {
            await cleanupOperation()
            deferred.resolver.resolve(undefined)
        } catch (err) {
            deferred.resolver.reject(err)
        }
        return deferred.promise
    }

    /**
     * @returns {Promise<{ done: true, value: any } | { done: false, value: T }>}
     */
    next() {
        const state = this._state
        if (state.name === 'maybeQueued' && !state.itemQueue.isEmpty) {
            const value = state.itemQueue.dequeue()
            return Promise.resolve({
                done: false,
                value,
            })
        } else if (state.name === 'waitingForValue' || state.name === 'maybeQueued') {
            /** @type {Deferred<{ done: true, value: any } | { done: false, value: T }>} */
            const futureValue = new Deferred()
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
                return { done: true, value: undefined }
            })
        } else if (state.name === 'waitingForCleanupToFinish') {
            function doneTrue() {
                return {
                    done: /** @type {true} */(true),
                    value: undefined,
                }
            }
            return state.cleanedUp.then(doneTrue, doneTrue)
        } else if (state.name === 'complete') {
            return Promise.resolve({ done: true, value: undefined })
        } else {
            throw new UnreachableError(state)
        }
    }

    /**
     * @param {any} returnValue
     * @returns { Promise<{ done: true, value: any } | { done: false, value: T  }> }
     */
    return(returnValue=undefined) {
        const state = this._state
        if (state.name === 'maybeQueued') {
            const cleanedUp = this._doCleanup(state.cleanupOperation)
            this._state = Object.freeze({
                name: 'waitingForCleanupToFinish',
                cleanedUp,
            })
            return cleanedUp.then(_ => {
                this._state = Object.freeze({ name: 'complete' })
                return { done: true, value: returnValue }
            }, cleanupError => {
                this._state = Object.freeze({ name: 'complete' })
                throw cleanupError
            })
        } else if (state.name === 'waitingForValue') {
            const endWaiter = new Deferred()
            this._state = {
                name: 'waitingForEnd',
                endWaiter,
                waitingQueue: state.waitingQueue,
                cleanupOperation: state.cleanupOperation,
            }
            return endWaiter.promise
        } else if (state.name === 'waitingForEnd') {
            const doneTrue = () => ({ done: /** @type {true} */(true), value: returnValue })
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
            const doneTrue = () => ({ done: /** @type {true} */(true), value: returnValue })
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
