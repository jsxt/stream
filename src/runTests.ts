/// <reference types="node"/>
import glob from "glob";
import chalk from "chalk";
import url from 'url';
import path from 'path';

async function main() {
    const abortOnError = process.argv.includes("--bail");

    const files = glob.sync("./**/*.tests.js", {
        cwd: path.dirname(url.fileURLToPath(import.meta.url)),
    });
    let errored = false;
    for (const file of files) {
        let testModule: { tests: { [key: string]: () => void | Promise<void> } };
        try {
            testModule = await import(file);
        } catch (err) {
            console.log(chalk`{red Failed to load tests} {blue > } {yellow ${ file }}`);
            errored = true;
            if (abortOnError) {
                process.exit(1);
                return;
            }
            continue;
        }

        let testsRan: boolean = false;
        for (const [testName, test] of Object.entries(testModule.tests)) {
            testsRan = true;
            try {
                await test();
                console.log(chalk`{green ${ file }} {blue >} {green ${ testName }}`);
            } catch (err) {
                console.log(chalk`{red ${ file }} {blue >} {yellow ${ testName }}`);
                console.log(err);
                errored = true;
                if (abortOnError) {
                    process.exit(1);
                    return;
                }
            }
        }

        if (!testsRan) {
            console.log(chalk`{red No tests in file} {blue >} {yellow ${ file }}`);
            errored = true;
            if (abortOnError) {
                process.exit(1);
                return;
            }
        }
    }
    if (errored) {
        process.exit(1);
    }
}

main().catch(console.error);
