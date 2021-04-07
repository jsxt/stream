
function assert(
    cond: boolean,
    message: string = "Assertion Failed",
): asserts cond {
    if (!cond) {
        throw new Error(message);
    }
}

class Deferred<T> {
    static resolve<T>(value: T | Promise<T>): Deferred<T> {
        const deferred = new Deferred<T>();
        deferred.resolve(value);
        return deferred;
    }

    static reject(reason: any): Deferred<any> {
        const deferred = new Deferred<any>();
        deferred.reject(reason);
        return deferred;
    }

    readonly #resolve: (value: T | Promise<T>) => void;
    readonly #reject: (error: any) => void;
    readonly #promise: Promise<T>;

    constructor() {
        let resolve!: (value: T | Promise<T>) => void;
        let reject!: (error: any) => void;
        this.#promise = new Promise((pResolve, pReject) => {
            resolve = pResolve;
            reject = pReject;
        });
        this.#resolve = resolve;
        this.#reject = reject;
    }

    get promise(): Promise<T> {
        return this.#promise;
    }

    get resolve(): (value: T | Promise<T>) => void {
        return this.#resolve;
    }

    get reject(): (error: any) => void {
        return this.#reject;
    }
}

class Queue<T> {
    readonly #queue: Set<{ value: T }> = new Set();

    get isEmpty(): boolean {
        return this.#queue.size === 0;
    }

    get size(): number {
        return this.#queue.size;
    }

    clear(): void {
        this.#queue.clear();
    }

    enqueue(value: T): void {
        const wrapper = { value };
        this.#queue.add(wrapper);
    }

    dequeue(): T {
        if (this.#queue.size === 0) {
            throw new Error(`Can't dequeue from empty queue`);
        }
        const [wrapper] = this.#queue;
        this.#queue.delete(wrapper);
        return wrapper.value;
    }
}

type ReadableStreamDefaultControllerOptions<T> = {
    stream: ReadableStream<T>,
    underlyingSource?: UnderlyingSource<T>,
    highWaterMark: number,
    sizeAlgorithm: (chunk: T) => number,
};

const controllerToken = Symbol("ControllerToken");

async function promiseTry<T>(func: () => T | Promise<T>): Promise<T> {
    return await func();
}

type ReadableStreamDefaultControllerInternals<T> = {
    cancelSteps: (reason: any) => Promise<void>,
    pullSteps: (readRequest: ReadRequest<T>) => void,
};

let readableStreamDefaultControllerInternals!: <T>(
    controller: ReadableStreamDefaultController<T>,
) => ReadableStreamDefaultControllerInternals<T>;

