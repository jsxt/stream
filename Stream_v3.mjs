// Deferred creates a Promise and stores the resolve/reject on the same object
function deferred() {
    const def = {}
    def.promise = new Promise((resolve, reject) => {
        def.resolve = resolve
        def.reject = reject
    })
    return def
}

const doNothing = _ => {
    /* Nothing to do in doNothing */
}

export default class Stream {
    constructor(initializer, { queue=Infinity, drop="newest" }={}) {
        const maxSize = queue
        if (typeof queue !== 'number') {
            throw new Error(`Only queue size is currently supported`)
        }
        if (typeof initializer !== 'function') {
            throw new Error(`Expected a function as first argument to Stream`)
        }
        if (drop !== 'newest' && drop !== 'oldest') {
            throw new Error(`drop must be either "newest" or "oldest"`)
        }
        if (typeof maxSize !== 'number' || maxSize < 0) {
            throw new Error(`maxSize must be a positive or 0 number`)
        }
        this._queue = []
        this._waiting = []
        this._state = 'active'

        const _yield = value => {
            if (this._state !== 'active') {
                // If the stream is no longer active then we have nothing
                // to do
                return
            } else if (this._waiting.length > 0) {
                // Otherwise if there's a consumer waiting then we'll resume
                // them immediately
                const consumer = this._waiting.shift()
                consumer.resolve({
                    done: false,
                    value,
                })
            } else {
                // Otherwise we'll add it onto our queue until a consumer
                // chooses to consume it
                this._queue.push({
                    type: 'yield',
                    value,
                })
                // But we'll drop values from our queue when we exceed
                // the max queue size
                if (this._queue.length > maxSize) {
                    if (drop === 'oldest') {
                        this._queue.shift()
                    } else if (drop === 'newest') {
                        this._queue.pop()
                    }
                }
            }
        }

        const _throw = error => {
            if (this._state !== 'active') {
                // If the stream isn't listening for any more operations
                // then we have nothing to do
                return
            } else {
                this._beginCleanup()
                if (this._waiting.length > 0) {
                    // If there's any consumers waiting we'll send the first
                    // the error
                    const consumer = this._waiting.shift()
                    this._cleanedUp
                        .then(_ => {
                            // If cleanup was successful we'll reject
                            // with the error passed in
                            this._endCleanup()
                            consumer.reject(error)
                        }, cleanupError => {
                            // Otherwise we'll reject with the cleanup
                            // error
                            this._endCleanup()
                            consumer.reject(cleanupError)
                        })
                    // And all remaining ones will be sent { done: true }
                    // once the cleanup action is finished
                    while (this._waiting.length) {
                        const excessConsumer = this._waiting.shift()
                        const resolveExcess = _ => {
                            excessConsumer.resolve({
                                done: true,
                                value: undefined,
                            })
                        }
                        this._cleanedUp.then(resolveExcess, resolveExcess)
                    }
                } else {
                    // Otherwise we'll just put outselves on the queue
                    this._queue.push({
                        type: 'throw',
                        value: error,
                    })
                }
            }
        }

        const _return = value => {
            if (this._state !== 'active') {
                // If the stream isn't listening for any more operations
                // then we have nothing to do
                return
            } else {
                this._beginCleanup()
                if (this._waiting.length > 0) {
                    // If there's any consumers waiting we'll send the first
                    // the error
                    const consumer = this._waiting.shift()
                    this._cleanedUp
                        .then(_ => {
                            // If cleanup was successful we'll send through
                            // the completion value
                            this._endCleanup()
                            consumer.resolve({
                                done: true,
                                value,
                            })
                        }, cleanupError => {
                            // Otherwise we'll reject with the cleanup
                            // error
                            this._endCleanup()
                            consumer.reject(cleanupError)
                        })
                    // And all remaining ones will be sent { done: true }
                    // once the cleanup action is finished
                    while (this._waiting.length) {
                        const excessConsumer = this._waiting.shift()
                        const resolveExcess = _ => {
                            excessConsumer.resolve({
                                done: true,
                                value: undefined,
                            })
                        }
                        this._cleanedUp.then(resolveExcess, resolveExcess)
                    }
                } else {
                    // Otherwise we'll just put outselves on the queue
                    this._queue.push({
                        type: 'return',
                        value,
                    })
                }
            }
        }

        const cleanup = initializer(Object.freeze({
            yield: _yield,
            throw: _throw,
            return: _return,
            next: _yield,
            error: _throw,
            complete: _return,
        }))

        this._cleanup = typeof cleanup === 'function'
            ? cleanup
            : doNothing
    }

    _beginCleanup() {
        this._state = 'cleaningUp'
        this._cleanedUp = Promise.resolve()
            .then(this._cleanup)
    }

    _endCleanup() {
        this._state = 'complete'
        // Prevent invalid actions by ensuring that cleanedUp can't be used
        // once we reach the complete state
        this._cleanedUp = null
    }

