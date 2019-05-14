// @ts-check

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
 * @returns { { resolve: (value: T) => void, reject: (value: any) => void, promise: Promise<T> } }
 */
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
    /**
     * @param {number} maxSize
     */
    constructor(maxSize=Infinity) {
        if (typeof maxSize !== 'number' || maxSize < 0) {
            throw new RangeError(`max queue size must be a non-negative integer`)
        }
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
 * @property {Queue} waitingQueue
 * @property {AbstractQueue<T>} itemQueue
 */

/**
 * @typedef {object} WaitingForEndState
 * @property {'waitingForEnd'} name
 */

/**
  * @template T
  * @typedef {object} MaybeQueuedState
  * @property {'maybeQueued'} name
  * @property {Queue} waitingQueue
  * @property {AbstractQueue<T>} itemQueue
  */

/**
 * @template T
 * @typedef {object} EndQueuedState
 * @property {'endQueued'} name
 * @property {Queue} waitingQueue
 * @property {AbstractQueue<T>} itemQueue
 */

/**
 * @typedef {object} CleanupPending
 * @property {'cleanupPending'} name
 * @property {Promise<void>} cleanedUp
 */

/**
 * @template T
 * @typedef {CompleteState | WaitingForValueState<T> | WaitingForEndState | MaybeQueuedState<T> | EndQueuedState<T>} StreamState
 */

/**
  * @template T
  */
export class StreamIterator {
    
}

export default class Stream {
    static Iterator = StreamIterator;

    constructor(initializer, { createQueue }={}) {
        this._initializer = initializer
        this._createQueue = () => createQueue()
    }

    iterator({ queue=this._createQueue(), cancelSignal }) {
        return new Stream(this._initializer, {
            queue,
            cancelSignal,
        })
    }

    [Symbol.asyncIterator]() {
        return this.iterator()
    }
}
