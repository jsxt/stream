
export class CancelError extends Error {}

Symbol.cancelSignal = Symbol.cancelSignal || Symbol.for('https://github.com/tc39/proposal-cancellation/issues/22')

const cancelSignalNever = {
    [Symbol.cancelSignal]() {
        return {
            signaled: false,

            subscribe() {
                return {
                    unsubscribe() {
                        /* this signal can never be cancelled so nothing to do */
                    },
                }
            },
        }
    },
}

// Deferred creates a Promise and stores the resolve/reject on the same object
function deferred() {
    let resolve
    let reject
    const promise = new Promise((_resolve, _reject) => {
        resolve = _resolve
        reject = _reject
    })
    return Object.freeze({
        resolve,
        reject,
        promise,
    })
}

const doNothing = () => {
    /* Nothing to do in doNothing */
}

export default class Stream {
    constructor(initializer, { queue=Infinity, cancelSignal: cancelable=cancelSignalNever }={}) {
        const cancelSignal = cancelable[Symbol.cancelSignal]()

        const maxSize = queue
        if (typeof queue !== 'number') {
            throw new Error(`Only queue size is currently supported`)
        }
        if (typeof initializer !== 'function') {
            throw new Error(`Expected a function as first argument to Stream`)
        }
        if (typeof maxSize !== 'number' || maxSize < 0) {
            throw new Error(`queue must be a positive or 0 number`)
        }

        this._cancelled = false
        if (cancelSignal.signaled) {
            this._state = Object.freeze({ name: 'complete' })
            this._cancelled = true
            return
        } else {
            cancelSignal.subscribe(_ => {
                this._cancelled = true
                if (this._state.name === 'empty'
                || this._state.name === 'queued') {
                    const cleanedUp = this._doCleanup(this._state.cleanupOperation)
                    this._state = Object.freeze({
                        name: 'cleanupPending',
                        cleanedUp,
                    })
                    return cleanedUp.then(_ => {
                        this._state = Object.freeze({
                            name: 'complete',
                        })
                        return undefined
                    }, cleanupError => {
                        this._state = Object.freeze({
                            name: 'complete',
                        })
                        throw cleanupError
                    })
                } else if (this._state.name === 'endQueued') {
                    const cleanedUp = this._state.cleanedUp
                    this._state = Object.freeze({
                        name: 'cleanupPending',
                        cleanedUp,
                    })
                    return cleanedUp.then(_ => undefined)
                } else if (this._state.name === 'waiting'
                || this._state.name === 'endWaiting') {
                    const cleanedUp = this._doCleanup(this._state.cleanupOperation)
                    const waitingQueue = this._state.waitingQueue
                    for (const waiter of waitingQueue) {
                        waiter.reject(
                            new CancelError('Stream has been cancelled so request cannot be fulfilled'),
                        )
                    }
                    if (this._state.name === 'endWaiting') {
                        this._state.endWaiter.reject(
                            new CancelError('Stream has been cancelled so request cannot be fulfilled'),
                        )
                    }
                    this._state = Object.freeze({
                        name: 'cleanupPending',
                        cleanedUp,
                    })
                    cleanedUp.finally(_ => {
                        this._state = Object.freeze({ name: 'complete' })
                    })
                    return cleanedUp.then(_ => undefined)
                } else if (this._state.name === 'cleanupPending') {
                    return this._state.cleanedUp.then(_ => undefined)
                } else if (this._state.name === 'complete') {
                    return Promise.resolve()
                } else {
                    throw new Error('Impossible state, please file a bug report')
                }
            })
        }

        const _yield = value => {
            if (this._state.name === 'empty'
            || this._state.name === 'queued') {
                // If we're currently empty or queueing then we'll just append
                // to our queue
                const itemQueue = this._state.itemQueue
                itemQueue.push(value)
                // And pop off any excess elements in the queue
                if (itemQueue.length > maxSize) {
                    itemQueue.shift()
                }
                // Only if any items are actually in the queue should
                // we change to the queued state
                if (itemQueue.length > 0) {
                    this._state = {
                        ...this._state,
                        name: 'queued',
                    }
                }
            } else if (this._state.name === 'waiting') {
                // If any consumers are waiting then we can simply
                // resume the first one
                const waitingQueue = this._state.waitingQueue
                const consumer = waitingQueue.shift()
                if (waitingQueue.length === 0) {
                    this._state = {
                        ...this._state,
                        name: 'empty',
                    }
                }
                consumer.resolve({
                    done: false,
                    value,
                })
            } else if (this._state.name === 'endWaiting') {
                const waitingQueue = this._state.waitingQueue
                const consumer = waitingQueue.shift()

                consumer.resolve({
                    done: false,
                    value,
                })

                if (waitingQueue.length === 0) {
                    const endWaiter = this._state.endWaiter
                    const cleanedUp
                        = this._doCleanup(this._state.cleanupOperation)
                    this._state = {
                        name: 'cleanupPending',
                        cleanedUp,
                    }
                    cleanedUp.then(_ => {
                        this._state = { name: 'complete' }
                        endWaiter.resolve({
                            done: true,
                            value: undefined,
                        })
                    }, error => {
                        this._state = { name: 'complete' }
                        endWaiter.reject(error)
                    })
                }
            } else {
                /* Nothing to do all other states */
            }
        }

        const completionMethod = type => value => {
            if (this._state.name === 'empty') {
                const cleanupOperation = this._state.cleanupOperation
                this._state = Object.seal({
                    name: 'endNext',
                    completionValue: { type, value },
                    cleanedUp: this._doCleanup(cleanupOperation),
                })
            } else if (this._state.name === 'queued') {
                this._state = Object.seal({
                    name: 'endQueued',
                    itemQueue: this._state.itemQueue,
                    completionValue: { type, value },
                    cleanedUp: this._doCleanup(this._state.cleanupOperation),
                })
            } else if (this._state.name === 'waiting'
            || this._state.name === 'endWaiting') {
                const waitingQueue = this._state.waitingQueue
                const consumer = waitingQueue.shift()
                const cleanedUp = this._doCleanup(this._state.cleanupOperation)

                cleanedUp.then(_ => {
                    this._state = Object.seal({ name: 'complete' })
                    if (type === 'throw') {
                        consumer.reject(value)
                    } else {
                        consumer.resolve({ done: true, value })
                    }
                })

                while (waitingQueue.length) {
                    const extraConsumer = waitingQueue.shift()
                    const resolveConsumer = () => {
                        extraConsumer.resolve({
                            done: true,
                            value: undefined,
                        })
                    }
                    cleanedUp.then(resolveConsumer, resolveConsumer)
                }

                if (this._state.name === 'endWaiting') {
                    const endWaiter = this._state.endWaiter
                    const resolveEnd = () => endWaiter.resolve({ done: true, value: undefined })
                    cleanedUp.then(resolveEnd, resolveEnd)
                }
                this._state = Object.seal({
                    name: 'cleanupPending',
                    cleanedUp,
                })
            }
        }

        const _throw = completionMethod('throw')
        const _return = completionMethod('return')

        let cleanupAfterInitialization = false
        let cleanupComplete
        this._state = Object.seal({
            name: 'empty',
            itemQueue: [],
            waitingQueue: [],
            cleanupOperation: () => {
                cleanupAfterInitialization = true
                cleanupComplete = deferred()
                return cleanupComplete.promise
            },
        })

        const realCleanup = initializer(Object.freeze({
            [Symbol.toStringTag]: 'StreamController',
            cancelSignal: cancelable,
            yield: _yield,
            throw: _throw,
            return: _return,
            next: _yield,
            error: _throw,
            complete: _return,
        }))

        const cleanupOperation = typeof realCleanup === 'function' ? realCleanup : doNothing

        if (cleanupAfterInitialization) {
            this._doCleanup(cleanupOperation, cleanupComplete)
        } else {
            this._state.cleanupOperation = cleanupOperation
        }
    }

