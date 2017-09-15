
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
        this._finished = deferred()

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
                    type: 'next',
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
                    const consumer = this._waiting.shift()
                    consumer.reject(error)
                    while (this._waiting.length) {
                        const excessConsumer = this._waiting.shift()
                        excessConsumer.resolve({
                            done: true,
                            value: undefined,
                        })
                    }
                } else {
                    // Otherwise we'll just put outselves on the queue
                    this._queue.push({
                        type: 'error',
                        value: error,
                    })
                }
                // And finally we'll perform the cleanup action
                // to close any remaining resources the observer might hold
                try {
                    // Enqueue cleanup on next microtask after Stream
                    // is fully initialized
                    Promise.resolve().then(this._cleanup)
                } catch (err) {
                    /* If cleanup fails we'll just report an error */
                    console.warn(err)
                }
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
                        excessConsumer.resolve({
                            done: true,
                            value: undefined,
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
                try {
                    Promise.resolve().then(this._cleanup)
                } catch (err) {
                    /* If cleanup fails we'll just report an error */
                    console.warn(err)
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

    next() {
        if (this._state === 'finished') {
            // If we're finished then there's only one thing to do
            return Promise.resolve({
                done: true,
                value: undefined,
            })
        } else if (this._state === 'finishedPending') {
            // But if we're pending finished then there is a `return()` queued
            // so we'll follow the finished Promise with a { done: true }
            return this._finished.promise.then(_ => {
                return {
                    done: true,
                    value: undefined,
                }
            })
        } else if (this._queue.length > 0) {
            // If there are items available then simply use the first item
            // as the result
            const item = this._queue.shift()
            if (item.type === 'return') {
                return Promise.resolve({
                    done: true,
                    value: item.value
                })
            } else if (item.type === 'error') {
                return Promise.reject(item.value)
            } else {
                return Promise.resolve({
                    done: false,
                    value: item.value
                })
            }
        } else {
            // Otherwise if there's nothing available then simply
            // give back a Promise immediately for when a value eventually
            // comes in
            const def = deferred()
            this._waiting.push(def)
            return def.promise
        }
    }

    async return() {
        if (this._state === 'finished') {
            // If we're already finished then there's nothing to do
            return {
                done: true,
                value: undefined,
            }
        } else if (this._state === 'finishedPending') {
            // Otherwise if we're pending a finished already then we'll follow
            // from that
            return this._finished.promise.then(_ => {
                return {
                    done: true,
                    value: undefined,
                }
            })
        } else {
            // Otherwise we'll change our state so that other methods know that
            // a finished is pending and no new requests will be honored
            this._state = 'finishedPending'
            try {
                // If there's any consumers waiting we shall wait for the last
                // one to be resolved
                if (this._waiting.length) {
                    await this._waiting.slice(-1)[0].promise
                }
                // Once all .next consumers are finished we'll put ourself
                // in the finished state so that methods know not to
                this._state = 'finished'
                // Then we'll perform our cleanup
                await this._cleanup()
                // And if all went well we'll return { done: true }
                return {
                    done: true,
                    value: undefined,
                }
            } finally {
                // In case an error was thrown on the last waiting consumer
                // we'll ensure that this._state really is set to 'finished'
                this._state = 'finished'
                // Regardless of whether an error occured during cleanup we'll
                // notify that we're finished
                this._finished.resolve()
                // This is just a guard to ensure that no one tries to follow
                // from this._finished after entering the 'finished' state
                this._finished = null
            }
        }
    }

    [Symbol.asyncIterator]() {
        return this
    }
}