export class ReadableStreamDefaultController<T> {
    static #init = void function() {
        readableStreamDefaultControllerInternals
            = (controller) => controller.#internals;
    }();

    readonly #queue = new Queue<T>();
    readonly #strategyHighWaterMark: number;
    #cancelAlgorithm?: NonNullable<UnderlyingSource<T>["cancel"]>;
    #pullAlgorithm?: NonNullable<UnderlyingSource<T>["pull"]>;
    #strategySizeAlgorithm?: (chunk: T) => number;
    #queueTotalSize: number = 0;
    #closeRequested: boolean = false;
    #pullAgain: boolean = false;
    #pulling: boolean = false;
    #started: boolean = false;
    #stream: ReadableStream<T>;
    #internals: ReadableStreamDefaultControllerInternals<T> = {
        pullSteps: this.#pullSteps.bind(this),
        cancelSteps: this.#cancelSteps.bind(this),
    };

    constructor(token: typeof controllerToken, {
        underlyingSource = {},
        stream,
        highWaterMark,
        sizeAlgorithm,
    }: ReadableStreamDefaultControllerOptions<T>) {
        if (token !== controllerToken) {
            throw new TypeError("ReadableStreamDefaultController may not be instantiated directly");
        }
        const { start, cancel, pull } = underlyingSource;
        const startAlgorithm = start
            ? () => start.call(underlyingSource, this)
            : () => undefined;
        const pullAlgorithm = pull
            ? () => pull.call(underlyingSource, this)
            : () => Promise.resolve();
        const cancelAlgorithm = cancel
            ? () => cancel.call(underlyingSource, this)
            : () => Promise.resolve();
        this.#strategySizeAlgorithm = sizeAlgorithm;
        this.#strategyHighWaterMark = highWaterMark;
        this.#pullAlgorithm = pullAlgorithm;
        this.#cancelAlgorithm = cancelAlgorithm;
        this.#stream = stream;

        const startPromise = promiseTry(startAlgorithm);
        startPromise.then(() => {
            this.#started = true;
            assert(!this.#pulling);
            assert(!this.#pullAgain);
            this.#callPullIfNeeded();
        }, (error) => {
            this.#error(error);
        });
    }

    get desiredSize(): number | null {
        return this.#desiredSize;
    }

    close(): void {
        if (!this.#canCloseOrEnqueue()) {
            throw new TypeError("Cannot close in this state");
        }
        this.#close();
    }

    enqueue(chunk: T): void {
        if (!this.#canCloseOrEnqueue()) {
            throw new TypeError("Cannot enqueue in this state");
        }
        this.#enqueue(chunk);
    }

    error(reason: any): void {
        this.#error(reason);
    }

    get #streamInternals(): ReadableStreamInternals<T> {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return readableStreamInternals(this.#stream);
    }

    get #desiredSize(): number | null {
        if (this.#streamInternals.state() === "errored") {
            return null;
        } else if (this.#streamInternals.state() === "closed") {
            return 0;
        }
        return this.#strategyHighWaterMark - this.#queueTotalSize;
    }

    #canCloseOrEnqueue(): boolean {
        return this.#streamInternals.state() === "readable"
            && !this.#closeRequested;
    }

    #shouldCallPull(): boolean {
        if (!this.#canCloseOrEnqueue()) {
            return false;
        }
        if (!this.#started) {
            return false;
        }
        if (this.#streamInternals.locked()
        && this.#streamInternals.numReadRequests() > 0) {
            return true;
        }
        assert(this.#desiredSize !== null);
        if (this.#desiredSize > 0) {
            return true;
        }
        return false;
    }

    #callPullIfNeeded(): void {
        if (!this.#shouldCallPull()) {
            return;
        }
        if (this.#pulling) {
            this.#pullAgain = true;
            return;
        }
        assert(!this.#pullAgain);
        this.#pulling = true;
        const pullPromise = promiseTry(() => this.#pullAlgorithm?.(this));

        pullPromise.then(() => {
            this.#pulling = false;
            if (this.#pullAgain) {
                this.#pullAgain = false;
                this.#callPullIfNeeded();
            }
        }, (error: any) => {
            this.#error(error);
        });
    }

    #resetQueue(): void {
        this.#queue.clear();
        this.#queueTotalSize = 0;
    }

    #clearAlgorithms(): void {
        this.#pullAlgorithm = undefined;
        this.#cancelAlgorithm = undefined;
        this.#strategySizeAlgorithm = undefined;
    }

    #error(error: any): void {
        if (this.#streamInternals.state() !== "readable") {
            return;
        }
        this.#resetQueue();
        this.#clearAlgorithms();
        this.#streamInternals.error(error);
    }

    #close(): void {
        if (!this.#canCloseOrEnqueue()) {
            return;
        }
        this.#closeRequested = true;
        if (this.#queue.isEmpty) {
            this.#clearAlgorithms();
            this.#streamInternals.close();
        }
    }

    #enqueueValueWithSize(chunk: T, size: number | undefined): void {
        if (typeof size !== "number"
        || size < 0
        || size === Infinity
        || Number.isNaN(size)
        ) {
            throw new RangeError(`Invalid size for chunk: ${ String(size) }`);
        }
        this.#queue.enqueue(chunk);
        this.#queueTotalSize += size;
    }

    #enqueue(chunk: T): void {
        if (!this.#canCloseOrEnqueue()) {
            return;
        }

        if (this.#streamInternals.locked()
        && this.#streamInternals.numReadRequests() > 0) {
            this.#streamInternals.fulfillReadRequest(chunk, false);
        } else {
            try {
                const size = this.#strategySizeAlgorithm?.(chunk);
                this.#enqueueValueWithSize(chunk, size);
            } catch (reason: any) {
                this.#error(reason);
                throw reason;
            }
        }
        this.#callPullIfNeeded();
    }

    async #cancelSteps(reason: any): Promise<void> {
        this.#resetQueue();
        assert(this.#cancelAlgorithm !== undefined);
        const result = promiseTry(() => this.#cancelAlgorithm?.(reason));
        this.#clearAlgorithms();
        return await result;
    }

    #pullSteps(readRequest: ReadRequest<T>): void {
        if (this.#queue.isEmpty) {
            this.#streamInternals.addReadRequest(readRequest);
            this.#callPullIfNeeded();
        } else {
            const chunk = this.#queue.dequeue();
            if (this.#closeRequested && this.#queue.isEmpty) {
                this.#clearAlgorithms();
                this.#streamInternals.close();
            } else {
                this.#callPullIfNeeded();
            }
            readRequest.onChunk(chunk);
        }
    }
}

