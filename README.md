
# Stream

### Introduction

The JavaScript language now has [async iterators and async generators](https://jakearchibald.com/2017/async-iterators-and-generators/), however not included is a way to create async iterators from existing data sources.

This library is designed to fill that void by providing a single concrete type with a lot of similarities to the Promise type. It also borrows ideas from the [observable proposal](https://github.com/tc39/proposal-observable) and allows any observer to also be used as the first argument to `Stream`.

*NOTE: Like the Observable proposal the goal of Stream is to have minimal API surface which is why Stream does't include any operators such as `.map`/`.filter`/etc, those should provided by some other library*

### Examples

```js
const interval = new Stream(stream => {
    setInterval(stream.yield, 1000)
})

for await (const _ of interval) {
    console.log("Tick")
}
```

```js
function mediaChunks(mediaRecorder, stopWhen) {
    return new Stream(stream => {
        mediaRecorder.ondataavailable = ({ data }) => stream.yield(data)
        stopWhen(stream.return)
    })
}

const userVoice = await navigator.mediaDevices.getUserMedia({ audio: true })
const stopWhen = callback => setTimeout(stopWhen, 10000)

const recorder = new MediaRecorder(userVoice)

for await (const chunk of mediaChunks(recorder, stopWhen)) {
    // Even if db.append is slow the rest of the chunks will still be queued
    await db.table(filename).append(chunk)
}
```

### API

#### `new Stream(initializer, { queue=new Queue() }={})`

```ts
type CleanupCallback = () => (void | Promise<void>)

type StreamOptions = {
    queue?: AbstractQueue,
}

export default class Stream<T> {
    constructor(
        initializer: (controller: StreamController) => void | CleanupCallback,
        options?: StreamOptions,
    )
}
```

The `Stream` constructor requires a single paramater as it's first argument, the initializer will be called
immediately a `StreamController` object, it may optionally return a single function that will be called
when cleanup is started and the stream is complete.

Optionally as a second argument the 

#### `stream` Objects

Objects referred to here as "streams" are those objects returned by the `Stream` constructor, the purpose of a Stream object is to behave as an async iterable for some asynchronous collection (e.g. clicks on an element, ticks on a clock, etc).



#### `new Stream(initializer: function, { queue: number=Infinity, cancelSignal: CancelSignal=CancelSignal.never }={})`

The `Stream` constructor requires a single parameter as it's first argument, the initializer will be called immediately with a `StreamController` object (see later), it may optionally return a single function that will be called to cleanup any resources the stream may hold (guaranteed to be called only once).

The second argument is an options object that can accept the following properties:

- `queue`: This is a non-negative integer (zero is OK) which indicates how many items will be kept in the queue that haven't yet been consumed.
- `cancelSignal`: This is an object conforming to the CancelSignal interface the the [cancellation proposal](https://github.com/tc39/proposal-cancellation/issues/22), if the source is cancelled then the stream will be immediately cleaned up and will reject any outstanding `.next` and `.return` with a cancel error.

#### `Stream.prototype.next(): Promise<{ done: boolean, value: any }, any>`

The `.next` method of stream objects simply waits until the next value of the stream is emitted (which may be already queued if calling later than the value was emitted), if the stream yields a value normally then this will be `{ done: false, value: ...}`, otherwise if the stream completes then once the value will be  `{ done: true, value: ... }`, if the stream throws an error then the Promise will reject with the error thrown by the stream.

The `.next` is designed to be safe to call multiple times in advance in which case the returned Promises will resolve as if they were immediately added after the previous one resolved. If a stream finishes before all requested `.next` are resolved then any after the `{ done: true }` or error value will simply be the object `{ done: true, value: undefined }`.

*NOTE: If an error occurs during cleanup then the Promise returned from `.next` will reject with the cleanup error instead of the return value, this will even override any thrown error in the Stream*


#### `Stream.prototype.return(): Promise<{ done: true, value: any }, any>`

The `.return` method will cause the cleanup action to be invoked immediately (if it hasn't already) and then return `{ done: true, value: undefined }` upon successful completion of the the cleanup action.

If any Promises returned by previous calls to `.next` are still not resolved then `.return` will wait until their requests will be honored and the `.return` method won't trigger cleanup until the most recent Promise returned by `.next` is resolved.

*NOTE: If an error occurs during cleanup then the Promise returned from `.return` will reject with the cleanup error instead of the value `{ done: true, value: undefined }`*


#### `Stream.prototype[Symbol.asyncIterator](): Stream`

Because streams are already valid async iterators the return value of `[Symbol.asyncIterator]` is simply the stream on which the method was invoked.


#### `StreamController`

The StreamController object is an object passed into the initializer, this the mechanism by which you can cause the stream to emit new values or complete, it only has three methods (plus three aliases which enable interoperability with Observables if desired).

*NOTE: All of the StreamController methods will simply do nothing if the Stream has been closed (by either calling `.return` or `.throw` on the StreamController or by calling `.return` on the stream itself).

*NOTE: All of the StreamController methods are bound to the stream instance so you don't need to bind them yourself unlike in Observable!*


#### `StreamController.yield(value: any)`/`StreamController.next(value: any)`

The `.yield` function on the stream controller will cause the oldest unfufilled Promise requested by `.next` to resolve with the `value` field set to the value passed into the `.yield` function. If `.next` hasn't been requested yet then this will simply add a value into the queue that will be consumed instantly by subsequent `stream.next` calls.

*NOTE: Calling `.yield` after the stream has been ended will have no effect*

*NOTE: `.next` is simply an Observable compatible alias for `.yield`*


#### `StreamController.throw(error: any)`/`StreamController.error(error: any)`

The `.throw` function on the stream controller will cause the oldest unfulfilled Promise requested by `.next` to be rejected with the given error. If no `.next` is currently requested then the error will be queued and once all values currently in the queue are consumed the next `.next` call will reject with the passed error.

*NOTE: Calling `.throw` after the stream has ended will have no effect*

*NOTE: `.error` is simply an Observable compatible alias for `.throw`*


#### `StreamController.return(value: any)`/`StreamConroller.complete(value: any)`

The `.return` function on the stream controller will cause the oldest unfufilled Promise requested by `.next` to return with the `value` field set to the passed value however unlike `.yield` it will also cause the `done` value to be set to `false` and cause the stream to complete. If the `.next` hasn't been requested yet then the return value will be queued until the queue is empty and `.next` is called again.

*NOTE: Calling `.return` after the stream has ended will have no effect*

*NOTE: `.complete` is simply an Observable compatible alias for `.return` however unlike Observable the value passed to `.return`/`.complete` is not simply ignored, when creating compatible definitions the value passed into `.return` must not be relied upon*

#### `StreamController.cancelSignal`

The `.cancelSignal` property is the cancel signal passed into the stream constructor or a cancel signal that never signals if none was passed in.

### Examples

Creating a stream of DOM events from an event listener:

```js
import Stream from '@jx/stream'

function clicks(element) {
    return new Stream(stream => {
        element.addEventListener('clicks', stream.next)
        return _ => {
            element.removeEventListener('clicks', stream.next)
        }
    })
}

async function main() {
    for await (const click of clicks(someElement)) {
        console.log('Clicked!')
    }
}

main()
```

Creating a lossy event stream that only emits the most recent location the mouse
has been for cases where the loop body is too slow to keep up.

```js
import Stream from '@jx/stream'

function mouseMoves(element) {
    return new Stream(stream => {
        element.addEventListener('mousemove', stream.next)
        return _ => {
            element.removeEventListener('mousemove', stream.next)
        }
    }, { queue: 0 })
}

async function main() {
    for await (const move of mouseMoves(someElement)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        // This keeps generally in sync with the mouse rather than lagging
        // increasingly behind if we were to queue any number of items
        await moveSomeElement({ x: move.x, y: move.y })
    }
}

main()
```

### Precise state details

In order for Stream to cleanup at appropriate times like the Promise objects (which have a `pending`/`fulfilled`/`rejected` states) a stream object also can be in various states and which state it is it will change when a specific method might resolve or what it might do.

Here's the full state digram, it's just a teensy, tiny bit more complicated than the Promise one:

![alt text](./stream.svg)

Okay so it's a bit more complicated than a Promise, but it's designed so that cleanup occurs at the correct time rather than cleaning up at an invalid time.

This is a summary of all states the queue can be in with what the methods will do at each step.

<table>
    <thead>
        <tr>
            <td>
            <td>`controller.yield(item)`
            <td>`controller.{throw(value),return(value)}`
            <td>`stream.next`
            <td>`stream.return`
            <td>`cancelSignal` signals cancellation
            <td>Cleanup state
    <tbody>
        <tr>
            <td>**empty**
            <td>
                Adds `item` onto the *item queue* and enters the **queued** state.
            <td>
                Enters the **endNext** state and begins cleanup setting the stream's *completion value* to `value`. If the method is `.return` then this is a *return value* otherwise if the method is `.throw` then this is an *error value*.
            <td>
                Adds a new *requested value* onto the *waiting queue* and returns that *requested value*. Enters the **waiting** state.
            <td>
                Begins cleanup and enters the **cleanupPending** state.
                <p>
                <p>Returns a Promise that will resolve with `{ done: true, value: undefined }` if cancellation succeeds otherwise will throw an error if cancellation threw an error.
            <td rowspan="10">
                Begins cleanup and immediately enters the **cancelled** state. Any *requested values* still in the *waiting queue* will be immediately rejected with a `CancelError`. If cancelled asynchronously then the registered callback will return a Promise for when cleanup is complete.
            <td>
                Not started.
        <tr>
            <td>**queued**
            <td>
                Adds `item` onto the end of the *item queue*.
            <td>
                Enters the **endQueued** state and begins cleanup setting the stream's *completion value* to `value`. If the method is `.return` then this is a *return value* otherwise if the method is `.throw` then this in an *error value*.
            <td>
                Removes the first *next value* off the *item queue* and returns with the *next value*. If the *item queue* is empty we also enter the **empty** state.
            <td>
                Discards all items from the *item queue* and begins cleanup entering the **cleanupPending** state, returning a Promise for `{ done: true, value: undefined }` if cleanup is successful otherwise returns a rejected Promise with the cleanup error.
            <td>
                Not started.
        <tr>
            <td>**endQueued**
            <td rowspan="2" colspan="2" align="center">
                Does nothing
            <td>
                Removes the first *next value* off the *item queue* and returns with the *next value*. If the *item queue* is empty we enter the **endNext** state.
            <td>
                Discards all values in the *item queue* and begins cleanup entering the **cleanupPending** state. Returns a Promise that when cancellation is complete will resolve with the *completion value* of the stream. If the cleanup rejects it will reject with the error of the cleanup (even if the *completion value* is an *error value*).
            <td>
                Started, possibly complete.
        <tr>
            <td>**endNext**
            <td>
                Return a Promise that resolves when cleanup has completed:
                <ul>
                    <li>If the cleanup throws (or rejects with) an error. Then the promise will be rejected with that error.
                    <li>Otherwise resolve the Promise with the stream's *completion value*.
                </ul>
            <td>
                Begins cleanup entering the **cleanupPending** state. Returns a Promise that when cancellation is complete will resolve with the *completion value* of the stream. If the cleanup rejects it will reject with the error of the cleanup (even if the *completion value* is an *error value*).
            <td>
                Started, possibly complete.
        <tr>
            <td>**waiting**
            <td>
                Resolves the next *requested value* in the *waiting queue* with `item`. If the waiting queue is empty after doing this it enters the **empty** state.
            <td rowspan="2">Begins the cleanup and enters the **cleanupPending** state.
                <p>
                <p> When the cleanup is complete:
                <ul>
                    <li>
                        <ul>
                            <li>If the cleanup throws (or rejects with) an error then reject the first *requested value* in the *waiting queue* with the error.

                            <li>Otherwise resolve the *requested value* with the *completion value* `value`. If the method is `.return` then `value` is a *return value* otherwise if the method is `.throw` it's an *error value*.
                        </ul>
                    <li>Resolve all other *requested values* in the *waiting queue* with `{ done: true, value: undefined }`.
                </ul>
            <td>
                Adds a *requested value* onto the *waiting queue* and returns the *requested value*.
            <td>
                We enter the **endWaiting** state and return a Promise that will resolve when the *waiting queue* is empty and cleanup is complete. Regardless of the result of cleanup we will resolve the Promise with `{ done: true, value: undefined }` when the cleanup has finished.
            <td>
                Not started.
        <tr>
            <td>**endWaiting**
            <td>
                Resolves the first *requested value* in the *waiting queue* with `item`. If the waiting queue is empty after doing this it begins the cleanup and enters the **cleanupPending** state.
            <td>
                Returns a promise that resolves to `{ done: true, value: undefined }` when the final item in the *waiting queue* is resolved and cleanup is finished.
            <td>
                Stays in the **endWaiting** state and returns a Promise that will resolve when the *waiting queue* is empty and cleanup is complete. Regardless of the result of cleanup we will resolve the Promise with `{ done: true, value: undefined }` when cleanup has finished.
            <td>
                Not started.

        <tr>
            <td>**cleanupPending**
                <hr>
                <p>When in the **cleanupPending** state we will unconditionally enter the **complete** state when the cleanup is complete.
            <td rowspan="3" colspan="2">
                Does nothing
            <td colspan="2">
                Returns a promise that resolves to `{ done: true, value: undefined }` when the cleanup has completed.
            <td>
                Started, might be complete but won't enter **complete** until a future microtask if it is complete.
        <tr>
            <td>**complete**
            <td colspan="2">
                Returns a promise that immediately resolves to `{ done: true, value: undefined }`.
            <td>
                Complete.
        <tr>
            <td>**cancelled**
            <td colspan="2">
                Returns a promise that is immediately rejected with a `CancelError`.
            <td>
                Started, possibly complete.
</table>

Terms:
  - The *item queue* <sup>†</sup> is a queue of items that are currently being stored
    in the stream but haven't yet been consumed by a call to `.next` or `.return`. This queue may have it's size limited by the `queue` option.
  - The *waiting queue* <sup>†</sup> is a queue of outstanding requests to `.next`/`.return` that can't yet be fulfilled because items haven't been received yet. Unlike the *item queue* this queue never has any size limit and can grow to however many requests are needed.
  - A *requested value* is a Promise for a value that is not yet ready, it may either be a *next value* or a *completion* value.
  - A *next value* is a value that will be emitted next from the iterator.
    - To "resolve a *requested value* with a *next value*" means the Promise will be resolved with `{ done: false, value }`, where `value` is the *next value*.
    - To "return with a *next value*" we return a resolved Promise of `{ done: false, value }` where `value` is the *next value*.
  - A *completion value* is either a *return value* or an *error value*.
    - To "resolve a *requested value* with a *completion value*" if the completion value is a *return value* then we will resolve the Promise with `{ done: false, value }` where `value` is the *return value*, otherwise if *completion value* is an *error value* we will reject the Promise with the *error value*.
    - To "return with a *completion value*, if the *completion value* is a *return value* we return a resolved Promise of `{ done: true, value }` where `value` is the *completion value*. Otherwise if the value is an *error value* we return a rejected Promise of the *completion value*.

**†** It's not possible for both the *item queue* and the *waiting queue* to have items at the same time as we can't both have queued items while also having pending requests.
