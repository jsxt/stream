
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
    constructor(initializer, { maxSize=Infinity, drop="newest" }={}) {
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
        this._cleanedUp = deferred()
        this._isCleanedUp = false
        this._cleanedUp.promise.then(_ => {
            this._isCleanedUp = true
        })

        const _yield = value => {
            if (this._state === 'finished') {
                return
            } else if (this._waiting.length > 0) {
                // If there's a consumer waiting for the next value it
                // should be resolved immediately
                const consumer = this._waiting.shift()
                consumer.resolve({
                    done: false,
                    value,
                })
            } else {
                // Otherwise we'll add it onto our queue until the consumer
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
            if (this._state === 'finished') {
                // If we're done then this is a no-op
                return
            } else {
                // Otherwise we'll set our state to finished
                this._state = 'finished'
                if (this._waiting.length > 0) {
                    // If there's any consumers waiting we'll send the first
                    // the error then all remaining ones will be sent the closed
                    // once cleanup is finished
                    const consumer = this._waiting.shift()
                    consumer.reject(error)
                    while (this._waiting.length) {
                        const excessConsumer = this._waiting.shift()
                        this._cleanedUp.promise.then(_ => {
                            excessConsumer.resolve({
                                done: true,
                                value: undefined,
                            })
                        })
                    }
                } else {
                    // Otherwise we'll just put outselves on the queue
                    this._queue.push({
                        type: 'throw',
                        value: error,
                    })
                }
                // And finally we'll perform the cleanup action
                // to close any remaining resources the observer might hold
                this._performCleanup()
            }
        }

        const _return = value => {
            if (this._state === 'finished') {
                // If we're done then this a no-op
                return
            } else {
                // Otherwise we'll set our state to finished
                this._state = 'finished'
                if (this._waiting.length > 0) {
                    // If there's any consumers waiting we'll send the first
                    // the return value then all remaining ones will be sent
                    // nothing
                    const consumer = this._waiting.shift()
                    consumer.resolve({
                        done: true,
                        value,
                    })
                    while (this._waiting.length) {
                        const excessConsumer = this._waiting.shift()
                        this._cleanedUp.promise.then(_ => {
                            excessConsumer.resolve({
                                done: true,
                                value: undefined,
                            })
                        })
                    }
                } else {
                    // Otherwise we'll just put outselves on the queue
                    this._queue.push({
                        type: 'return',
                        value,
                    })
                }
                // And finally we'll perform the cleanup action
                // to close any remaining resources the observer might hold
                this._performCleanup()
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

    _performCleanup() {
        return Promise.resolve()
            .then(this._cleanup)
            .then(_ => this._cleanedUp.resolve(), err => {
                this.cleanedUp.resolve()
                throw err
            })
    }

    async _followCleanup() {
        // If cleanup has happened already we'll skip adding another
        // microtask onto the queue
        if (!this._isCleanedUp) {
            await this._cleanedUp.promise
        }
        return {
            done: true,
            value: undefined,
        }
    }

    next() {
        if (this._queue.length > 0) {
            // If there are items available then simply use the first item
            // as the result
            const item = this._queue.shift()
            if (item.type === 'return') {
                return Promise.resolve({
                    done: true,
                    value: item.value
                })
            } else if (item.type === 'throw') {
                return Promise.reject(item.value)
            } else {
                return Promise.resolve({
                    done: false,
                    value: item.value
                })
            }
        } else if (this._state === 'finished') {
            return this._followCleanup()
        } else if (this._state === 'finishedPending') {
            return this._followCleanup()
        } else {
            // Otherwise if there's nothing available then simply
            // give back a Promise immediately for when a value eventually
            // comes in
            const def = deferred()
            this._waiting.push(def)
            return def.promise
        }
    }

    _returnQueue() {
        // If there's any items in the queue then we'll simply ignore
        // them, but if the last is a throw/return then we'll follow from
        // that
        this._state = 'finished'
        const { value, type } = this._queue.slice(-1)[0]
        // Empty the queue now that we're done with it
        this._queue = []
        if (type === 'return') {
            // If a value was returned we'll wait for cleanup to finish
            // then return that value
            return this._cleanedUp.promise.then(_ => {
                return {
                    done: true,
                    value,
                }
            })
        } else if (type === 'throw') {
            // Otherwise if an error was thrown we'll wait for cleanup
            // then throw that error
            return this._cleanedUp.promise.then(_ => {
                throw value
            })
        } else {
            // Otherwise it was a simple value, in which case now that
            // we're in the 'finished' state we'll start cleanup and
            // follow from it
            return this._performCleanup().then(_ => {
                return {
                    done: true,
                    value: undefined,
                }
            })
        }
    }

    return() {
        if (this._queue.length) {
            return this._returnQueue()
        } else if (this._state === 'finished') {
            // If we've already been set to finished then we can just
            // wait for cleanup to finish an return
            return this._followCleanup()
        }
    }

    [Symbol.asyncIterator]() {
        return this
    }
}