    get cancelled() {
        return this._cancelled
    }

    async _doCleanup(cleanupOperation, _deferred=deferred()) {
        try {
            await cleanupOperation()
            _deferred.resolve(undefined)
        } catch (err) {
            _deferred.reject(err)
        }
        return _deferred.promise
    }

    next() {
        if (this._cancelled) {
            return Promise.reject(
                new CancelError('Stream has been cancelled and can no longer be used'),
            )
        } else if (this._state.name === 'waiting' || this._state.name === 'empty') {
            const futureValue = deferred()
            this._state.waitingQueue.push(futureValue)
            this._state = Object.seal({
                ...this._state,
                name: 'waiting',
            })
            return futureValue.promise
        } else if (this._state.name === 'queued') {
            const value = this._state.itemQueue.shift()
            if (this._state.itemQueue.length === 0) {
                this._state = Object.seal({
                    ...this._state,
                    name: 'empty',
                })
            }
            return Promise.resolve({
                done: false,
                value,
            })
        } else if (this._state.name === 'endQueued') {
            const value = this._state.itemQueue.shift()
            if (this._state.itemQueue.length === 0) {
                this._state = Object.seal({
                    name: 'endNext',
                    completionValue: this._state.completionValue,
                    cleanedUp: this._state.cleanedUp,
                })
            }
            return Promise.resolve({
                done: false,
                value,
            })
        } else if (this._state.name === 'endNext') {
            const completion = this._state.completionValue
            const cleanedUp = this._state.cleanedUp

            this._state = Object.seal({
                name: 'cleanupPending',
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
        } else if (this._state.name === 'endWaiting') {
            return this._state.endWaiter.promise.then(_ => {
                return { done: true, value: undefined }
            })
        } else if (this._state.name === 'cleanupPending') {
            const doneTrue = _ => {
                return {
                    done: true,
                    value: undefined,
                }
            }
            return this._state.cleanedUp.then(doneTrue, doneTrue)
        } else if (this._state.name === 'complete') {
            return Promise.resolve({
                done: true,
                value: undefined,
            })
        } else {
            throw new Error('Impossible state, please file a bug report')
        }
    }

    return(returnValue=undefined) {
        if (this._cancelled) {
            return Promise.reject(
                new CancelError('Stream has been cancelled and can no longer be used'),
            )
        } else if (this._state.name === 'empty'
        || this._state.name === 'queued') {
            const cleanedUp = this._doCleanup(this._state.cleanupOperation)
            this._state = Object.freeze({
                name: 'cleanupPending',
                cleanedUp,
            })
            return cleanedUp.then(_ => {
                this._state = Object.freeze({ name: 'complete' })
                return { done: true, value: returnValue }
            }, cleanupError => {
                this._state = Object.freeze({ name: 'complete' })
                throw cleanupError
            })
        } else if (this._state.name === 'waiting') {
            const endWaiter = deferred()
            this._state = {
                name: 'endWaiting',
                endWaiter,
                waitingQueue: this._state.waitingQueue,
                cleanupOperation: this._state.cleanupOperation,
            }
            return endWaiter.promise
        } else if (this._state.name === 'endWaiting') {
            const doneTrue = _ => ({ done: true, value: returnValue })
            const endWaiter = this._state.endWaiter
            return endWaiter.promise.then(doneTrue, doneTrue)
        } else if (this._state.name === 'endNext'
        || this._state.name === 'endQueued') {
            const completion = this._state.completionValue
            const cleanedUp = this._state.cleanedUp
            this._state = Object.freeze({
                name: 'cleanupPending',
                cleanedUp: this._state.cleanedUp,
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
        } else if (this._state.name === 'cleanupPending') {
            const doneTrue = _ => ({ done: true, value: returnValue })
            return this._state.cleanedUp.then(doneTrue, doneTrue)
        } else if (this._state.name === 'complete') {
            return Promise.resolve({ done: true, value: returnValue })
        } else {
            throw new Error('Impossible state, please file a bug report')
        }
    }

    [Symbol.asyncIterator]() {
        return this
    }
}
