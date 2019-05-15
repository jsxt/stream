import test from "ava"
import Stream from "../Stream.js"
import deferred from "./_helpers/deferred.js"
import isResolved from "./_helpers/isResolved.js"

test('next resolves with values that have already been enqueued', async t => {
    const s = new Stream(stream => {
        stream.yield(10)
        stream.yield(20)
    })
    t.deepEqual({ done: false, value: 10 }, await s.next())
    t.deepEqual({ done: false, value: 20 }, await s.next())
})

test("next resolves with values that haven't been received yet", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    const one = s.next()
    const two = s.next()
    // Let a microtask happen
    await null
    streamController.yield(11)
    streamController.yield(23)

    t.deepEqual({ done: false, value: 11 }, await one)
    t.deepEqual({ done: false, value: 23 }, await two)
})

test("next method receives done values and only done: true after that", async t => {
    const s = new Stream(stream => {
        stream.yield(111)
        stream.return(37)
        stream.yield(12)
        stream.throw('Whoopsie')
    })
    t.deepEqual({ done: false, value: 111 }, await s.next())
    t.deepEqual({ done: true, value: 37 }, await s.next())
    t.deepEqual({ done: true, value: undefined }, await s.next())
    t.deepEqual({ done: true, value: undefined }, await s.next())
})

test("next method receives done values that haven't been received yet", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    const one = s.next()
    const two = s.next()
    const three = s.next()
    const four = s.next()
    // Let a microtask happen
    await null
    streamController.yield(11)
    streamController.return(23)
    streamController.yield(12)
    streamController.throw('Whoopsies')

    t.deepEqual({ done: false, value: 11 }, await one)
    t.deepEqual({ done: true, value: 23 }, await two)
    t.deepEqual({ done: true, value: undefined }, await three)
    t.deepEqual({ done: true, value: undefined }, await four)
})

test("next method receives exceptions as rejections", async t => {
    const s = new Stream(stream => {
        stream.yield(11)
        stream.throw(new Error('Whoopsies'))
        stream.yield(23)
        stream.throw('Oopsies again')
        stream.return("This shouldn't be observed")
    })

    t.deepEqual({ done: false, value: 11 }, await s.next())
    const error = await t.throwsAsync(_ => s.next())
    t.is(error.message, 'Whoopsies')
    t.deepEqual({ done: true, value: undefined }, await s.next())
    t.deepEqual({ done: true, value: undefined }, await s.next())
})

test("next method receives exceptions as rejections that haven't been received yet", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    const one = s.next()
    const two = s.next()
    const three = s.next()
    const four = s.next()

    streamController.yield(11)
    streamController.throw(new Error('Whoopsies'))
    streamController.yield(23)
    streamController.throw(new Error('Oopsies again'))
    streamController.return(new Error("This shouldn't be observed"))

    t.deepEqual({ done: false, value: 11 }, await one)
    const error = await t.throwsAsync(_ => two)
    t.is(error.message, 'Whoopsies')
    t.deepEqual({ done: true, value: undefined }, await three)
    t.deepEqual({ done: true, value: undefined }, await four)
})

// --- State checks

test("next method in empty or waiting state waits until a value is emitted", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    const one = s.next()
    const two = s.next()
    // Check that it isn't already resolved
    t.false(await isResolved(one), 'One should not yet be resolved')
    t.false(await isResolved(two), 'Two should not yet be resolved')

    streamController.yield(3)
    t.deepEqual(await one, { done: false, value: 3 })
    // Check that two still isn't resolved
    t.false(await isResolved(two), 'Two should not yet be resolved')
    streamController.yield(4)
    t.deepEqual(await two, { done: false, value: 4 })
})

