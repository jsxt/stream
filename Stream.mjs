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
    constructor(initializer, { queue=Infinity }={}) {
        const maxSize = queue
        if (typeof queue !== 'number') {
            throw new Error(`Only queue size is currently supported`)
        }
        if (typeof initializer !== 'function') {
            throw new Error(`Expected a function as first argument to Stream`)
        }
        if (typeof maxSize !== 'number' || maxSize < 0) {
            throw new Error(`maxSize must be a positive or 0 number`)
        }
        this._queue = []
        this._waiting = []
        this._state = 'empty'
        this._cleanedUp = null
        this._finished = null
        this._completion = null

        // eslint-disable-next-line complexity
        const _yield = value => {
            if (this._state === 'waiting') {
                // If any consumers are waiting then we can simply
                // resume the first one
                const consumer = this._waiting.shift()
                if (this._waiting.length === 0) {
                    this._state = 'empty'
                }
                consumer.resolve({
                    done: false,
                    value,
                })
            } else if (this._state === 'empty' || this._state === 'queued') {
                this._state = 'queued'
                // If we're currently empty or queueing then we'll just append
                // to our queue
                this._queue.push(value)
                // And pop off any excess elements in the queue
                if (this._queue.length > maxSize) {
                    this._queue.shift()
                }
            } else if (this._state === 'endWaiting') {
                const consumer = this._waiting.shift()
                if (this._waiting.length === 0) {
                    this._beginCleanup()
                    this._cleanedUp.then(_ => {
                        this._endCleanup()
                        this._finished.resolve({
                            done: true,
                            value: undefined,
                        })
                        this._finished = null
                    }, cleanupError => {
                        this._endCleanup()
                        this._finished.reject(cleanupError)
                        this._finished = null
                    })
                }
                consumer.resolve({
                    done: false,
                    value,
                })
            } else if (this._state === 'endNext'
            || this._state === 'endQueued'
            || this._state === 'cleanup'
            || this._state === 'complete') {
                return
            } else {
                throw new Error(`Unknown state, please file a bug report`)
            }
        }

        // eslint-disable-next-line complexity, max-statements
        const _throw = error => {
            if (this._state === 'waiting') {
                // Reject the first consumer with the error
                // after finishing cleanup
                this._beginCleanup()
                const consumer = this._waiting.shift()
                this._cleanedUp.then(_ => {
                    this._endCleanup()
                    consumer.reject(error)
                }, cleanupError => {
                    this._endCleanup()
                    consumer.reject(cleanupError)
                })
                // Then all remaining consumers will be resolved
                // with { done: true }
                while (this._waiting.length) {
                    const excessConsumer = this._waiting.shift()
                    this._cleanedUp.then(_ => {
                        excessConsumer.resolve({
                            done: true,
                            value: undefined,
                        })
                    })
                }
            } else if (this._state === 'empty') {
                this._state = 'endNext'
                this._completion = { type: 'throw', value: error }
                this._beginCleanup(false)
            } else if (this._state === 'queued') {
                this._state = 'endQueued'
                this._completion = { type: 'throw', value: error }
                this._beginCleanup(false)
            } else if (this._state === 'endWaiting') {
                const consumer = this._waiting.shift()
                this._beginCleanup()
                this._cleanedUp.then(_ => {
                    this._endCleanup()
                    consumer.reject(error)
                }, cleanupError => {
                    this._endCleanup()
                    consumer.reject(cleanupError)
                })
                // Then all remaining consumers will be resolved
                // with { done: true }
                while (this._waiting.length) {
                    const excessConsumer = this._waiting.shift()
                    this._cleanedUp.then(_ => {
                        excessConsumer.resolve({
                            done: true,
                            value: undefined,
                        })
                    })
                }
                // Finally resolve the finisher when cleanup is finished
                this._cleanedUp.then(_ => {
                    this._finished.resolve({
                        done: true,
                        value: undefined,
                    })
                })
            } else if (this._state === 'endNext'
            || this._state === 'endQueued'
            || this._state === 'cleanup'
            || this._state === 'complete') {
                return
            }
        }

        // eslint-disable-next-line complexity, max-statements
        const _return = value => {
            if (this._state === 'waiting') {
                // Reject the first consumer with the error
                // after finishing cleanup
                this._beginCleanup()
                const consumer = this._waiting.shift()
                this._cleanedUp.then(_ => {
                    this._endCleanup()
                    consumer.resolve({
                        done: true,
                        value,
                    })
                }, cleanupError => {
                    this._endCleanup()
                    consumer.reject(cleanupError)
                })
                // Then all remaining consumers will be resolved
                // with { done: true }
                while (this._waiting.length) {
                    const excessConsumer = this._waiting.shift()
                    this._cleanedUp.then(_ => {
                        excessConsumer.resolve({
                            done: true,
                            value: undefined,
                        })
                    })
                }
            } else if (this._state === 'empty') {
                this._state = 'endNext'
                this._completion = { type: 'return', value }
                this._beginCleanup(false)
            } else if (this._state === 'queued') {
                this._state = 'endQueued'
                this._completion = { type: 'return', value }
                this._beginCleanup(false)
            } else if (this._state === 'endWaiting') {
                const consumer = this._waiting.shift()
                this._beginCleanup()
                this._cleanedUp.then(_ => {
                    this._endCleanup()
                    consumer.resolve({
                        done: true,
                        value,
                    })
                }, cleanupError => {
                    this._endCleanup()
                    consumer.reject(cleanupError)
                })
                // Then all remaining consumers will be resolved
                // with { done: true }
                while (this._waiting.length) {
                    const excessConsumer = this._waiting.shift()
                    this._cleanedUp.then(_ => {
                        excessConsumer.resolve({
                            done: true,
                            value: undefined,
                        })
                    })
                }
                // Finally resolve the finisher when cleanup is finished
                this._cleanedUp.then(_ => {
                    this._finished.resolve({
                        done: true,
                        value: undefined,
                    })
                })
            } else if (this._state === 'endNext'
            || this._state === 'endQueued'
            || this._state === 'cleanup'
            || this._state === 'complete') {
                return
            }
        }

        const cleanup = initializer({
            yield: _yield,
            next: _yield,
            throw: _throw,
            error: _throw,
            return: _return,
            complete: _return,
        })
        this._cleanup = typeof cleanup === 'function'
            ? cleanup
            : doNothing
    }

    _beginCleanup(setState=true) {
        if (setState) {
            this._state = 'cleanup'
        }
        this._cleanedUp = Promise.resolve()
            .then(_ => Reflect.apply(this._cleanup, undefined, []))
    }

    _endCleanup() {
        this._state = 'complete'
        this._cleanedUp = null
    }

    // eslint-disable-next-line complexity, max-statements
    next() {
        if (this._state === 'empty' || this._state === 'waiting') {
            this._state = 'waiting'
            const whenReceived = deferred()
            this._waiting.push(whenReceived)
            return whenReceived.promise
        } else if (this._state === 'queued') {
            const value = this._queue.shift()
            if (this._queue.length === 0) {
                this._state = 'empty'
            }
            return Promise.resolve({
                done: false,
                value,
            })
        } else if (this._state === 'endQueued') {
            const value = this._queue.shift()
            if (this._queue.length === 0) {
                this._state = 'endNext'
            }
            return Promise.resolve({
                done: false,
                value,
            })
        } else if (this._state === 'endNext') {
            const { type, value } = this._completion
            this._completion = null
            if (type === 'return') {
                return this._cleanedUp.then(_ => {
                    // If cleanup succeeded then we can simply return
                    // the completion value
                    this._endCleanup()
                    return {
                        done: true,
                        value
                    }
                }, cleanupError => {
                    // Otherwise if it failed then we will throw the cleanup's
                    // error
                    this._endCleanup()
                    throw cleanupError
                })
            } else if (type === 'throw') {
                return this._cleanedUp.then(_ => {
                    // If cleanup succeeded then we can simply throw the
                    // completion value
                    this._endCleanup()
                    throw value
                }, cleanupError => {
                    // Otherwise if it failed then we will throw the cleanup's
                    // error
                    this._endCleanup()
                    throw cleanupError
                })
            } else {
                throw new Error(`Invalid state, please file a bug report`)
            }
        } else if (this._state === 'endWaiting') {
            // If we're currently waiting for the end then we'll follow
            // the requested return
            return this._finished.promise.then(_ => {
                return {
                    done: true,
                    value: undefined,
                }
            })
        } else if (this._state === 'cleanup') {
            // If we're currently cleaning up then we'll
            // follow from the cleanup
            const doneTrue = _ => {
                return {
                    done: true,
                    value: undefined,
                }
            }
            return this._cleanedUp.then(doneTrue, doneTrue)
        } else if (this._state === 'complete') {
            // If we're already complete then we'll simply return
            // that we're done
            return Promise.resolve({
                done: true,
                value: undefined,
            })
        } else {
            throw new Error(`Invalid state, please file a bug report`)
        }
    }

    // eslint-disable-next-line complexity, max-statements
    return() {
        if (this._state === 'empty' || this._state === 'queued') {
            // Regardless of what values are in the queue we can simply
            // discard them
            this._queue = []
            this._beginCleanup()
            return this._cleanedUp.then(_ => {
                // If cleanup succeeded then we can just retun { done: true }
                this._endCleanup()
                return {
                    done: true,
                    value: undefined,
                }
            }, cleanupError => {
                // Otherwise end cleanup and throw the cleanup error
                this._endCleanup()
                throw cleanupError
            })
        } else if (this._state === 'waiting') {
            // If anything is waiting then we'll add ourselves to the waiting
            this._state = 'endWaiting'
            this._finished = deferred()
            return this._finished.promise
        } else if (this._state === 'endWaiting') {
            // If we're already waiting for completion we'll follow when
            // completion is done
            const doneTrue = _ => ({ done: true, value: undefined })
            return this._finished.promise.then(doneTrue, doneTrue)
        } else if (this._state === 'endNext' || this._state === 'endQueued') {
            // If a throw/return is already enqueued then we can simply
            // follow from it
            const { type, value } = this._completion
            this._completion = null
            this._queue = []
            if (type === 'return') {
                return this._cleanedUp.then(_ => {
                    // If cleanup succeeded then we can simply return
                    // the completion value
                    this._endCleanup()
                    return {
                        done: true,
                        value
                    }
                }, cleanupError => {
                    // Otherwise if it failed then we will throw the cleanup's
                    // error
                    this._endCleanup()
                    throw cleanupError
                })
            } else if (type === 'throw') {
                return this._cleanedUp.then(_ => {
                    // If cleanup succeeded then we can simply throw the
                    // completion value
                    this._endCleanup()
                    throw value
                }, cleanupError => {
                    // Otherwise if it failed then we will throw the cleanup's
                    // error
                    this._endCleanup()
                    throw cleanupError
                })
            } else {
                throw new Error(`Invalid state, please file a bug report`)
            }
        } else if (this._state === 'cleanup') {
            // If we're already cleaning up we can simply follow from it
            const doneTrue = _ => ({ done: true, value: undefined })
            return this._cleanup.then(doneTrue, doneTrue)
        } else if (this._state === 'complete') {
            // If we're complete then we can simply return
            return Promise.resolve({
                done: true,
                value: undefined,
            })
        } else {
            throw new Error(`Unknown state, please file a bug report`)
        }
    }

    [Symbol.asyncIterator]() {
        return this
    }
}
