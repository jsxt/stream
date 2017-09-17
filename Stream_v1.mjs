
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

/*  Stream is a data strucuture to convert callback APIs into consumable streams
    of data for example:

    const ticks = new Stream(stream => setInterval(queue.yield, 15))

    for await (const tick of ticks) {
        // This happens every 15 milliseconds (roughly)
    }
*/
export default class Stream {
    constructor(initializer, { maxSize=Infinity, drop='oldest' }={}) {
        if (typeof initializer !== 'function') {
            throw new Error(`Expected a function as first argument to Stream`)
        }
        if (drop !== 'newest' && drop !== 'oldest') {
            throw new Error(`drop must be either "newest" or "oldest"`)
        }
        this._queue = []
        this._waiting = []
        this._finished = false

        const _yield = value => {
            if (this._finished) {
                // If we're done then next is simply a no-op
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
            if (this._finished) {
                // If we're done then this is a no-op
                return
            } else {
                // Otherwise we'll set our state to finished
                this._finished = true
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
                    this._cleanup()
                } catch (err) {
                    /* If cleanup fails we'll just report an error */
                    console.warn(err)
                }
            }
        }

        const _return = value => {
            if (this._finished) {
                // If we're done then this a no-op
                return
            } else {
                // Otherwise we'll set our state to finished
                this._finished = true
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
                    this._cleanup()
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

        this._cleanedUp = deferred()
    }

    next() {
        if (this._finished) {
            // If we're finished then just return as such
            return Promise.resolve({
                done: true,
                value: undefined,
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
        try {
            if (!this._finished) {
                // If we're not finished we'll finish and trigger cleanup
                this._finished = true
                await Promise.all(this._waiting.map(waiting => waiting.promise))
                await this._cleanup()
            }
            // Then we'll return that we're done with the iterator
            return {
                done: true,
                value: undefined,
            }
        } finally {
            // Close any other consumers that are waiting
            while (this._waiting.length) {
                const consumer = this._waiting.shift()
                consumer.resolve({
                    done: true,
                    value: undefined,
                })
            }
        }
    }

    [Symbol.asyncIterator]() {
        return this
    }
}