type ReadRequest<T> = {
    onChunk(chunk: T): void,
    onError(reason: any): void,
    onClose(): void,
};

type ReadableStreamDefaultReaderInternals<T> = {
    readonly readRequests: () => Queue<ReadRequest<T>>,
    readonly closed: () => Deferred<void>,
};

let readableStreamDefaultReaderInternals!: <T>(
    reader: ReadableStreamDefaultReader<T>,
) => ReadableStreamDefaultReaderInternals<T>;

export class ReadableStreamDefaultReader<T> {
    static #init = void function() {
        readableStreamDefaultReaderInternals = (reader) => reader.#internals;
    }();

    readonly #readRequests = new Queue<ReadRequest<T>>();
    #stream?: ReadableStream<T>;
    #closed: Deferred<void>;
    #internals: ReadableStreamDefaultReaderInternals<T> = {
        readRequests: () => this.#readRequests,
        closed: () => this.#closed,
    };

    constructor(stream: ReadableStream<T>) {
        this.#stream = stream;
        if (this.#streamInternals.locked()) {
            throw new TypeError("Stream is already locked to a reader");
        }
        this.#streamInternals.setReader(this);
        this.#closed = new Deferred();
        if (this.#streamInternals.state() === "closed") {
            this.#closed.resolve();
        } else if (this.#streamInternals.state() === "errored") {
            this.#closed.promise.catch(() => {});
            this.#closed.reject(this.#streamInternals.storedError());
        }
    }

    get closed(): Promise<void> {
        return this.#closed.promise;
    }

    async cancel(reason: any): Promise<void> {
        if (this.#stream === undefined) {
            throw new TypeError("This reader is no longer attached to a stream");
        }
        return void await this.#cancel(reason);
    }

    async read(): Promise<IteratorResult<T>> {
        if (this.#stream === undefined) {
            throw new TypeError("Reader is no longer attached to a stream");
        }
        const deferred = new Deferred<IteratorResult<T>>();
        this.#read({
            onChunk(chunk) {
                deferred.resolve({ value: chunk, done: false });
            },
            onClose() {
                deferred.resolve({ value: undefined, done: true });
            },
            onError(reason) {
                deferred.reject(reason);
            },
        });
        return deferred.promise;
    }

    releaseLock(): void {
        if (this.#stream === undefined) {
            return;
        }
        if (!this.#readRequests.isEmpty) {
            throw new TypeError("reader still has pending requests");
        }
        this.#release();
    }

    #release(): void {
        assert(this.#stream !== undefined);
        assert(this.#streamInternals.getReader() === this);
        if (this.#streamInternals.state() === "readable") {
            this.#closed.reject(new TypeError("This reader has been closed early"));
        } else {
            this.#closed = Deferred.reject(new TypeError("The stream for this reader has already been closed"));
        }
        this.#closed.promise.catch(() => {});
        this.#streamInternals.setReader(undefined);
        this.#stream = undefined;
    }

    #read(readRequest: ReadRequest<T>): void {
        if (this.#streamInternals.state() === "closed") {
            readRequest.onClose();
        } else if (this.#streamInternals.state() === "errored") {
            readRequest.onError(this.#streamInternals.storedError);
        } else {
            assert(this.#streamInternals.state() === "readable");
            this.#controllerInternals.pullSteps(readRequest);
        }
    }

    #cancel(reason: any): Promise<void> {
        return this.#streamInternals.cancel(reason);
    }

    get #streamInternals(): ReadableStreamInternals<T> {
        if (this.#stream === undefined) {
            throw new TypeError("Reader is no longer attached to a stream");
        }
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return readableStreamInternals(this.#stream);
    }

    get #controllerInternals(): ReadableStreamDefaultControllerInternals<T> {
        return readableStreamDefaultControllerInternals(
            this.#streamInternals.controller(),
        );
    }
}

