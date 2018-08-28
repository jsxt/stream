
Symbol.cancelSignal = Symbol.cancelSignal || Symbol.for('https://github.com/tc39/proposal-cancellation/issues/22')

export default class CancelSignalSource {
    constructor(linkedCancelables=[]) {
        // eslint-disable-next-line no-param-reassign
        linkedCancelables = [...linkedCancelables]
        const source = this
        this._subscriptions = new Map()
        this._state = 'waiting'

        const cancelSignal = Object.freeze({
            [Symbol.cancelSignal]() {
                return this
            },

            get signaled() {
                return source._state === 'signaled'
            },

            subscribe(callback) {
                if (source._state === 'signaled') {
                    callback()
                    return Object.freeze({
                        unsubscribe() {
                            /* Nothing to do if the cancellation has
                                already happened */
                        },
                    })
                }
                const subscription = Object.freeze({
                    unsubscribe() {
                        // This check prevents duplicate callbacks
                        // being removed from the same subscription
                        // e.g. if we have:
                        //   sub1 = signal.subscribe(console.log)
                        //   sub2 = signal.subscribe(console.log)
                        // then this prevents using sub1.unsubscribe()
                        // twice to remove sub2
                        source._subscriptions.delete(subscription)
                    },
                })
                source._subscriptions.set(subscription, callback)
                return subscription
            },
        })

        this._signal = cancelSignal

        for (const cancelable of linkedCancelables) {
            if (cancelable[Symbol.cancelSignal]().signaled) {
                this._linkedSubscriptions = null
                this._state = 'signaled'
                break
            }
        }

        if (this._state !== 'signaled') {
            const linkedSubscriptions = linkedCancelables.map(cancelable => {
                return cancelable[Symbol.cancelSignal]().subscribe(_ => {
                    this.cancel()
                })
            })
            this._linkedSubscriptions = linkedSubscriptions
        }
    }

    get signal() {
        return this._signal
    }

    cancel() {
        if (this._state === 'closed' || this._state === 'signaled') {
            return Promise.resolve()
        }
        this._state = 'signaled'
        const callbacks = [...this._subscriptions.values()]
        const result = Promise.all(callbacks.map(callback => {
            try {
                const result = callback()
                return Promise.resolve(result)
            } catch (error) {
                return Promise.reject(error)
            }
        }))
        this._subscriptions = null
        return result.then(_ => undefined)
    }

    close() {
        if (this._state === 'closed' || this._state === 'signaled') {
            return
        }
        this._state = 'closed'
        for (const subscription of this._linkedSubscriptions) {
            subscription.unsubscribe()
        }
        this._linkedSubscriptions = null
        this._subscriptions = null
    }
}