    next() {
        if (this._state === 'complete') {
            // If we're complete then we have nothing to do
            return Promise.resolve({
                done: true,
                value: undefined,
            })
        } else if (this._queue.length > 0) {
            // If there's any values waiting in the queue then we'll observe
            // them
            const { value, type } = this._queue.shift()
            if (type === 'yield') {
                // If a value was yielded we can simply return it no questions asked
                return Promise.resolve({
                    done: false,
                    value,
                })
            } else if (type === 'throw') {
                // But if a value was thrown we need to
                // wait for the cleanup to become complete then mark
                // the state as complete before throwing our error
                return this._cleanedUp
                    .then(_ => {
                        // If cleanup completes then we can reject safely
                        this._endCleanup()
                        throw value
                    }, cleanupError => {
                        // Otherwise we'll reject with the cleanup error
                        this._endCleanup()
                        throw cleanupError
                    })
            } else if (type === 'return') {
                // And if a value was returned then we need to behave just
                // like throw but resolve the value instead on cleanup success
                return this._cleanedUp
                    .then(_ => {
                        // If cleanup completes then we can reject safely
                        this._endCleanup()
                        return {
                            done: true,
                            value,
                        }
                    }, cleanupError => {
                        // Otherwise we'll reject with the cleanup error
                        this._endCleanup()
                        throw cleanupError
                    })
            } else {
                throw new Error(`
                    Unknown state please file a bug report if you see this error
                    https://github.com/Jamesernator/stream
                `)
            }
        } else if (this._state === 'cleaningUp') {
            // If we're still in the cleaningUp stage but the queue is empty
            // then some other function is currently handling cleanup
            // so we can safely follow with { done: true }
            const doneTrue = _ => {
                return {
                    done: true,
                    value: undefined,
                }
            }
            return this._cleanedUp
                .then(doneTrue, doneTrue)
        } else if (this._state === 'active') {
            // If we're still active and the queue was empty then we shall
            // add ourselves to those that are waiting
            const def = deferred()
            this._waiting.push(def)
            return def.promise
        } else {
            throw new Error(`
                Unknown state please file a bug report if you see this error
                https://github.com/Jamesernator/stream
            `)
        }
    }

    // eslint-disable-next-line max-statements
    return() {
        if (this._state === 'complete') {
            // If we're complete then we have nothing to do
            return Promise.resolve({
                done: true,
                value: undefined,
            })
        } else if (this._queue.length > 0) {
            // If any items are in the queue then we'll simply dump all of
            // them and follow on from the last value in the queue if it's
            // a return or throw
            if (this._state === 'cleaningUp') {
                // If cleaning up has already begun then the last element
                // is definitely a throw or return so we'll inspect it
                const { value, type } = this._queue.slice(-1)[0]
                // Then we'll remove all values from the queue as it's
                // been fully consumed by return
                this._queue = []

                if (type === 'return') {
                    return this._cleanedUp.then(_ => {
                        // If cleanup succeeds then return the value
                        return {
                            done: true,
                            value,
                        }
                    }, cleanupError => {
                        // Otherwise reject with the cleanup error
                        throw cleanupError
                    })
                } else if (type === 'throw') {
                    return this._cleanedUp.then(_ => {
                        // If cleanup suceeds then throw the enqueued error
                        throw value
                    }, cleanupError => {
                        // Otherwise reject with the cleanup error
                        throw cleanupError
                    })
                } else {
                    throw new Error(`
                        Unknown state please file a bug report if you see this here:
                        https://github.com/Jamesernator/stream
                    `)
                }
            } else {
                // Otherwise is cleaning up isn't already happening then we'll
                // clear out the queue and begin cleanup
                this._beginCleanup()
                this._queue = []
                return this._cleanedUp.then(_ => {
                    // If cleanup succeeds then return the value
                    this._endCleanup()
                    return {
                        done: true,
                        value: undefined,
                    }
                }, cleanupError => {
                    // If cleanup fails then throw the cleanUp error
                    this._endCleanup()
                    throw cleanupError
                })
            }
        } else if (this._state === 'cleaningUp') {
            // If we're already cleaning up and nothing is left in the queue
            // then something is already ready to handle the cleanup so we'll
            // just follow from the cleanup
            const doneTrue = _ => {
                return {
                    done: true,
                    value: undefined,
                }
            }
            return this._cleanedUp
                .then(doneTrue, doneTrue)
        } else if (this._state === 'active') {
            // Otherwise if the state is active we need to check if any
            // consumers are waiting in the queue
            if (this._waiting.length === 0) {
                // If none are its safe to close immediately
                this._beginCleanup()
                this._queue = []
                return this._cleanedUp.then(_ => {
                    // If cleanup succeeds then return the value
                    this._endCleanup()
                    return {
                        done: true,
                        value: undefined,
                    }
                }, cleanupError => {
                    // If cleanup fails then throw the cleanUp error
                    this._endCleanup()
                    throw cleanupError
                })
            } else {
                // If any are waiting then we'll follow from the final one
                // and begin cleanup if it isn't started already
                const afterFinal = _ => {
                    if (this._state === 'active') {
                        // If we're still active we'll start cleanup
                        // and follow from it
                        this._beginCleanup()
                        return this._cleanedUp.then(_ => {
                            this._endCleanup()
                            return {
                                done: true,
                                value: undefined,
                            }
                        }, cleanupError => {
                            this._endCleanup()
                            throw cleanupError
                        })
                    } else if (this._state === 'cleaningUp') {
                        // If we're already cleaning up then we can simply
                        // follow from it
                        const doneTrue = _ => {
                            return {
                                done: true,
                                value: undefined,
                            }
                        }
                        return this._cleanedUp
                            .then(doneTrue, doneTrue)
                    } else {
                        // If we're complete then we can simply return
                        // { done: true } immediately
                        return {
                            done: true,
                            value: undefined,
                        }
                    }
                }
                const last = this._waiting.slice(-1)[0]
                return last.promise.then(afterFinal, afterFinal)
            }
        } else {
            throw new Error(`
                Unknown state please file a bug report if you see this here:
                https://github.com/Jamesernator/stream
            `)
        }
    }

    [Symbol.asyncIterator]() {
        return this
    }
}