export type UnderlyingSource<T> = {
    start?: (controller: ReadableStreamDefaultController<T>) => void | Promise<void>,
    pull?: (controller: ReadableStreamDefaultController<T>) => void | Promise<void>,
    cancel?: (reason: any) => void | Promise<void>,
    type?: "bytes",
};

export type QueueingStrategy<T> = {
    size?: (chunk: T) => number,
    highWaterMark?: number,
};

export type QueueingStrategyInit = {
    highWaterMark: number,
};

export class CountQueueingStrategy {
    readonly #highWaterMark: number;
    readonly #size: () => number;

    constructor(init: QueueingStrategyInit) {
        this.#highWaterMark = init.highWaterMark;
        this.#size = () => 1;
    }

    get highWaterMark(): number {
        return this.#highWaterMark;
    }

    get size(): () => number {
        return this.#size;
    }
}

type ReadableStreamState = "readable" | "closed" | "errored";

type ReadableStreamGetReaderOptions = {
    mode?: "byob",
};

type ReadableStreamInternals<T> = {
    readonly cancel: (reason: any) => Promise<void>,
    readonly numReadRequests: () => number,
    readonly locked: () => boolean,
    readonly state: () => ReadableStreamState,
    readonly error: (reason: any) => void,
    readonly addReadRequest: (readRequest: ReadRequest<T>) => void,
    readonly close: () => void,
    readonly fulfillReadRequest: (chunk: T, done: boolean) => void,
    readonly storedError: () => any,
    readonly getReader: () => ReadableStreamDefaultReader<T> | undefined,
    readonly setReader: (reader: ReadableStreamDefaultReader<T> | undefined) => void,
    readonly controller: () => ReadableStreamDefaultController<T>,
};

/* TODO:
type ReadableStreamIteratorOptions = {
    preventCancel?: boolean,
};
*/

let readableStreamInternals!: <T>(
    stream: ReadableStream<T>
) => ReadableStreamInternals<T>;

