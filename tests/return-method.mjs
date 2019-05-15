import test from "ava"
import Stream from "../Stream.js"
import deferred from "./_helpers/deferred.js"
import isResolved from "./_helpers/isResolved.js"

test("return prevents any more messages that haven't been requested from resolving", async t => {
    const s = new Stream(stream => {
        stream.yield(10)
        stream.yield(20)
        stream.yield(30)
    })

    t.deepEqual({ done: false, value: 10 }, await s.next())
    t.deepEqual({ done: true, value: undefined }, await s.return())
    t.deepEqual({ done: true, value: undefined }, await s.next())
})

test("return succeeds if the stream is already closed", async t => {
    const s = new Stream(stream => {
        stream.yield(10)
        stream.return(20)
        stream.yield(30)
    })

    t.deepEqual({ done: false, value: 10 }, await s.next())
    t.deepEqual({ done: true, value: 20 }, await s.next())
    t.deepEqual({ done: true, value: undefined }, await s.return())
    t.deepEqual({ done: true, value: undefined }, await s.next())
})

test("return throws if any exceptions were enqueued but not used", async t => {
    const s = new Stream(stream => {
        stream.yield(10)
        stream.yield(20)
        stream.throw(new Error('Oh dear'))
        stream.yield(30)
    })

    t.deepEqual({ done: false, value: 10 }, await s.next())
    const error = await t.throwsAsync(_ => s.return())
    t.is('Oh dear', error.message)
    t.deepEqual({ done: true, value: undefined }, await s.next())
})

test("return honors previous calls to .next", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })
    const one = s.next()
    const two = s.next()
    const three = s.return()
    const four = s.next()

    streamController.yield(10)
    streamController.yield(20)
    streamController.yield(30)
    streamController.yield(40)

    t.deepEqual({ done: false, value: 10 }, await one)
    t.deepEqual({ done: false, value: 20 }, await two)
    t.deepEqual({ done: true, value: undefined }, await three)
    t.deepEqual({ done: true, value: undefined }, await four)
})

test("return follows the return value if there's one in the queue", async t => {
    const s = new Stream(stream => {
        stream.yield(10)
        stream.return(12)
    })

    t.deepEqual({ done: true, value: 12 }, await s.return())
})

test("return follows the error if there's one in the queue", async t => {
    const s = new Stream(stream => {
        stream.yield(10)
        stream.throw(new Error('oops'))
    })

    const error = await t.throwsAsync(_ => s.return())
    t.is('oops', error.message)
})

test("return method in empty or queued state resolves immediately", async t => {
    {
        const s = new Stream(_ => {
            /* Nothing to do */
        })

        t.deepEqual(await s.return(), { done: true, value: undefined })
    }

    // Gives back correct return value
    {
        const s = new Stream(_ => {
            /* Nothing to do */
        })

        t.deepEqual(await s.return(12), { done: true, value: 12 })
    }

    {
        let streamController
        const s = new Stream(stream => {
            streamController = stream
        })

        streamController.yield(1)
        streamController.yield(2)

        t.deepEqual(await s.return(undefined), { done: true, value: undefined })
    }

    {
        let streamController
        const s = new Stream(stream => {
            streamController = stream
        })

        streamController.yield(1)
        streamController.yield(2)

        t.deepEqual(await s.return(12), { done: true, value: 12 })
    }
})

test("return method in waiting or endWaiting state resolves when final .next is resolved and cleaup is complete", async t => {
    {
        let streamController
        const s = new Stream(stream => {
            streamController = stream
        })

        const one = s.next()
        const two = s.next()
        const end = s.return()
        const postEnd = s.return()

        t.false(await isResolved(one), `one shouldn't be resolved`)
        t.false(await isResolved(two), `two shouldn't be resolved`)
        t.false(await isResolved(end), `end shouldn't be resolved`)
        t.false(await isResolved(postEnd, `postEnd shouldn't be resolved`))

        streamController.yield(1)
        t.deepEqual(await one, { done: false, value: 1 })

        t.false(await isResolved(two), `two shouldn't be resolved`)
        t.false(await isResolved(end), `end shouldn't be resolved`)
        t.false(await isResolved(postEnd, `postEnd shouldn't be resolved`))

        streamController.yield(2)
        t.deepEqual(await two, { done: false, value: 2 })

        t.deepEqual(await end, { done: true, value: undefined })
        t.deepEqual(await postEnd, { done: true, value: undefined })
    }

    {
        const cleanedUp = deferred()
    }
})