test("next method in endWaiting state still waits until stream is complete is emitted", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    const one = s.next()
    const two = s.next()
    const end = s.return()
    const postEnd = s.next()

    t.false(await isResolved(one), 'One should not yet be resolved')
    t.false(await isResolved(two), 'Two should not yet be resolved')
    t.false(await isResolved(end), 'End should not yet be resolved')
    t.false(await isResolved(postEnd), 'Post end should not yet be resolved')

    streamController.yield(1)

    t.deepEqual(await one, { done: false, value: 1 })

    t.false(await isResolved(two), 'Two should not yet be resolved')
    t.false(await isResolved(end), 'End should not yet be resolved')
    t.false(await isResolved(postEnd), 'Post end should not yet be resolved')

    streamController.yield(2)

    t.deepEqual(await two, { done: false, value: 2 })
    t.deepEqual(await end, { done: true, value: undefined })
    t.deepEqual(await postEnd, { done: true, value: undefined })
})

test("next method in queued state immediately resolves with the value", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    streamController.yield(1)
    streamController.yield(2)

    const one = s.next()
    const two = s.next()
    const three = s.next()

    t.deepEqual(await one, { done: false, value: 1 })
    t.deepEqual(await two, { done: false, value: 2 })

    t.false(await isResolved(three), 'Three should not yet be resolved')

    streamController.yield(3)

    t.deepEqual(await three, { done: false, value: 3 })
})

test("next method in endQueued state resolves with the next value", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    streamController.yield(1)
    streamController.yield(2)
    streamController.return('End')

    const one = s.next()
    const two = s.next()

    t.deepEqual(await one, { done: false, value: 1 })
    t.deepEqual(await two, { done: false, value: 2 })
})

test("next method in endNext state returns { done: true } if returned", async t => {
    {
        let streamController
        const s = new Stream(stream => {
            streamController = stream
        })

        streamController.yield(1)
        streamController.return('End')

        t.deepEqual(await s.next(), { done: false, value: 1 })
        t.deepEqual(await s.next(), { done: true, value: 'End' })
    }

    {
        let streamController
        const s = new Stream(stream => {
            streamController = stream
        })

        streamController.yield(1)
        streamController.return('End')

        const one = s.next()
        const end = s.next()

        t.deepEqual(await one, { done: false, value: 1 })
        t.deepEqual(await end, { done: true, value: 'End' })
    }
})

test("next method in endNext throws error if error thrown", async t => {
    {
        let streamController
        const s = new Stream(stream => {
            streamController = stream
        })

        streamController.yield(1)
        const err = new Error('Oops!')
        streamController.throw(err)

        t.deepEqual(await s.next(), { done: false, value: 1 })
        await t.throwsAsync(_ => s.next(), { is: err })
    }

    {
        let streamController
        const s = new Stream(stream => {
            streamController = stream
        })

        streamController.yield(1)
        const err = new Error('Oops!')
        streamController.throw(err)

        const one = s.next()
        const error = s.next()

        t.deepEqual(await one, { done: false, value: 1 })
        await t.throwsAsync(_ => error, { is: err })
    }
})

test("next method in endNext waits until cleanup is complete", async t => {
    const cleanedUp = deferred()
    let streamController
    const s = new Stream(stream => {
        streamController = stream
        return _ => cleanedUp.promise
    })

    streamController.return('end')
    const finished = s.next()
    t.false(await isResolved(finished), 'Should not be resolved yet')
    cleanedUp.resolve()
    t.deepEqual(await finished, { done: true, value: 'end' })
})

test("next method in cleanupPending waits until cleanup is complete", async t => {
    const cleanedUp = deferred()

    let streamController
    const s = new Stream(stream => {
        streamController = stream
        return _ => cleanedUp.promise
    })

    streamController.return('end')
    const finished = s.next()
    const postFinish = s.next()
    t.false(await isResolved(finished), 'End should not be resolved yet')
    t.false(await isResolved(postFinish), 'Post finish should not be resolved yet either')

    cleanedUp.resolve()

    t.deepEqual(await finished, { done: true, value: 'end' })
    t.deepEqual(await postFinish, { done: true, value: undefined })
})

test("next method in complete state immediately resolves", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    streamController.return('end')

    await s.next()

    t.deepEqual(await s.next(), { done: true, value: undefined })
})