export default class ReadableStream<T> {
    static #init = void function() {
        readableStreamInternals = (stream) => stream.#internals;
    }();

    readonly #controller: ReadableStreamDefaultController<T>;
    #reader?: ReadableStreamDefaultReader<T>;
    #state: ReadableStreamState = "readable";
    #storedError: any;
    #internals: ReadableStreamInternals<T> = {
        addReadRequest: this.#addReadRequest.bind(this),
        close: this.#close.bind(this),
        error: this.#error.bind(this),
        fulfillReadRequest: this.#fulfillReadRequest.bind(this),
        locked: this.#locked.bind(this),
        numReadRequests: this.#numReadRequests.bind(this),
        state: () => this.#state,
        storedError: () => this.#storedError,
        getReader: () => this.#reader,
        setReader: (reader) => {
            this.#reader = reader;
        },
        controller: () => this.#controller,
        cancel: this.#cancel.bind(this),
    };

    constructor(
        underlyingSource: UnderlyingSource<T> = {},
        queueingStrategy: QueueingStrategy<T> = {},
    ) {
        if (underlyingSource?.type === "bytes") {
            throw new RangeError("byte streams not supported");
        }
        const size = queueingStrategy.size ?? (() => 1);
        const highWaterMark = queueingStrategy.highWaterMark ?? 1;

        this.#controller
            = new ReadableStreamDefaultController(controllerToken, {
                highWaterMark,
                sizeAlgorithm: size,
                stream: this,
            });
    }

    get locked(): boolean {
        return this.#locked();
    }

    async cancel(reason: any): Promise<void> {
        if (this.#locked()) {
            throw new TypeError("Stream is currently locked to a reader");
        }
        return void await this.#cancel(reason);
    }

    getReader(
        { mode }: ReadableStreamGetReaderOptions={},
    ): ReadableStreamDefaultReader<T> {
        if (mode === "byob") {
            throw new Error("Byte streams are not supported");
        }
        return new ReadableStreamDefaultReader(this);
    }

    /* TODO:
    tee(): [ReadableStream<T>, ReadableStream<T>] {

    }

    async* [Symbol.asyncIterator](
        options: ReadableStreamIteratorOptions={},
    ): AsyncGenerator<T> {

    }
    */

    get #controllerInternals(): ReadableStreamDefaultControllerInternals<T> {
        return readableStreamDefaultControllerInternals(this.#controller);
    }

    get #readerInternals(): ReadableStreamDefaultReaderInternals<T> | undefined {
        return this.#reader
            ? readableStreamDefaultReaderInternals(this.#reader)
            : undefined;
    }

    async #cancel(reason: any): Promise<void> {
        if (this.#state === "closed") {
            return;
        } else if (this.#state === "errored") {
            throw this.#storedError;
        }
        this.#close();
        await this.#controllerInternals.cancelSteps(reason);
    }

    #locked(): boolean {
        return this.#reader !== undefined;
    }

    #addReadRequest(readRequest: ReadRequest<T>): void {
        assert(this.#state === "readable");
        assert(this.#readerInternals !== undefined);
        this.#readerInternals.readRequests().enqueue(readRequest);
    }

    #close(): void {
        assert(this.#state === "readable");
        this.#state = "closed";
        if (this.#readerInternals) {
            const readRequests = this.#readerInternals.readRequests();
            while (!readRequests.isEmpty) {
                const request = readRequests.dequeue();
                request.onClose();
            }
        }
    }

    #error(reason: any): void {
        assert(this.#state === "readable");
        this.#state = "errored";
        this.#storedError = reason;
        if (this.#readerInternals) {
            const closed = this.#readerInternals.closed();
            const readRequests = this.#readerInternals.readRequests();
            closed.reject(reason);
            closed.promise.catch(() => {});
            while (!readRequests.isEmpty) {
                const request = readRequests.dequeue();
                request.onError(reason);
            }
        }
    }

    #fulfillReadRequest(chunk: T, done: boolean): void {
        assert(this.#readerInternals !== undefined);
        const readRequests = this.#readerInternals.readRequests();
        assert(!readRequests.isEmpty);
        const readRequest = readRequests.dequeue();
        if (done) {
            readRequest.onClose();
        } else {
            readRequest.onChunk(chunk);
        }
    }

    #numReadRequests(): number {
        assert(this.#readerInternals !== undefined);
        return this.#readerInternals.readRequests().size;
    }
}
